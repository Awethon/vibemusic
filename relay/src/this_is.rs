//! "This is <artist>" playlists: public Navidrome playlists of each artist's most popular songs
//! in the library, with a generated cover. An hourly check reads only the album list and looks
//! again at the artists whose albums or popularity changed; every `THIS_IS_EVERY_HOURS` all of
//! them are looked at. A playlist is written only when its tracks, name or cover really change.
//! On only when `VIBEMUSIC_RELAY_NAVIDROME_USER` and `VIBEMUSIC_RELAY_NAVIDROME_PASSWORD` name a
//! dedicated Navidrome account, which owns the playlists. A regular user is enough; it needs admin rights only when it lacks access to some
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
// How often the worker checks the library for changes (and retries after a failed run).
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
    /// playlist, `THIS_IS_EVERY_HOURS` (168) between looks at every artist, `THIS_IS_SKIP`
    /// comma-separated artist names to leave out, `THIS_IS_STATE` (`/data/this-is.json`, empty for
    /// none) file that remembers each artist's playlist and drawn covers across restarts.
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

    // Everything that decides which artists qualify and how covers look; a change means looking at
    // every artist again.
    fn rules(&self) -> String {
        let mut skip: Vec<&String> = self.skip.iter().collect();
        skip.sort();
        format!("{COVER_VERSION}|{}|{}|{skip:?}", self.min_tracks, self.max_tracks)
    }
}

// `last_run` is when every artist was last looked at, under `rules`. `covers` maps a playlist id
// to the signature of the albums its uploaded cover was drawn from. `artists` holds what each
// artist with enough tracks on their albums was last given, keyed by artist id.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct State {
    last_run: u64,
    rules: String,
    covers: HashMap<String, String>,
    artists: HashMap<String, Picked>,
}

// `inputs` fingerprints what the playlist was built from (see `inputs`); `songs` is empty when the
// artist turned out not to qualify.
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct Picked {
    inputs: String,
    title: String,
    songs: Vec<String>,
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
            let started = now_ms();
            let every = started.saturating_sub(state.last_run) >= settings.every_ms || state.rules != settings.rules();
            match run(&client, &settings, &enricher, &mut state, every).await {
                Ok(summary) => {
                    if every {
                        state.last_run = started;
                        state.rules = settings.rules();
                    }
                    match summary {
                        Some(summary) => tracing::info!(%summary, every, "This is playlists updated"),
                        None => tracing::debug!("no library changes for This is playlists"),
                    }
                }
                Err(error) => tracing::warn!(%error, "This is playlists failed, retrying in an hour"),
            }
            state.save(&settings);
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
    format!("{count} {name} tracks you own, most popular first · updated automatically · made by vibemusic")
}

/// What a cover is drawn from: the name and the shown albums with their images. Navidrome's
/// `imageHash` changes only with the image; versions without it fall back to the album's
/// `updatedAt`, which also changes with its tags.
pub fn cover_signature(name: &str, albums: &[&Value]) -> String {
    let shown: Vec<String> = albums
        .iter()
        .take(COVERS)
        .map(|album| {
            let image = Some(text(album, "imageHash"))
                .filter(|hash| !hash.is_empty())
                .unwrap_or_else(|| text(album, "updatedAt"));
            format!("{}@{image}", text(album, "id"))
        })
        .collect();
    format!("{COVER_VERSION}|{name}|{}", shown.join(","))
}

// 64-bit FNV-1a: a short, stable fingerprint for the state file.
fn fingerprint(text: &str) -> String {
    let hash = text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("{hash:016x}")
}

/// Fingerprints everything an artist's playlist and cover are built from: their name, each album's
/// id, track count, change times and cover image, and what Deezer and Apple say about them. Plays
/// and likes are left out: the relay's account barely plays anything.
pub fn inputs(name: &str, albums: &[&Value], popularity: &str) -> String {
    let mut parts: Vec<String> = albums
        .iter()
        .map(|album| {
            ["id", "songCount", "updatedAt", "importedAt", "imageHash"]
                .map(|key| album[key].to_string())
                .join("@")
        })
        .collect();
    parts.sort();
    fingerprint(&format!("{name}|{}|{popularity}", parts.join(",")))
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

// Album ids per songs request when fetching only some albums' songs.
const ALBUMS_PER_REQUEST: usize = 100;

async fn songs_of(account: &Account, album_ids: &[String]) -> Result<Vec<Value>, AccountError> {
    let mut songs = Vec::new();
    for chunk in album_ids.chunks(ALBUMS_PER_REQUEST) {
        let filter: Vec<String> = chunk.iter().map(|id| format!("album_id={id}")).collect();
        songs.extend(
            account
                .all(&format!(
                    "song?missing=false&{}&_sort=album&_order=ASC",
                    filter.join("&")
                ))
                .await?,
        );
    }
    Ok(songs)
}

/// Looks at the artists whose inputs changed since they were last looked at, or at all of them when
/// `every` is set, and writes the playlists that come out different. `None` when nothing changed.
async fn run(
    client: &reqwest::Client,
    settings: &Settings,
    enricher: &Enricher,
    state: &mut State,
    every: bool,
) -> Result<Option<String>, AccountError> {
    let account = Account::sign_in(client.clone(), &settings.url, &settings.username, &settings.password).await?;
    let albums = account.all("album?missing=false&_sort=name&_order=ASC").await?;
    let mut names: HashMap<String, String> = HashMap::new();
    let mut albums_by_artist: HashMap<String, Vec<&Value>> = HashMap::new();
    for album in &albums {
        for (id, name) in album_artists(album) {
            names.insert(id.clone(), name);
            albums_by_artist.entry(id).or_default().push(album);
        }
    }
    // Newest album first: it themes the cover and leads the fan of covers.
    for list in albums_by_artist.values_mut() {
        list.sort_by_key(|album| std::cmp::Reverse((number(album, "maxYear"), text(album, "createdAt"))));
    }
    // An artist's songs all sit on their albums, so the albums' track counts tell who can qualify
    // without fetching any songs.
    let candidates: HashMap<&String, String> = albums_by_artist
        .iter()
        .filter(|(id, list)| {
            let lower = names[*id].to_lowercase();
            list.iter().map(|album| number(album, "songCount")).sum::<i64>() >= settings.min_tracks as i64
                && !settings.skip.contains(&lower)
                && lower != "various artists"
        })
        .map(|(id, list)| (id, inputs(&names[id], list, &enricher.popularity(id))))
        .collect();
    let mut changed: Vec<&String> = candidates
        .iter()
        .filter(|(id, inputs)| {
            every
                || state
                    .artists
                    .get(id.as_str())
                    .is_none_or(|picked| &picked.inputs != *inputs)
        })
        .map(|(id, _)| *id)
        .collect();
    changed.sort_by_key(|id| names[*id].to_lowercase());
    let gone: Vec<String> = state
        .artists
        .keys()
        .filter(|id| !candidates.contains_key(id))
        .cloned()
        .collect();
    if !every && changed.is_empty() && gone.is_empty() {
        return Ok(None);
    }

    let album_ids: Vec<String> = changed
        .iter()
        .flat_map(|id| albums_by_artist[*id].iter().map(|album| text(album, "id")))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    // Past a quarter of the library, one pass over all songs is cheaper than asking album by album.
    let songs = if every || album_ids.len() * 4 > albums.len() {
        account.all("song?missing=false&_sort=album&_order=ASC").await?
    } else {
        songs_of(&account, &album_ids).await?
    };
    let wanted: HashSet<&String> = changed.iter().copied().collect();
    let mut songs_by_artist: HashMap<String, Vec<Value>> = HashMap::new();
    for song in songs.into_iter().filter(|song| song["missing"] != true) {
        for (id, _) in album_artists(&song) {
            if wanted.contains(&id) {
                songs_by_artist.entry(id).or_default().push(song.clone());
            }
        }
    }

    // Apple top songs come from the enrichment cache when fresh; otherwise they are fetched here and
    // stored, unless Apple is off (ENRICHMENT_SOURCES).
    let apple = Apple::from_env(client.clone());
    let mut picks: Vec<(String, Picked)> = Vec::new();
    for id in changed {
        let name = &names[id];
        let artist_albums = &albums_by_artist[id];
        let artist_songs = songs_by_artist.get(id).map(Vec::as_slice).unwrap_or_default();
        let songs = if artist_songs.len() < settings.min_tracks {
            Vec::new()
        } else {
            let album_names: Vec<String> = artist_albums.iter().map(|album| text(album, "name")).collect();
            let top = match enricher.apple_top(id) {
                Some(top) => top,
                None if enricher.asks_apple() => match apple.top_songs(name, &album_names).await {
                    Fetched::Found(top) => {
                        enricher.store_apple(id.clone(), Some(top.clone()));
                        top
                    }
                    Fetched::Missing => {
                        enricher.store_apple(id.clone(), None);
                        Vec::new()
                    }
                    Fetched::Failed => Vec::new(),
                },
                None => Vec::new(),
            };
            tracing::debug!(name, top = top.len(), "apple top songs");
            choose(
                &apple::ranked(&top),
                &enricher.deezer_top(id),
                artist_songs,
                settings.max_tracks,
            )
        };
        // Fingerprinted after asking Apple, so a fresh answer doesn't count as a change next hour.
        let inputs = inputs(name, artist_albums, &enricher.popularity(id));
        picks.push((
            id.clone(),
            Picked {
                inputs,
                title: format!("{PREFIX}{name}"),
                songs,
            },
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
    let (mut created, mut updated, mut drawn, mut removed) = (0, 0, 0, 0);
    for (artist_id, picked) in &picks {
        if picked.songs.is_empty() {
            state.artists.insert(artist_id.clone(), picked.clone());
            continue;
        }
        let name = &names[artist_id];
        let existing = ours.get(&picked.title).copied();
        // Rewriting an unchanged playlist would still make every app fetch it again.
        let same = existing.is_some_and(|playlist| number(playlist, "songCount") == picked.songs.len() as i64)
            && state
                .artists
                .get(artist_id)
                .is_some_and(|old| old.title == picked.title && old.songs == picked.songs);
        let playlist_id = match existing {
            Some(playlist) if same => text(playlist, "id"),
            _ => {
                let id = save_playlist(&account, existing, &picked.title, &picked.songs).await?;
                if existing.is_some() {
                    updated += 1
                } else {
                    created += 1
                }
                id
            }
        };
        let comment = comment(name, picked.songs.len());
        if existing.is_none_or(|playlist| !same || text(playlist, "comment") != comment || playlist["public"] != true) {
            account.update_playlist(&playlist_id, &picked.title, &comment).await?;
        }
        let artist_albums = &albums_by_artist[artist_id];
        // The cover is redrawn only when the signature (COVER_VERSION, name, shown albums and their
        // images) changes, or the playlist has no uploaded image.
        let signature = cover_signature(name, artist_albums);
        let has_image = existing.is_some_and(|playlist| !text(playlist, "uploadedImage").is_empty());
        if !(has_image && state.covers.get(&playlist_id) == Some(&signature)) {
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
        state.artists.insert(artist_id.clone(), picked.clone());
    }
    for id in &gone {
        state.artists.remove(id);
    }
    let titles: HashSet<&String> = state
        .artists
        .values()
        .filter(|picked| !picked.songs.is_empty())
        .map(|picked| &picked.title)
        .collect();
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
    Ok(Some(format!(
        "{} artists looked at: {created} created, {updated} updated, {drawn} covers drawn, {removed} removed",
        picks.len()
    )))
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
    fn inputs_change_with_albums_covers_and_popularity_but_not_plays() {
        let one = json!({ "id": "a1", "songCount": 10, "updatedAt": "2024-01-01", "importedAt": "2024-01-02", "imageHash": "h1", "playCount": 3 });
        let two = json!({ "id": "a2", "songCount": 8, "updatedAt": "2024-02-01", "importedAt": "2024-02-02", "imageHash": "h2" });
        let base = inputs("Lume", &[&one, &two], "[]");
        assert_eq!(base, inputs("Lume", &[&two, &one], "[]"));
        let played = json!({ "id": "a1", "songCount": 10, "updatedAt": "2024-01-01", "importedAt": "2024-01-02", "imageHash": "h1", "playCount": 40 });
        assert_eq!(base, inputs("Lume", &[&played, &two], "[]"));
        let new_cover = json!({ "id": "a1", "songCount": 10, "updatedAt": "2024-01-01", "importedAt": "2024-01-02", "imageHash": "h9" });
        assert_ne!(base, inputs("Lume", &[&new_cover, &two], "[]"));
        let new_track = json!({ "id": "a1", "songCount": 11, "updatedAt": "2024-01-01", "importedAt": "2024-01-02", "imageHash": "h1" });
        assert_ne!(base, inputs("Lume", &[&new_track, &two], "[]"));
        assert_ne!(base, inputs("Lume", &[&one], "[]"));
        assert_ne!(base, inputs("Lume", &[&one, &two], "[[\"Hit\",10],null]"));
        assert_ne!(base, inputs("Lumen", &[&one, &two], "[]"));
    }

    #[test]
    fn cover_signature_follows_the_image_not_the_tags() {
        let album = json!({ "id": "a1", "updatedAt": "2024-01-01", "imageHash": "h1" });
        let retagged = json!({ "id": "a1", "updatedAt": "2025-05-05", "imageHash": "h1" });
        let new_image = json!({ "id": "a1", "updatedAt": "2024-01-01", "imageHash": "h2" });
        assert_eq!(
            cover_signature("Lume", &[&album]),
            cover_signature("Lume", &[&retagged])
        );
        assert_ne!(
            cover_signature("Lume", &[&album]),
            cover_signature("Lume", &[&new_image])
        );
        let older_navidrome = json!({ "id": "a1", "updatedAt": "2024-01-01" });
        let older_retagged = json!({ "id": "a1", "updatedAt": "2025-05-05" });
        assert_ne!(
            cover_signature("Lume", &[&older_navidrome]),
            cover_signature("Lume", &[&older_retagged])
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
