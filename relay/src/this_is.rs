//! "This is <artist>" playlists: public Navidrome playlists of each artist's most popular songs
//! in the library, with a generated cover. On only when `VIBEMUSIC_RELAY_NAVIDROME_USER` and
//! `VIBEMUSIC_RELAY_NAVIDROME_PASSWORD` name a dedicated Navidrome account, which owns the
//! playlists. A regular user is enough; it needs admin rights only when it lacks access to some
//! libraries, or when Navidrome's `EnableArtworkUpload` is off (covers are uploaded images).
//! Popularity comes from Apple and Deezer (see `enrich.rs`).

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use image::RgbImage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::account::{Account, AccountError};
use crate::apple::{self, Apple};
use crate::cover;
use crate::deezer;
use crate::enrich::now_ms;
use crate::enrich::{Enricher, Fetched};

// Playlists of the relay's account whose name starts with this are managed here: updated, and
// deleted when their artist no longer qualifies. Do not use the prefix for hand-made playlists.
const PREFIX: &str = "This is ";
// Part of the cover signature; change it when `cover.rs` draws differently to redraw all covers.
const COVER_VERSION: &str = "discography-3";
// How often the worker wakes to see whether a refresh is due (and retries after a failed one).
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);
// Album covers fanned out on a playlist cover.
const COVERS: usize = 5;

pub struct Settings {
    url: String,
    username: String,
    password: String,
    min_tracks: usize,
    max_tracks: usize,
    every_ms: u64,
    skip: HashSet<String>,
    state: Option<PathBuf>,
}

fn env_number<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

impl Settings {
    /// `None` unless both account variables are set. Tuning, all optional: `THIS_IS_MIN_TRACKS`
    /// (default 13) songs an artist needs for a playlist, `THIS_IS_MAX_TRACKS` (50) songs per
    /// playlist, `THIS_IS_EVERY_HOURS` (168) between refreshes, `THIS_IS_SKIP` comma-separated
    /// artist names to leave out, `THIS_IS_STATE` (`/data/this-is.json`, empty for none) file
    /// that remembers the last run and drawn covers across restarts.
    pub fn from_env(url: &str) -> Option<Self> {
        let username = std::env::var("VIBEMUSIC_RELAY_NAVIDROME_USER")
            .ok()
            .filter(|value| !value.is_empty())?;
        let password = std::env::var("VIBEMUSIC_RELAY_NAVIDROME_PASSWORD")
            .ok()
            .filter(|value| !value.is_empty())?;
        let state = std::env::var("THIS_IS_STATE").unwrap_or_else(|_| "/data/this-is.json".into());
        Some(Self {
            url: url.to_owned(),
            username,
            password,
            min_tracks: env_number("THIS_IS_MIN_TRACKS", 13),
            max_tracks: env_number("THIS_IS_MAX_TRACKS", 50),
            every_ms: env_number::<u64>("THIS_IS_EVERY_HOURS", 168) * 60 * 60 * 1000,
            skip: std::env::var("THIS_IS_SKIP")
                .unwrap_or_default()
                .split(',')
                .map(|name| name.trim().to_lowercase())
                .filter(|name| !name.is_empty())
                .collect(),
            state: (!state.is_empty()).then(|| PathBuf::from(state)),
        })
    }
}

// `covers` maps a playlist id to the signature of the albums its uploaded cover was drawn from.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct State {
    last_run: u64,
    covers: HashMap<String, String>,
}

impl State {
    fn load(settings: &Settings) -> Self {
        settings
            .state
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(&self, settings: &Settings) {
        let Some(path) = &settings.state else { return };
        if let Err(error) = serde_json::to_vec_pretty(self)
            .map_err(std::io::Error::other)
            .and_then(|bytes| std::fs::write(path, bytes))
        {
            tracing::warn!(%error, path = %path.display(), "could not save the This is state");
        }
    }
}

pub fn start(settings: Settings, enricher: std::sync::Arc<Enricher>) {
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("http client");
        loop {
            let mut state = State::load(&settings);
            if now_ms().saturating_sub(state.last_run) >= settings.every_ms {
                match run(&client, &settings, &enricher, &mut state).await {
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

/// The album artists of a song or album as (id, name): every credited album artist from
/// `participants` when Navidrome has them, else the single `albumArtistId`/`albumArtist`. A
/// collaboration album then counts for each artist instead of a combined "A & B" artist.
pub fn album_artists(item: &Value) -> Vec<(String, String)> {
    let credited: Vec<(String, String)> = item["participants"]["albumartist"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|artist| {
            Some((
                artist["id"].as_str().filter(|id| !id.is_empty())?.to_owned(),
                artist["name"].as_str().filter(|name| !name.is_empty())?.to_owned(),
            ))
        })
        .collect();
    if !credited.is_empty() {
        return credited;
    }
    let (id, name) = (text(item, "albumArtistId"), text(item, "albumArtist"));
    if id.is_empty() || name.is_empty() {
        Vec::new()
    } else {
        vec![(id, name)]
    }
}

// Words in a title that mark a skit, intro or interlude, in English and Russian.
const FILLER: [&str; 9] = [
    "skit",
    "intro",
    "outro",
    "interlude",
    "prelude",
    "скит",
    "интро",
    "аутро",
    "интерлюдия",
];
// Shorter tracks are treated as filler too.
const MIN_SONG_SECONDS: f64 = 75.0;

fn is_filler(song: &Value) -> bool {
    let title = text(song, "title").to_lowercase();
    song["duration"]
        .as_f64()
        .is_some_and(|seconds| seconds < MIN_SONG_SECONDS)
        || title
            .split(|character: char| !character.is_alphanumeric())
            .any(|word| FILLER.contains(&word))
}

// Keeps one copy of each song across albums, compilations and re-releases (same `title_key`):
// the original recording over remixes and live takes, then a known year over none, then the
// earliest year, then the most played.
fn one_edition_each(songs: Vec<&Value>) -> Vec<&Value> {
    let mut best: HashMap<String, &Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let preference = |song: &Value| {
        (
            deezer::is_other_recording(&text(song, "title")),
            number(song, "year") == 0,
            number(song, "year"),
            -number(song, "playCount"),
        )
    };
    for song in songs {
        let title = text(song, "title");
        let key = deezer::title_key(&title);
        let key = if key.is_empty() {
            format!("id:{}", text(song, "id"))
        } else {
            key
        };
        match best.get(&key) {
            Some(kept) if preference(kept) <= preference(song) => {}
            Some(_) => {
                best.insert(key, song);
            }
            None => {
                order.push(key.clone());
                best.insert(key, song);
            }
        }
    }
    order.into_iter().filter_map(|key| best.remove(&key)).collect()
}

/// Song ids for an artist's playlist, at most `max`: ranked by Apple's top songs, then Deezer's,
/// then play count, newest year, and album order. Filler (skits, intros, short tracks) goes last
/// unless a service ranks it.
pub fn choose(apple_top: &[(String, u64)], deezer_top: &[(String, u64)], songs: &[Value], max: usize) -> Vec<String> {
    let mut chosen = one_edition_each(songs.iter().collect());
    chosen.sort_by_key(|song| {
        let title = text(song, "title");
        let apple = deezer::song_rank(apple_top, &title);
        let deezer = deezer::song_rank(deezer_top, &title);
        (
            apple.is_none() && deezer.is_none() && is_filler(song),
            std::cmp::Reverse(apple.unwrap_or(0)),
            std::cmp::Reverse(deezer.unwrap_or(0)),
            -number(song, "playCount"),
            -number(song, "year"),
            number(song, "discNumber"),
            number(song, "trackNumber"),
        )
    });
    chosen.into_iter().take(max).map(|song| text(song, "id")).collect()
}

pub fn comment(name: &str, count: usize) -> String {
    format!("{count} {name} tracks you own, most popular first · updated weekly · made by vibemusic")
}

async fn cover_image(account: &Account, album_id: &str, size: u32) -> Result<RgbImage, AccountError> {
    let bytes = account.cover_art(&format!("al-{album_id}"), size).await?;
    Ok(image::load_from_memory(&bytes)
        .map_err(|error| AccountError(error.to_string()))?
        .to_rgb8())
}

async fn draw_cover(account: &Account, name: &str, albums: &[&Value]) -> Result<Vec<u8>, AccountError> {
    // The newest album's cover sets the colours; a small copy is enough to sample them.
    let newest = cover_image(account, &text(albums[0], "id"), 200).await?;
    let mut covers = Vec::new();
    for album in albums.iter().take(COVERS) {
        covers.push(cover_image(account, &text(album, "id"), 600).await?);
    }
    let name = name.to_owned();
    // Rendering is CPU-heavy; keep it off the async runtime threads.
    tokio::task::spawn_blocking(move || cover::render(&name, &newest, &covers))
        .await
        .map_err(|error| AccountError(error.to_string()))
}

// Subsonic `createPlaylist` with a `playlistId` replaces that playlist's songs; without one it
// creates a new playlist.
async fn save_playlist(
    account: &Account,
    existing: Option<&Value>,
    title: &str,
    songs: &[String],
) -> Result<String, AccountError> {
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

async fn run(
    client: &reqwest::Client,
    settings: &Settings,
    enricher: &Enricher,
    state: &mut State,
) -> Result<String, AccountError> {
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
    // Newest album first: it themes the cover and leads the fan of covers.
    for list in albums_by_artist.values_mut() {
        list.sort_by_key(|album| std::cmp::Reverse((number(album, "maxYear"), text(album, "createdAt"))));
    }
    // Apple top songs come from the enrichment cache when fresh; otherwise they are fetched here,
    // unless Apple is off (ENRICHMENT_SOURCES).
    let apple = Apple::from_env(client.clone());
    let mut wanted: Vec<(String, String, Vec<String>)> = Vec::new();
    let mut artists: Vec<(&String, &Vec<Value>)> = songs_by_artist.iter().collect();
    artists.sort_by_key(|(id, _)| names[*id].to_lowercase());
    for (id, artist_songs) in artists {
        let name = &names[id];
        let lower = name.to_lowercase();
        if artist_songs.len() < settings.min_tracks || settings.skip.contains(&lower) || lower == "various artists" {
            continue;
        }
        let album_names: Vec<String> = albums_by_artist
            .get(id)
            .map(|list| list.iter().map(|album| text(album, "name")).collect())
            .unwrap_or_default();
        let top = match enricher.apple_top(id) {
            Some(top) => top,
            None if enricher.asks_apple() => match apple.top_songs(name, &album_names).await {
                Fetched::Found(top) => top,
                Fetched::Missing | Fetched::Failed => Vec::new(),
            },
            None => Vec::new(),
        };
        tracing::debug!(name, top = top.len(), "apple top songs");
        wanted.push((
            id.clone(),
            name.clone(),
            choose(
                &apple::ranked(&top),
                &enricher.deezer_top(id),
                artist_songs,
                settings.max_tracks,
            ),
        ));
    }
    let playlists = account.all("playlist").await?;
    // Only playlists this account owns are touched. `sync` playlists are imported from playlist
    // files and their tracks are managed by Navidrome, so they are left alone.
    let ours: HashMap<String, &Value> = playlists
        .iter()
        .filter(|playlist| {
            text(playlist, "ownerId") == account.id
                && playlist["sync"] != true
                && text(playlist, "name").starts_with(PREFIX)
        })
        .map(|playlist| (text(playlist, "name"), playlist))
        .collect();
    let titles: HashSet<String> = wanted.iter().map(|(_, name, _)| format!("{PREFIX}{name}")).collect();
    let (mut created, mut updated, mut drawn, mut removed) = (0, 0, 0, 0);
    for (artist_id, name, songs) in &wanted {
        let title = format!("{PREFIX}{name}");
        let existing = ours.get(&title).copied();
        let playlist_id = save_playlist(&account, existing, &title, songs).await?;
        if existing.is_some() {
            updated += 1
        } else {
            created += 1
        }
        account
            .update_playlist(&playlist_id, &title, &comment(name, songs.len()))
            .await?;
        let artist_albums = albums_by_artist.get(artist_id).map(Vec::as_slice).unwrap_or_default();
        if artist_albums.is_empty() {
            continue;
        }
        // The cover is redrawn only when the signature (COVER_VERSION, name, shown albums and their
        // updatedAt) changes, or the playlist has no uploaded image.
        let signature = format!(
            "{COVER_VERSION}|{name}|{}",
            artist_albums
                .iter()
                .take(COVERS)
                .map(|album| format!("{}@{}", text(album, "id"), text(album, "updatedAt")))
                .collect::<Vec<_>>()
                .join(",")
        );
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
        let mine = text(playlist, "ownerId") == account.id
            && playlist["sync"] != true
            && name.starts_with(PREFIX)
            && !titles.contains(&name);
        // "This is" playlists imported from files in a `_playlists` folder are removed as well.
        let legacy =
            playlist["sync"] == true && name.starts_with(PREFIX) && text(playlist, "path").contains("/_playlists/");
        if mine || legacy {
            account.delete_playlist(&text(playlist, "id")).await?;
            state.covers.remove(&text(playlist, "id"));
            removed += 1;
        }
    }
    Ok(format!(
        "{} artists: {created} created, {updated} updated, {drawn} covers drawn, {removed} removed",
        wanted.len()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn credits_album_artists_or_falls_back_to_the_album_artist() {
        let credited = json!({ "participants": { "albumartist": [{ "id": "a", "name": "Ana Reyes" }, { "id": "b", "name": "Theo Brandt" }] }, "albumArtistId": "x", "albumArtist": "Reyes & Brandt" });
        assert_eq!(
            album_artists(&credited),
            [
                ("a".to_owned(), "Ana Reyes".to_owned()),
                ("b".to_owned(), "Theo Brandt".to_owned())
            ]
        );
        assert_eq!(
            album_artists(&json!({ "albumArtistId": "x", "albumArtist": "Lume" })),
            [("x".to_owned(), "Lume".to_owned())]
        );
        assert!(album_artists(&json!({})).is_empty());
    }

    #[test]
    fn puts_top_songs_first_then_the_most_played() {
        let songs = vec![
            json!({ "id": "quiet", "title": "Quiet", "playCount": 0, "year": 2010 }),
            json!({ "id": "loved", "title": "Loved", "playCount": 9, "year": 2001 }),
            json!({ "id": "hit", "title": "Hit", "playCount": 1, "year": 2001 }),
            json!({ "id": "new", "title": "New", "playCount": 0, "year": 2020 }),
        ];
        let top = apple::ranked(&["Hit".to_owned(), "Not Owned".to_owned()]);
        assert_eq!(choose(&top, &[], &songs, 3), ["hit", "loved", "new"]);
    }

    #[test]
    fn ranks_by_deezer_when_apple_has_nothing_and_keeps_skits_last() {
        let songs = vec![
            json!({ "id": "intro", "title": "Северный ветер (интро)", "playCount": 3, "duration": 60.0 }),
            json!({ "id": "skit", "title": "Звонок (скит)", "playCount": 2, "duration": 140.0 }),
            json!({ "id": "paradise", "title": "Morning Paradise (feat. Иван Петров)", "playCount": 0, "duration": 200.0 }),
            json!({ "id": "trap", "title": "Ночной TRAP", "playCount": 0, "duration": 200.0 }),
            json!({ "id": "played", "title": "Тихий двор", "playCount": 1, "duration": 200.0 }),
        ];
        let deezer = [
            ("Morning Paradise".to_owned(), 343_400),
            ("Ночной TRAP".to_owned(), 187_966),
        ];
        assert_eq!(
            choose(&[], &deezer, &songs, 5),
            ["paradise", "trap", "played", "intro", "skit"]
        );
    }

    #[test]
    fn keeps_one_edition_of_each_song_preferring_the_original() {
        let songs = vec![
            json!({ "id": "live", "title": "Undertow (Live)", "year": 2009, "playCount": 5 }),
            json!({ "id": "bonus", "title": "Undertow", "year": 2008, "playCount": 1 }),
            json!({ "id": "studio", "title": "Undertow", "year": 2004, "playCount": 1 }),
        ];
        assert_eq!(choose(&[], &[], &songs, 5), ["studio"]);
    }
}
