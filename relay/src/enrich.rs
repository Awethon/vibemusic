use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{Notify, broadcast};

use crate::{deezer, musicbrainz};

const MUSICBRAINZ_PAUSE: Duration = Duration::from_millis(1100);
const FAILURE_PAUSE: Duration = Duration::from_secs(30);
const FLUSH_EVERY: Duration = Duration::from_secs(2);
const SAVE_EVERY: Duration = Duration::from_secs(30);
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const MUSICBRAINZ_FRESH_MS: u64 = 30 * DAY_MS;
const DEEZER_FRESH_MS: u64 = 14 * DAY_MS;
const MISSING_FRESH_MS: u64 = 7 * DAY_MS;
const MAX_RELEASE_GROUPS: usize = 100_000;
const MAX_ARTISTS: usize = 50_000;
const MAX_SONGS: usize = 5;
const MAX_TEXT_CHARS: usize = 200;
const ATTEMPTS: u8 = 5;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Tag(pub String, pub u32);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ReleaseGroup {
    pub artists: Vec<String>,
    pub tags: Vec<Tag>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MbArtist {
    pub tags: Vec<Tag>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DeezerArtist {
    pub id: u64,
    pub name: String,
    pub fans: u64,
    pub top: Vec<(String, u64)>,
}

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

#[derive(Serialize, Deserialize, Clone)]
struct Entry<T> {
    at: u64,
    value: Option<T>,
}

impl<T> Entry<T> {
    fn fresh(&self, now: u64, fresh_ms: u64) -> bool {
        now.saturating_sub(self.at) < if self.value.is_some() { fresh_ms } else { MISSING_FRESH_MS }
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Cache {
    release_groups: HashMap<String, Entry<ReleaseGroup>>,
    mb_artists: HashMap<String, Entry<MbArtist>>,
    deezer: HashMap<String, Entry<DeezerArtist>>,
}

#[derive(Deserialize, Clone)]
pub struct ArtistRequest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub songs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichRequest {
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
}

#[derive(Default)]
struct Changes {
    release_groups: HashMap<String, Option<ReleaseGroup>>,
    mb_artists: HashMap<String, Option<MbArtist>>,
    deezer: HashMap<String, Option<DeezerArtist>>,
}

impl Changes {
    fn is_empty(&self) -> bool {
        self.release_groups.is_empty() && self.mb_artists.is_empty() && self.deezer.is_empty()
    }

    fn message(&self, at: u64) -> Value {
        json!({ "type": "enrichment", "at": at, "releaseGroups": self.release_groups, "mbArtists": self.mb_artists, "deezer": self.deezer })
    }
}

#[derive(Default)]
struct State {
    cache: Cache,
    musicbrainz: VecDeque<(MbJob, u8)>,
    deezer: VecDeque<(ArtistRequest, u8)>,
    queued: HashSet<String>,
    changes: Changes,
    unsaved: bool,
}

pub struct Enricher {
    state: Mutex<State>,
    musicbrainz_ready: Notify,
    deezer_ready: Notify,
    updates: broadcast::Sender<String>,
    client: reqwest::Client,
    path: Option<PathBuf>,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as u64).unwrap_or(0)
}

fn valid_mbid(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|character| character.is_ascii_hexdigit() || character == '-')
}

fn clip(text: &str) -> String {
    text.chars().take(MAX_TEXT_CHARS).collect()
}

impl State {
    fn queue_musicbrainz(&mut self, job: MbJob) {
        let key = match &job {
            MbJob::ReleaseGroup(id) => format!("rg:{id}"),
            MbJob::Artist(id) => format!("ar:{id}"),
        };
        if self.queued.insert(key) {
            self.musicbrainz.push_back((job, 0));
        }
    }

    fn queue_deezer(&mut self, artist: ArtistRequest) {
        if self.queued.insert(format!("dz:{}", artist.id)) {
            self.deezer.push_back((artist, 0));
        }
    }

    fn needs_artist(&self, id: &str, now: u64) -> bool {
        self.cache.mb_artists.get(id).is_none_or(|entry| !entry.fresh(now, MUSICBRAINZ_FRESH_MS))
    }

    fn answer(&mut self, request: EnrichRequest, now: u64) -> Changes {
        let mut reply = Changes::default();
        for id in request.release_groups.into_iter().filter(|id| valid_mbid(id)).take(MAX_RELEASE_GROUPS) {
            let entry = self.cache.release_groups.get(&id).cloned();
            match entry {
                Some(entry) => {
                    if !entry.fresh(now, MUSICBRAINZ_FRESH_MS) {
                        self.queue_musicbrainz(MbJob::ReleaseGroup(id.clone()));
                    }
                    if let Some(artist) = entry.value.as_ref().and_then(|group| group.artists.first()) {
                        if let Some(found) = self.cache.mb_artists.get(artist).filter(|found| found.at > request.since) {
                            reply.mb_artists.insert(artist.clone(), found.value.clone());
                        }
                        if self.needs_artist(artist, now) {
                            self.queue_musicbrainz(MbJob::Artist(artist.clone()));
                        }
                    }
                    if entry.at > request.since {
                        reply.release_groups.insert(id, entry.value);
                    }
                }
                None => self.queue_musicbrainz(MbJob::ReleaseGroup(id)),
            }
        }
        for artist in request.artists.into_iter().filter(|artist| !artist.id.is_empty() && !artist.name.trim().is_empty()).take(MAX_ARTISTS) {
            let artist = ArtistRequest { id: clip(&artist.id), name: clip(&artist.name), songs: artist.songs.iter().take(MAX_SONGS).map(|title| clip(title)).collect() };
            match self.cache.deezer.get(&artist.id) {
                Some(entry) => {
                    if entry.at > request.since {
                        reply.deezer.insert(artist.id.clone(), entry.value.clone());
                    }
                    if !entry.fresh(now, DEEZER_FRESH_MS) {
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
    pub fn new(path: Option<PathBuf>) -> Arc<Self> {
        let cache = path.as_ref().and_then(|path| std::fs::read(path).ok()).and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        let (updates, _) = broadcast::channel(64);
        let enricher = Arc::new(Self {
            state: Mutex::new(State { cache, ..State::default() }),
            musicbrainz_ready: Notify::new(),
            deezer_ready: Notify::new(),
            updates,
            client: reqwest::Client::builder().timeout(Duration::from_secs(20)).build().expect("http client"),
            path,
        });
        tokio::spawn(enricher.clone().run_musicbrainz());
        tokio::spawn(enricher.clone().run_deezer());
        tokio::spawn(enricher.clone().run_flusher());
        enricher
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.updates.subscribe()
    }

    pub fn request(&self, request: EnrichRequest) -> String {
        let now = now_ms();
        let (reply, musicbrainz, deezer) = {
            let mut state = self.state.lock().unwrap();
            let reply = state.answer(request, now);
            (reply, !state.musicbrainz.is_empty(), !state.deezer.is_empty())
        };
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

    fn store_deezer(&self, id: String, value: Option<DeezerArtist>) {
        let mut state = self.state.lock().unwrap();
        state.changes.deezer.insert(id.clone(), value.clone());
        state.cache.deezer.insert(id, Entry { at: now_ms(), value });
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
                if failed && attempts + 1 < ATTEMPTS {
                    state.musicbrainz.push_back((job, attempts + 1));
                } else {
                    state.queued.remove(&key);
                }
            }
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

    async fn run_flusher(self: Arc<Self>) {
        let mut flush = tokio::time::interval(FLUSH_EVERY);
        let mut last_save = tokio::time::Instant::now();
        loop {
            flush.tick().await;
            let (message, snapshot) = {
                let mut state = self.state.lock().unwrap();
                let message = (!state.changes.is_empty()).then(|| std::mem::take(&mut state.changes).message(now_ms()).to_string());
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
                let temporary = path.with_extension("tmp");
                if let Err(error) = tokio::fs::write(&temporary, bytes).await.and(tokio::fs::rename(&temporary, path).await) {
                    tracing::warn!(%error, path = %path.display(), "could not save the enrichment cache");
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
            since,
            release_groups: vec![GROUP.into(), "not-an-id".into()],
            artists: vec![ArtistRequest { id: "nd-1".into(), name: "Glass Harbor".into(), songs: vec!["Lighthouse".into()] }],
        }
    }

    #[test]
    fn queues_what_it_does_not_know_once() {
        let mut state = State::default();
        let reply = state.answer(request(0), 1_000);
        assert!(reply.is_empty());
        state.answer(request(0), 1_000);
        assert_eq!(state.musicbrainz.len(), 1);
        assert_eq!(state.deezer.len(), 1);
    }

    #[test]
    fn answers_only_what_changed_since_the_last_answer_and_queues_the_album_artist() {
        let mut state = State::default();
        let group = ReleaseGroup { artists: vec![ARTIST.into()], tags: vec![Tag("idm".into(), 9)] };
        state.cache.release_groups.insert(GROUP.into(), Entry { at: 500, value: Some(group.clone()) });
        let reply = state.answer(request(0), 1_000);
        assert_eq!(reply.release_groups.get(GROUP), Some(&Some(group)));
        assert!(matches!(state.musicbrainz.front(), Some((MbJob::Artist(id), 0)) if id == ARTIST));
        assert!(state.answer(request(500), 1_000).release_groups.is_empty());
    }

    #[test]
    fn refreshes_stale_entries_and_retries_missing_ones_sooner() {
        let mut state = State::default();
        state.cache.release_groups.insert(GROUP.into(), Entry { at: 0, value: None });
        state.answer(request(0), MISSING_FRESH_MS - 1);
        assert!(state.musicbrainz.is_empty());
        state.answer(request(0), MISSING_FRESH_MS + 1);
        assert_eq!(state.musicbrainz.len(), 1);
    }
}
