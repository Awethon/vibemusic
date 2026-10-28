use std::collections::HashSet;
use std::time::Duration;

use serde_json::Value;

use crate::deezer::title_key;
use crate::enrich::Fetched;

const SEARCH: &str = "https://itunes.apple.com/search";
const LOOKUP: &str = "https://itunes.apple.com/lookup";
const CANDIDATES: usize = 3;
const TOP_SONGS: usize = 50;
const ATTEMPTS: usize = 3;
const BUSY_PAUSE: Duration = Duration::from_secs(30);

pub struct Apple {
    client: reqwest::Client,
    pause: Duration,
    storefronts: Vec<String>,
}

impl Apple {
    pub fn new(client: reqwest::Client, pause: Duration, storefronts: Vec<String>) -> Self {
        Self { client, pause, storefronts }
    }

    pub fn from_env(client: reqwest::Client) -> Self {
        let pause = std::env::var("APPLE_PAUSE_MS").ok().and_then(|value| value.parse().ok()).unwrap_or(3200);
        let storefronts = std::env::var("APPLE_STOREFRONTS").unwrap_or_else(|_| "us,ru".into()).split(',').map(|code| code.trim().to_lowercase()).filter(|code| !code.is_empty()).collect();
        Self::new(client, Duration::from_millis(pause), storefronts)
    }

    async fn get(&self, url: &str, query: &[(&str, String)]) -> Option<Value> {
        for _ in 0..ATTEMPTS {
            tokio::time::sleep(self.pause).await;
            let Ok(response) = self.client.get(url).query(query).send().await else { continue };
            if response.status().as_u16() == 403 || response.status().as_u16() == 429 {
                tracing::warn!(status = response.status().as_u16(), "apple asks to slow down");
                tokio::time::sleep(BUSY_PAUSE).await;
                continue;
            }
            if let Some(value) = response.bytes().await.ok().and_then(|body| serde_json::from_slice(&body).ok()) {
                return Some(value);
            }
        }
        None
    }

    async fn albums_of(&self, artist_id: u64, storefront: &str) -> Option<Vec<String>> {
        let reply = self.get(LOOKUP, &[("id", artist_id.to_string()), ("entity", "album".into()), ("limit", "200".into()), ("country", storefront.into())]).await?;
        Some(results(&reply, "collection", "collectionName"))
    }

    async fn artist(&self, name: &str, albums: &HashSet<String>, storefront: &str) -> Fetched<u64> {
        let Some(found) = self.get(SEARCH, &[("term", name.into()), ("entity", "musicArtist".into()), ("limit", "5".into()), ("country", storefront.into())]).await else { return Fetched::Failed };
        let candidates: Vec<u64> = found["results"].as_array().into_iter().flatten().filter(|item| item["wrapperType"] == "artist").filter_map(|item| item["artistId"].as_u64()).take(CANDIDATES).collect();
        for id in candidates {
            let Some(discography) = self.albums_of(id, storefront).await else { return Fetched::Failed };
            if discography.iter().any(|album| albums.contains(&title_key(album))) {
                return Fetched::Found(id);
            }
        }
        Fetched::Missing
    }

    pub async fn top_songs(&self, name: &str, album_names: &[String]) -> Fetched<Vec<String>> {
        let albums: HashSet<String> = album_names.iter().map(|album| title_key(album)).filter(|key| !key.is_empty()).collect();
        for storefront in &self.storefronts {
            let id = match self.artist(name, &albums, storefront).await {
                Fetched::Found(id) => id,
                Fetched::Missing => continue,
                Fetched::Failed => return Fetched::Failed,
            };
            let reply = self.get(LOOKUP, &[("id", id.to_string()), ("entity", "song".into()), ("sort", "popular".into()), ("limit", TOP_SONGS.to_string()), ("country", storefront.clone())]).await;
            return match reply {
                Some(value) => Fetched::Found(results(&value, "track", "trackName")),
                None => Fetched::Failed,
            };
        }
        Fetched::Missing
    }
}

fn results(value: &Value, wrapper: &str, field: &str) -> Vec<String> {
    value["results"].as_array().into_iter().flatten().filter(|item| item["wrapperType"] == wrapper).filter_map(|item| item[field].as_str().map(str::to_owned)).collect()
}

pub fn ranked(titles: &[String]) -> Vec<(String, u64)> {
    titles.iter().enumerate().map(|(index, title)| (title.clone(), (titles.len() - index) as u64)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_only_the_wanted_kind_of_result() {
        let value = json!({ "results": [{ "wrapperType": "artist", "artistName": "ДК-12" }, { "wrapperType": "collection", "collectionName": "Old Harbour" }] });
        assert_eq!(results(&value, "collection", "collectionName"), ["Old Harbour"]);
    }

    #[test]
    fn ranks_the_first_title_highest() {
        assert_eq!(ranked(&["Белый город".into(), "Тихий двор".into()]), [("Белый город".to_owned(), 2), ("Тихий двор".to_owned(), 1)]);
    }
}
