//! Library enrichment: genres, countries and popularity for the app's artists and albums, looked
//! up on MusicBrainz, Deezer and Apple (iTunes) and cached on disk (`ENRICHMENT_CACHE`).
//! `ENRICHMENT_SOURCES` lists the services the relay may ask, comma-separated (default
//! `musicbrainz,deezer,apple`; empty for none). Answers cached before a service was turned off
//! are still served; nothing new is looked up there. Navidrome's own lookups (artist photos,
//! biographies, similar artists through its agents and plugins) are set in Navidrome (`ND_AGENTS`).
//!
//! The app sends `EnrichRequest`s over the relay socket. The relay answers at once from the cache
//! and queues what it does not know; each service has its own worker so a slow or throttled one
//! does not hold up the others. New results are broadcast to all sockets as `enrichment` messages.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{Notify, broadcast};

use crate::apple::Apple;
use crate::{deezer, musicbrainz};

const MUSICBRAINZ_PAUSE: Duration = musicbrainz::PAUSE;
// Extra wait after a failed lookup, on top of each service's own pacing.
const FAILURE_PAUSE: Duration = Duration::from_secs(10);
// New results are batched into one broadcast per interval instead of one message per lookup.
const FLUSH_EVERY: Duration = Duration::from_secs(2);
// The cache file is rewritten at most this often.
const SAVE_EVERY: Duration = Duration::from_secs(30);
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
// How long a cached answer is trusted before it is looked up again. A "not found" answer
// expires after MISSING_FRESH_MS instead, so new entries on the services are picked up sooner.
const MUSICBRAINZ_FRESH_MS: u64 = 30 * DAY_MS;
const DEEZER_FRESH_MS: u64 = 14 * DAY_MS;
const APPLE_FRESH_MS: u64 = 14 * DAY_MS;
const MISSING_FRESH_MS: u64 = 7 * DAY_MS;
// Caps on what one request may ask for, so a single message cannot queue unbounded work.
const MAX_RELEASE_GROUPS: usize = 100_000;
const MAX_ARTISTS: usize = 50_000;
const MAX_SONGS: usize = 5;
const MAX_ALBUMS: usize = 200;
const MAX_TEXT_CHARS: usize = 200;
// A lookup that keeps failing is dropped after this many tries; a later request queues it again.
const ATTEMPTS: u8 = 5;

/// Which outside services the relay may ask (`ENRICHMENT_SOURCES`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sources {
    pub musicbrainz: bool,
    pub deezer: bool,
    pub apple: bool,
}

impl Default for Sources {
    fn default() -> Self {
        Self {
            musicbrainz: true,
            deezer: true,
            apple: true,
        }
    }
}

impl Sources {
    pub fn from_env() -> Self {
        Self::parse(std::env::var("ENRICHMENT_SOURCES").ok().as_deref())
    }

    fn parse(value: Option<&str>) -> Self {
        let Some(value) = value else {
            return Self::default();
        };
        let mut sources = Self {
            musicbrainz: false,
            deezer: false,
            apple: false,
        };
        for name in value
            .split(',')
            .map(|name| name.trim().to_lowercase())
            .filter(|name| !name.is_empty())
        {
            match name.as_str() {
                "musicbrainz" => sources.musicbrainz = true,
                "deezer" => sources.deezer = true,
                "apple" => sources.apple = true,
                _ => tracing::warn!(name, "ENRICHMENT_SOURCES: unknown service, ignored"),
            }
        }
        sources
    }
}

/// A MusicBrainz tag (used as a genre) and its vote count.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Tag(pub String, pub u32);

/// A MusicBrainz release group (an album across its editions): credited artist MBIDs and tags.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ReleaseGroup {
    pub artists: Vec<String>,
    pub tags: Vec<Tag>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MbArtist {
    pub tags: Vec<Tag>,
    // `None` marks an entry cached before countries were looked up; it is fetched again.
    #[serde(default)]
    pub countries: Option<Vec<String>>,
}

/// The artist Deezer matched: fan count, top tracks as (title, Deezer rank) and albums as
/// (title, Deezer genre id, -1 if none).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DeezerArtist {
    pub id: u64,
    pub name: String,
    pub fans: u64,
    pub top: Vec<(String, u64)>,
    // `None` marks an entry cached before albums were looked up; it is fetched again.
    #[serde(default)]
    pub albums: Option<Vec<(String, i64)>>,
}

/// Outcome of a lookup on an external service. `Missing` means the service answered that there
/// is no such thing; it is cached like a result. `Failed` means the service could not be asked
/// (network error, throttling, unexpected reply); it is retried and never cached.
pub enum Fetched<T> {
    Found(T),
    Missing,
    Failed,
}

impl<T> Fetched<T> {
    pub fn map<U>(self, convert: impl FnOnce(T) -> U) -> Fetched<U> {
        match self {
            Fetched::Found(value) => Fetched::Found(convert(value)),
            Fetched::Missing => Fetched::Missing,
            Fetched::Failed => Fetched::Failed,
        }
    }
}

// `at` is when the entry was stored, in Unix ms; it is also what `since` in a request compares to.
#[derive(Serialize, Deserialize, Clone)]
struct Entry<T> {
    at: u64,
    value: Option<T>,
}

impl<T> Entry<T> {
    fn fresh(&self, now: u64, fresh_ms: u64) -> bool {
        now.saturating_sub(self.at)
            < if self.value.is_some() {
                fresh_ms
            } else {
                MISSING_FRESH_MS
            }
    }
}

// The on-disk cache. MusicBrainz entries are keyed by MBID; `artist_matches` maps a Navidrome
// artist id to the MBID found by search; `deezer` and `apple` are keyed by Navidrome artist id.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Cache {
    release_groups: HashMap<String, Entry<ReleaseGroup>>,
    mb_artists: HashMap<String, Entry<MbArtist>>,
    deezer: HashMap<String, Entry<DeezerArtist>>,
    artist_matches: HashMap<String, Entry<String>>,
    apple: HashMap<String, Entry<Vec<String>>>,
}

/// A Navidrome artist with a few of its song and album titles, used to tell same-named artists
/// apart on Deezer and Apple.
#[derive(Deserialize, Clone)]
pub struct ArtistRequest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub songs: Vec<String>,
    #[serde(default)]
    pub albums: Vec<String>,
}

/// A Navidrome artist without a MusicBrainz id: searched on MusicBrainz by name and confirmed by
/// album titles.
#[derive(Deserialize, Clone)]
pub struct SearchRequest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub albums: Vec<String>,
}

/// What the app wants to know. `since` is the `at` of the last `enrichment` message the app has;
/// the reply holds only entries stored after it, so the app does not get its whole library back
/// on every request.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichRequest {
    #[serde(default)]
    pub mb_search: Vec<SearchRequest>,
    #[serde(default)]
    pub since: u64,
    #[serde(default)]
    pub release_groups: Vec<String>,
    #[serde(default)]
    pub artists: Vec<ArtistRequest>,
}

enum MbJob {
    ReleaseGroup(String),
    Artist(String),
    Search(SearchRequest),
}

// Results stored since the last broadcast, sent as one `enrichment` message. A `None` value tells
// the app the service has nothing for that key.
#[derive(Default)]
struct Changes {
    release_groups: HashMap<String, Option<ReleaseGroup>>,
    mb_artists: HashMap<String, Option<MbArtist>>,
    deezer: HashMap<String, Option<DeezerArtist>>,
    artist_matches: HashMap<String, Option<String>>,
    apple: HashMap<String, Option<Vec<String>>>,
}

impl Changes {
    fn is_empty(&self) -> bool {
        self.release_groups.is_empty()
            && self.mb_artists.is_empty()
            && self.deezer.is_empty()
            && self.artist_matches.is_empty()
            && self.apple.is_empty()
    }

    fn message(&self, at: u64) -> Value {
        json!({ "type": "enrichment", "at": at, "releaseGroups": self.release_groups, "mbArtists": self.mb_artists, "deezer": self.deezer, "artistMatches": self.artist_matches, "apple": self.apple })
    }
}

#[derive(Default)]
struct State {
    cache: Cache,
    sources: Sources,
    musicbrainz: VecDeque<(MbJob, u8)>,
    deezer: VecDeque<(ArtistRequest, u8)>,
    apple: VecDeque<(ArtistRequest, u8)>,
    // Keys of jobs waiting or running in any queue (prefixed per kind), so a job is queued once.
    queued: HashSet<String>,
    changes: Changes,
    unsaved: bool,
}

pub struct Enricher {
    state: Mutex<State>,
    musicbrainz_ready: Notify,
    deezer_ready: Notify,
    apple_ready: Notify,
    apple: Apple,
    updates: broadcast::Sender<String>,
    client: reqwest::Client,
    path: Option<PathBuf>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

// The id goes into a MusicBrainz URL path, so only accept the UUID shape of an MBID.
fn valid_mbid(id: &str) -> bool {
    id.len() == 36
        && id
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

fn clip(text: &str) -> String {
    text.chars().take(MAX_TEXT_CHARS).collect()
}

impl State {
    fn queue_musicbrainz(&mut self, job: MbJob) {
        if !self.sources.musicbrainz {
            return;
        }
        let key = match &job {
            MbJob::ReleaseGroup(id) => format!("rg:{id}"),
            MbJob::Artist(id) => format!("ar:{id}"),
            MbJob::Search(search) => format!("se:{}", search.id),
        };
        if self.queued.insert(key) {
            self.musicbrainz.push_back((job, 0));
        }
    }

    fn queue_deezer(&mut self, artist: ArtistRequest) {
        if self.sources.deezer && self.queued.insert(format!("dz:{}", artist.id)) {
            self.deezer.push_back((artist, 0));
        }
    }

    // Apple is only asked about artists with album titles, since its match is confirmed by albums.
    fn queue_apple(&mut self, artist: ArtistRequest) {
        if self.sources.apple && !artist.albums.is_empty() && self.queued.insert(format!("ap:{}", artist.id)) {
            self.apple.push_back((artist, 0));
        }
    }

    // Also true for artists cached before countries existed (see `MbArtist::countries`).
    fn needs_artist(&self, id: &str, now: u64) -> bool {
        self.cache.mb_artists.get(id).is_none_or(|entry| {
            !entry.fresh(now, MUSICBRAINZ_FRESH_MS)
                || entry.value.as_ref().is_some_and(|artist| artist.countries.is_none())
        })
    }

    fn answer_artist(&mut self, id: &str, since: u64, now: u64, reply: &mut Changes) {
        if let Some(found) = self.cache.mb_artists.get(id).filter(|found| found.at > since) {
            reply.mb_artists.insert(id.to_owned(), found.value.clone());
        }
        if self.needs_artist(id, now) {
            self.queue_musicbrainz(MbJob::Artist(id.to_owned()));
        }
    }

    fn answer(&mut self, request: EnrichRequest, now: u64) -> Changes {
        let mut reply = Changes::default();
        for id in request
            .release_groups
            .into_iter()
            .filter(|id| valid_mbid(id))
            .take(MAX_RELEASE_GROUPS)
        {
            let entry = self.cache.release_groups.get(&id).cloned();
            match entry {
                Some(entry) => {
                    if !entry.fresh(now, MUSICBRAINZ_FRESH_MS) {
                        self.queue_musicbrainz(MbJob::ReleaseGroup(id.clone()));
                    }
                    // The album's first credited artist is looked up too, for its tags and country.
                    if let Some(artist) = entry.value.as_ref().and_then(|group| group.artists.first()).cloned() {
                        self.answer_artist(&artist, request.since, now, &mut reply);
                    }
                    if entry.at > request.since {
                        reply.release_groups.insert(id, entry.value);
                    }
                }
                None => self.queue_musicbrainz(MbJob::ReleaseGroup(id)),
            }
        }
        for search in request
            .mb_search
            .into_iter()
            .filter(|search| !search.id.is_empty() && !search.name.trim().is_empty())
            .take(MAX_ARTISTS)
        {
            let search = SearchRequest {
                id: clip(&search.id),
                name: clip(&search.name),
                albums: search
                    .albums
                    .iter()
                    .take(MAX_RELEASE_GROUPS)
                    .map(|title| clip(title))
                    .collect(),
            };
            match self.cache.artist_matches.get(&search.id).cloned() {
                Some(entry) => {
                    if entry.at > request.since {
                        reply.artist_matches.insert(search.id.clone(), entry.value.clone());
                    }
                    if let Some(mbid) = &entry.value {
                        self.answer_artist(mbid, request.since, now, &mut reply);
                    }
                    if !entry.fresh(now, MUSICBRAINZ_FRESH_MS) {
                        self.queue_musicbrainz(MbJob::Search(search));
                    }
                }
                None => self.queue_musicbrainz(MbJob::Search(search)),
            }
        }
        for artist in request
            .artists
            .into_iter()
            .filter(|artist| !artist.id.is_empty() && !artist.name.trim().is_empty())
            .take(MAX_ARTISTS)
        {
            let artist = ArtistRequest {
                id: clip(&artist.id),
                name: clip(&artist.name),
                songs: artist.songs.iter().take(MAX_SONGS).map(|title| clip(title)).collect(),
                albums: artist.albums.iter().take(MAX_ALBUMS).map(|title| clip(title)).collect(),
            };
            match self.cache.apple.get(&artist.id) {
                Some(entry) => {
                    if entry.at > request.since {
                        reply.apple.insert(artist.id.clone(), entry.value.clone());
                    }
                    if !entry.fresh(now, APPLE_FRESH_MS) {
                        self.queue_apple(artist.clone());
                    }
                }
                None => self.queue_apple(artist.clone()),
            }
            match self.cache.deezer.get(&artist.id) {
                Some(entry) => {
                    if entry.at > request.since {
                        reply.deezer.insert(artist.id.clone(), entry.value.clone());
                    }
                    let outdated = entry.value.as_ref().is_some_and(|found| found.albums.is_none());
                    if outdated || !entry.fresh(now, DEEZER_FRESH_MS) {
                        self.queue_deezer(artist);
                    }
                }
                None => self.queue_deezer(artist),
            }
        }
        reply
    }
}

impl Enricher {
    pub fn new(path: Option<PathBuf>, apple: Apple, sources: Sources) -> Arc<Self> {
        let cache = path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let (updates, _) = broadcast::channel(64);
        let enricher = Arc::new(Self {
            state: Mutex::new(State {
                cache,
                sources,
                ..State::default()
            }),
            musicbrainz_ready: Notify::new(),
            deezer_ready: Notify::new(),
            apple_ready: Notify::new(),
            apple,
            updates,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()
                .expect("http client"),
            path,
        });
        tokio::spawn(enricher.clone().run_musicbrainz());
        tokio::spawn(enricher.clone().run_deezer());
        tokio::spawn(enricher.clone().run_apple());
        tokio::spawn(enricher.clone().run_flusher());
        enricher
    }

    /// Deezer's top tracks for a Navidrome artist as (title, rank); empty if unknown.
    pub fn deezer_top(&self, artist_id: &str) -> Vec<(String, u64)> {
        self.state
            .lock()
            .unwrap()
            .cache
            .deezer
            .get(artist_id)
            .and_then(|entry| entry.value.as_ref())
            .map(|artist| artist.top.clone())
            .unwrap_or_default()
    }

    pub fn asks_apple(&self) -> bool {
        self.state.lock().unwrap().sources.apple
    }

    /// Apple's top songs for a Navidrome artist, most popular first: `None` if unknown or stale,
    /// an empty list if Apple has nothing.
    pub fn apple_top(&self, artist_id: &str) -> Option<Vec<String>> {
        let state = self.state.lock().unwrap();
        state
            .cache
            .apple
            .get(artist_id)
            .filter(|entry| entry.fresh(now_ms(), APPLE_FRESH_MS))
            .map(|entry| entry.value.clone().unwrap_or_default())
    }

    /// What Deezer and Apple say about an artist's popularity, fresh or not, as one string that
    /// changes whenever either answer does.
    pub fn popularity(&self, artist_id: &str) -> String {
        let state = self.state.lock().unwrap();
        let deezer = state
            .cache
            .deezer
            .get(artist_id)
            .and_then(|entry| entry.value.as_ref())
            .map(|artist| &artist.top);
        let apple = state.cache.apple.get(artist_id).map(|entry| &entry.value);
        json!([deezer, apple]).to_string()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.updates.subscribe()
    }

    /// Answers a request from the cache and queues the rest. Returns the reply message text.
    pub fn request(&self, request: EnrichRequest) -> String {
        let now = now_ms();
        let (reply, musicbrainz, deezer, apple) = {
            let mut state = self.state.lock().unwrap();
            let reply = state.answer(request, now);
            (
                reply,
                !state.musicbrainz.is_empty(),
                !state.deezer.is_empty(),
                !state.apple.is_empty(),
            )
        };
        // `notify_one` keeps a permit if the worker is busy, so the wake-up is not lost.
        if apple {
            self.apple_ready.notify_one();
        }
        if musicbrainz {
            self.musicbrainz_ready.notify_one();
        }
        if deezer {
            self.deezer_ready.notify_one();
        }
        reply.message(now).to_string()
    }

    fn store_release_group(&self, id: String, value: Option<ReleaseGroup>) {
        let now = now_ms();
        let mut state = self.state.lock().unwrap();
        if let Some(artist) = value.as_ref().and_then(|group| group.artists.first()).cloned()
            && state.needs_artist(&artist, now)
        {
            state.queue_musicbrainz(MbJob::Artist(artist));
        }
        state.changes.release_groups.insert(id.clone(), value.clone());
        state.cache.release_groups.insert(id, Entry { at: now, value });
        state.unsaved = true;
    }

    fn store_mb_artist(&self, id: String, value: Option<MbArtist>) {
        let mut state = self.state.lock().unwrap();
        state.changes.mb_artists.insert(id.clone(), value.clone());
        state.cache.mb_artists.insert(id, Entry { at: now_ms(), value });
        state.unsaved = true;
    }

    fn store_match(&self, id: String, value: Option<String>) {
        let now = now_ms();
        let mut state = self.state.lock().unwrap();
        if let Some(mbid) = value.clone()
            && state.needs_artist(&mbid, now)
        {
            state.queue_musicbrainz(MbJob::Artist(mbid));
        }
        state.changes.artist_matches.insert(id.clone(), value.clone());
        state.cache.artist_matches.insert(id, Entry { at: now, value });
        state.unsaved = true;
    }

    fn store_deezer(&self, id: String, value: Option<DeezerArtist>) {
        let mut state = self.state.lock().unwrap();
        state.changes.deezer.insert(id.clone(), value.clone());
        state.cache.deezer.insert(id, Entry { at: now_ms(), value });
        state.unsaved = true;
    }

    pub fn store_apple(&self, id: String, value: Option<Vec<String>>) {
        let mut state = self.state.lock().unwrap();
        state.changes.apple.insert(id.clone(), value.clone());
        state.cache.apple.insert(id, Entry { at: now_ms(), value });
        state.unsaved = true;
    }

    async fn run_musicbrainz(self: Arc<Self>) {
        loop {
            let job = self.state.lock().unwrap().musicbrainz.pop_front();
            let Some((job, attempts)) = job else {
                self.musicbrainz_ready.notified().await;
                continue;
            };
            let (key, failed) = match &job {
                MbJob::ReleaseGroup(id) => {
                    let id = id.clone();
                    let key = format!("rg:{id}");
                    let failed = match musicbrainz::release_group(&self.client, &id).await {
                        Fetched::Found(group) => {
                            self.store_release_group(id, Some(group));
                            false
                        }
                        Fetched::Missing => {
                            self.store_release_group(id, None);
                            false
                        }
                        Fetched::Failed => true,
                    };
                    (key, failed)
                }
                MbJob::Search(search) => {
                    let key = format!("se:{}", search.id);
                    let failed = match musicbrainz::find_artist(&self.client, &search.name, &search.albums).await {
                        Fetched::Found(mbid) => {
                            self.store_match(search.id.clone(), Some(mbid));
                            false
                        }
                        Fetched::Missing => {
                            self.store_match(search.id.clone(), None);
                            false
                        }
                        Fetched::Failed => true,
                    };
                    (key, failed)
                }
                MbJob::Artist(id) => {
                    let id = id.clone();
                    let key = format!("ar:{id}");
                    let failed = match musicbrainz::artist(&self.client, &id).await {
                        Fetched::Found(artist) => {
                            self.store_mb_artist(id, Some(artist));
                            false
                        }
                        Fetched::Missing => {
                            self.store_mb_artist(id, None);
                            false
                        }
                        Fetched::Failed => true,
                    };
                    (key, failed)
                }
            };
            {
                let mut state = self.state.lock().unwrap();
                // Failed jobs go to the back of the queue, so one bad id does not block the rest.
                if failed && attempts + 1 < ATTEMPTS {
                    state.musicbrainz.push_back((job, attempts + 1));
                } else {
                    state.queued.remove(&key);
                }
            }
            // MusicBrainz allows about one request per second per client, so the worker sleeps
            // after every job. Deezer and Apple pace inside their own modules.
            tokio::time::sleep(if failed { FAILURE_PAUSE } else { MUSICBRAINZ_PAUSE }).await;
        }
    }

    async fn run_deezer(self: Arc<Self>) {
        loop {
            let artist = self.state.lock().unwrap().deezer.pop_front();
            let Some((artist, attempts)) = artist else {
                self.deezer_ready.notified().await;
                continue;
            };
            let failed = match deezer::find_artist(&self.client, &artist.name, &artist.songs).await {
                Fetched::Found(found) => {
                    self.store_deezer(artist.id.clone(), Some(found));
                    false
                }
                Fetched::Missing => {
                    self.store_deezer(artist.id.clone(), None);
                    false
                }
                Fetched::Failed => true,
            };
            {
                let mut state = self.state.lock().unwrap();
                if failed && attempts + 1 < ATTEMPTS {
                    state.deezer.push_back((artist, attempts + 1));
                } else {
                    state.queued.remove(&format!("dz:{}", artist.id));
                }
            }
            if failed {
                tokio::time::sleep(FAILURE_PAUSE).await;
            }
        }
    }

    async fn run_apple(self: Arc<Self>) {
        loop {
            let artist = self.state.lock().unwrap().apple.pop_front();
            let Some((artist, attempts)) = artist else {
                self.apple_ready.notified().await;
                continue;
            };
            let failed = match self.apple.top_songs(&artist.name, &artist.albums).await {
                Fetched::Found(top) => {
                    self.store_apple(artist.id.clone(), Some(top));
                    false
                }
                Fetched::Missing => {
                    self.store_apple(artist.id.clone(), None);
                    false
                }
                Fetched::Failed => true,
            };
            {
                let mut state = self.state.lock().unwrap();
                if failed && attempts + 1 < ATTEMPTS {
                    state.apple.push_back((artist, attempts + 1));
                } else {
                    state.queued.remove(&format!("ap:{}", artist.id));
                }
            }
            if failed {
                tokio::time::sleep(FAILURE_PAUSE).await;
            }
        }
    }

    async fn run_flusher(self: Arc<Self>) {
        let mut flush = tokio::time::interval(FLUSH_EVERY);
        let mut last_save = tokio::time::Instant::now();
        loop {
            flush.tick().await;
            let (message, snapshot) = {
                let mut state = self.state.lock().unwrap();
                let message = (!state.changes.is_empty())
                    .then(|| std::mem::take(&mut state.changes).message(now_ms()).to_string());
                let due = state.unsaved && last_save.elapsed() >= SAVE_EVERY && self.path.is_some();
                let snapshot = due.then(|| serde_json::to_vec(&state.cache).ok()).flatten();
                if snapshot.is_some() {
                    state.unsaved = false;
                }
                (message, snapshot)
            };
            if let Some(message) = message {
                let _ = self.updates.send(message);
            }
            if let (Some(bytes), Some(path)) = (snapshot, &self.path) {
                last_save = tokio::time::Instant::now();
                // Write then rename, so a crash mid-write never leaves a truncated cache. The rename
                // only happens after a complete write: a half-written file must not replace the cache.
                let temporary = path.with_extension("tmp");
                let saved = match tokio::fs::write(&temporary, bytes).await {
                    Ok(()) => tokio::fs::rename(&temporary, path).await,
                    Err(error) => Err(error),
                };
                if let Err(error) = saved {
                    tracing::warn!(%error, path = %path.display(), "could not save the enrichment cache");
                    // Try again at the next save time instead of waiting for the next lookup.
                    self.state.lock().unwrap().unsaved = true;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GROUP: &str = "11111111-2222-4333-8444-555555555555";
    const ARTIST: &str = "66666666-7777-4888-9999-aaaaaaaaaaaa";

    fn request(since: u64) -> EnrichRequest {
        EnrichRequest {
            mb_search: Vec::new(),
            since,
            release_groups: vec![GROUP.into(), "not-an-id".into()],
            artists: vec![ArtistRequest {
                id: "nd-1".into(),
                name: "Glass Harbor".into(),
                songs: vec!["Lighthouse".into()],
                albums: vec!["Second Wind".into()],
            }],
        }
    }

    #[test]
    fn reads_the_services_to_ask() {
        assert_eq!(Sources::parse(None), Sources::default());
        assert_eq!(
            Sources::parse(Some(" MusicBrainz, apple ,nope")),
            Sources {
                musicbrainz: true,
                deezer: false,
                apple: true
            }
        );
        assert_eq!(
            Sources::parse(Some("")),
            Sources {
                musicbrainz: false,
                deezer: false,
                apple: false
            }
        );
    }

    #[test]
    fn never_queues_for_a_service_that_is_off() {
        let mut state = State {
            sources: Sources {
                musicbrainz: false,
                deezer: true,
                apple: false,
            },
            ..State::default()
        };
        state.answer(request(0), 1_000);
        assert!(state.musicbrainz.is_empty());
        assert!(state.apple.is_empty());
        assert_eq!(state.deezer.len(), 1);
    }

    #[test]
    fn queues_what_it_does_not_know_once() {
        let mut state = State::default();
        let reply = state.answer(request(0), 1_000);
        assert!(reply.is_empty());
        state.answer(request(0), 1_000);
        assert_eq!(state.musicbrainz.len(), 1);
        assert_eq!(state.deezer.len(), 1);
        assert_eq!(state.apple.len(), 1);
    }

    #[test]
    fn answers_only_what_changed_since_the_last_answer_and_queues_the_album_artist() {
        let mut state = State::default();
        let group = ReleaseGroup {
            artists: vec![ARTIST.into()],
            tags: vec![Tag("idm".into(), 9)],
        };
        state.cache.release_groups.insert(
            GROUP.into(),
            Entry {
                at: 500,
                value: Some(group.clone()),
            },
        );
        let reply = state.answer(request(0), 1_000);
        assert_eq!(reply.release_groups.get(GROUP), Some(&Some(group)));
        assert!(matches!(state.musicbrainz.front(), Some((MbJob::Artist(id), 0)) if id == ARTIST));
        assert!(state.answer(request(500), 1_000).release_groups.is_empty());
    }

    #[test]
    fn refreshes_stale_entries_and_retries_missing_ones_sooner() {
        let mut state = State::default();
        state
            .cache
            .release_groups
            .insert(GROUP.into(), Entry { at: 0, value: None });
        state.answer(request(0), MISSING_FRESH_MS - 1);
        assert!(state.musicbrainz.is_empty());
        state.answer(request(0), MISSING_FRESH_MS + 1);
        assert_eq!(state.musicbrainz.len(), 1);
    }
}
