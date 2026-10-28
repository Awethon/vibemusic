use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use image::RgbImage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::account::{Account, AccountError};
use crate::cover;
use crate::enrich::now_ms;

const PREFIX: &str = "This is ";
const COVER_VERSION: &str = "discography-3";
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);
const COVERS: usize = 5;

pub struct Settings {
    url: String,
    username: String,
    password: String,
    min_tracks: usize,
    max_tracks: usize,
    top_songs_pause: Duration,
    every_ms: u64,
    skip: HashSet<String>,
    state: Option<PathBuf>,
}

fn env_number<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

impl Settings {
    pub fn from_env(url: &str) -> Option<Self> {
        let username = std::env::var("VIBEMUSIC_NAVIDROME_USER").ok().filter(|value| !value.is_empty())?;
        let password = std::env::var("VIBEMUSIC_NAVIDROME_PASSWORD").ok().filter(|value| !value.is_empty())?;
        let state = std::env::var("THIS_IS_STATE").unwrap_or_else(|_| "/data/this-is.json".into());
        Some(Self {
            url: url.to_owned(),
            username,
            password,
            min_tracks: env_number("THIS_IS_MIN_TRACKS", 13),
            max_tracks: env_number("THIS_IS_MAX_TRACKS", 50),
            top_songs_pause: Duration::from_millis(env_number("THIS_IS_TOP_SONGS_PAUSE_MS", 4000)),
            every_ms: env_number::<u64>("THIS_IS_EVERY_HOURS", 168) * 60 * 60 * 1000,
            skip: std::env::var("THIS_IS_SKIP").unwrap_or_default().split(',').map(|name| name.trim().to_lowercase()).filter(|name| !name.is_empty()).collect(),
            state: (!state.is_empty()).then(|| PathBuf::from(state)),
        })
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct State {
    last_run: u64,
    covers: HashMap<String, String>,
}

impl State {
    fn load(settings: &Settings) -> Self {
        settings.state.as_ref().and_then(|path| std::fs::read(path).ok()).and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
    }

    fn save(&self, settings: &Settings) {
        let Some(path) = &settings.state else { return };
        if let Err(error) = serde_json::to_vec_pretty(self).map_err(std::io::Error::other).and_then(|bytes| std::fs::write(path, bytes)) {
            tracing::warn!(%error, path = %path.display(), "could not save the This is state");
        }
    }
}

pub fn start(settings: Settings) {
    tokio::spawn(async move {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(120)).build().expect("http client");
        loop {
            let mut state = State::load(&settings);
            if now_ms().saturating_sub(state.last_run) >= settings.every_ms {
                match run(&client, &settings, &mut state).await {
                    Ok(summary) => {
                        state.last_run = now_ms();
                        tracing::info!(%summary, "This is playlists refreshed");
                    }
                    Err(error) => tracing::warn!(%error, "This is playlists failed, retrying in an hour"),
                }
                state.save(&settings);
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

fn text(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_owned()
}

fn number(value: &Value, key: &str) -> i64 {
    value[key].as_i64().unwrap_or(0)
}

pub fn album_artists(item: &Value) -> Vec<(String, String)> {
    let credited: Vec<(String, String)> = item["participants"]["albumartist"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|artist| Some((artist["id"].as_str().filter(|id| !id.is_empty())?.to_owned(), artist["name"].as_str().filter(|name| !name.is_empty())?.to_owned())))
        .collect();
    if !credited.is_empty() {
        return credited;
    }
    let (id, name) = (text(item, "albumArtistId"), text(item, "albumArtist"));
    if id.is_empty() || name.is_empty() { Vec::new() } else { vec![(id, name)] }
}

pub fn choose(top: &[String], songs: &[Value], max: usize) -> Vec<String> {
    let owned: HashSet<&str> = songs.iter().map(|song| song["id"].as_str().unwrap_or_default()).collect();
    let mut chosen: Vec<String> = Vec::new();
    for id in top {
        if owned.contains(id.as_str()) && !chosen.contains(id) {
            chosen.push(id.clone());
        }
    }
    let mut rest: Vec<&Value> = songs.iter().filter(|song| !chosen.iter().any(|id| song["id"] == id.as_str())).collect();
    rest.sort_by_key(|song| (-number(song, "playCount"), -number(song, "year"), number(song, "discNumber"), number(song, "trackNumber")));
    chosen.extend(rest.into_iter().map(|song| text(song, "id")));
    chosen.truncate(max);
    chosen
}

pub fn comment(name: &str, count: usize) -> String {
    format!("{count} {name} tracks you own, most popular first · updated weekly · made by vibemusic")
}

async fn top_songs(account: &Account, name: &str, settings: &Settings) -> Vec<String> {
    let reply = account.subsonic("getTopSongs", &[("artist", name.to_owned()), ("count", settings.max_tracks.to_string())]).await;
    tokio::time::sleep(settings.top_songs_pause).await;
    match reply {
        Ok(reply) => reply["topSongs"]["song"].as_array().into_iter().flatten().map(|song| text(song, "id")).collect(),
        Err(error) => {
            tracing::warn!(%error, name, "no top songs");
            Vec::new()
        }
    }
}

async fn cover_image(account: &Account, album_id: &str, size: u32) -> Result<RgbImage, AccountError> {
    let bytes = account.cover_art(&format!("al-{album_id}"), size).await?;
    Ok(image::load_from_memory(&bytes).map_err(|error| AccountError(error.to_string()))?.to_rgb8())
}

async fn draw_cover(account: &Account, name: &str, albums: &[&Value]) -> Result<Vec<u8>, AccountError> {
    let newest = cover_image(account, &text(albums[0], "id"), 200).await?;
    let mut covers = Vec::new();
    for album in albums.iter().take(COVERS) {
        covers.push(cover_image(account, &text(album, "id"), 600).await?);
    }
    let name = name.to_owned();
    tokio::task::spawn_blocking(move || cover::render(&name, &newest, &covers)).await.map_err(|error| AccountError(error.to_string()))
}

async fn save_playlist(account: &Account, existing: Option<&Value>, title: &str, songs: &[String]) -> Result<String, AccountError> {
    let mut params: Vec<(&str, String)> = songs.iter().map(|id| ("songId", id.clone())).collect();
    match existing {
        Some(playlist) => {
            let id = text(playlist, "id");
            params.push(("playlistId", id.clone()));
            account.subsonic("createPlaylist", &params).await?;
            Ok(id)
        }
        None => {
            params.push(("name", title.to_owned()));
            let reply = account.subsonic("createPlaylist", &params).await?;
            let id = text(&reply["playlist"], "id");
            if id.is_empty() {
                return Err(AccountError(format!("no id for the new playlist {title}")));
            }
            Ok(id)
        }
    }
}

async fn run(client: &reqwest::Client, settings: &Settings, state: &mut State) -> Result<String, AccountError> {
    let account = Account::sign_in(client.clone(), &settings.url, &settings.username, &settings.password).await?;
    let songs = account.all("song?_sort=album&_order=ASC").await?;
    let albums = account.all("album?_sort=name&_order=ASC").await?;
    let mut names: HashMap<String, String> = HashMap::new();
    let mut songs_by_artist: HashMap<String, Vec<Value>> = HashMap::new();
    for song in songs.into_iter().filter(|song| song["missing"] != true) {
        for (id, name) in album_artists(&song) {
            names.insert(id.clone(), name);
            songs_by_artist.entry(id).or_default().push(song.clone());
        }
    }
    let mut albums_by_artist: HashMap<String, Vec<&Value>> = HashMap::new();
    for album in &albums {
        for (id, _) in album_artists(album) {
            albums_by_artist.entry(id).or_default().push(album);
        }
    }
    for list in albums_by_artist.values_mut() {
        list.sort_by_key(|album| std::cmp::Reverse((number(album, "maxYear"), text(album, "createdAt"))));
    }
    let mut wanted: Vec<(String, String, Vec<String>)> = Vec::new();
    let mut artists: Vec<(&String, &Vec<Value>)> = songs_by_artist.iter().collect();
    artists.sort_by_key(|(id, _)| names[*id].to_lowercase());
    for (id, artist_songs) in artists {
        let name = &names[id];
        let lower = name.to_lowercase();
        if artist_songs.len() < settings.min_tracks || settings.skip.contains(&lower) || lower == "various artists" {
            continue;
        }
        let top = top_songs(&account, name, settings).await;
        tracing::debug!(name, top = top.len(), "top songs");
        wanted.push((id.clone(), name.clone(), choose(&top, artist_songs, settings.max_tracks)));
    }
    let playlists = account.all("playlist").await?;
    let ours: HashMap<String, &Value> = playlists
        .iter()
        .filter(|playlist| text(playlist, "ownerId") == account.id && playlist["sync"] != true && text(playlist, "name").starts_with(PREFIX))
        .map(|playlist| (text(playlist, "name"), playlist))
        .collect();
    let titles: HashSet<String> = wanted.iter().map(|(_, name, _)| format!("{PREFIX}{name}")).collect();
    let (mut created, mut updated, mut drawn, mut removed) = (0, 0, 0, 0);
    for (artist_id, name, songs) in &wanted {
        let title = format!("{PREFIX}{name}");
        let existing = ours.get(&title).copied();
        let playlist_id = save_playlist(&account, existing, &title, songs).await?;
        if existing.is_some() { updated += 1 } else { created += 1 }
        account.update_playlist(&playlist_id, &title, &comment(name, songs.len())).await?;
        let artist_albums = albums_by_artist.get(artist_id).map(Vec::as_slice).unwrap_or_default();
        if artist_albums.is_empty() {
            continue;
        }
        let signature = format!("{COVER_VERSION}|{name}|{}", artist_albums.iter().take(COVERS).map(|album| format!("{}@{}", text(album, "id"), text(album, "updatedAt"))).collect::<Vec<_>>().join(","));
        let has_image = existing.is_some_and(|playlist| !text(playlist, "uploadedImage").is_empty());
        if has_image && state.covers.get(&playlist_id) == Some(&signature) {
            continue;
        }
        match draw_cover(&account, name, artist_albums).await {
            Ok(jpeg) => {
                tracing::debug!(name, bytes = jpeg.len(), "cover drawn");
                account.upload_cover(&playlist_id, jpeg).await?;
                state.covers.insert(playlist_id, signature);
                drawn += 1;
            }
            Err(error) => tracing::warn!(%error, name, "could not draw a This is cover"),
        }
    }
    for playlist in &playlists {
        let name = text(playlist, "name");
        let mine = text(playlist, "ownerId") == account.id && playlist["sync"] != true && name.starts_with(PREFIX) && !titles.contains(&name);
        let legacy = playlist["sync"] == true && name.starts_with(PREFIX) && text(playlist, "path").contains("/_playlists/");
        if mine || legacy {
            account.delete_playlist(&text(playlist, "id")).await?;
            state.covers.remove(&text(playlist, "id"));
            removed += 1;
        }
    }
    Ok(format!("{} artists: {created} created, {updated} updated, {drawn} covers drawn, {removed} removed", wanted.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn credits_album_artists_or_falls_back_to_the_album_artist() {
        let credited = json!({ "participants": { "albumartist": [{ "id": "a", "name": "Ana Reyes" }, { "id": "b", "name": "Theo Brandt" }] }, "albumArtistId": "x", "albumArtist": "Reyes & Brandt" });
        assert_eq!(album_artists(&credited), [("a".to_owned(), "Ana Reyes".to_owned()), ("b".to_owned(), "Theo Brandt".to_owned())]);
        assert_eq!(album_artists(&json!({ "albumArtistId": "x", "albumArtist": "Lume" })), [("x".to_owned(), "Lume".to_owned())]);
        assert!(album_artists(&json!({})).is_empty());
    }

    #[test]
    fn puts_top_songs_first_then_the_most_played() {
        let songs = vec![
            json!({ "id": "quiet", "playCount": 0, "year": 2010 }),
            json!({ "id": "loved", "playCount": 9, "year": 2001 }),
            json!({ "id": "hit", "playCount": 1, "year": 2001 }),
            json!({ "id": "new", "playCount": 0, "year": 2020 }),
        ];
        let top = vec!["hit".to_owned(), "not-owned".to_owned(), "hit".to_owned()];
        assert_eq!(choose(&top, &songs, 3), ["hit", "loved", "new"]);
    }
}
