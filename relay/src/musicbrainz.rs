use std::collections::HashSet;
use std::time::Duration;

use serde_json::Value;

use crate::deezer::title_key;
use crate::enrich::{Fetched, MbArtist, ReleaseGroup, Tag};

const BASE: &str = "https://musicbrainz.org/ws/2";
const USER_AGENT: &str = concat!(
    "vibemusic-relay/",
    env!("CARGO_PKG_VERSION"),
    " ( self-hosted music player )"
);

pub const PAUSE: Duration = Duration::from_millis(1500);
const SEARCH_CANDIDATES: usize = 3;

async fn get(client: &reqwest::Client, path: &str) -> Fetched<Value> {
    get_with(client, path, &[]).await
}

async fn get_with(client: &reqwest::Client, path: &str, query: &[(&str, &str)]) -> Fetched<Value> {
    let response = match client
        .get(format!("{BASE}/{path}"))
        .query(query)
        .header("user-agent", USER_AGENT)
        .header("accept", "application/json")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(%error, path, "musicbrainz unreachable");
            return Fetched::Failed;
        }
    };
    match response.status().as_u16() {
        200 => match response
            .bytes()
            .await
            .ok()
            .and_then(|body| serde_json::from_slice(&body).ok())
        {
            Some(value) => Fetched::Found(value),
            None => Fetched::Failed,
        },
        400 | 404 => Fetched::Missing,
        status => {
            tracing::warn!(status, path, "musicbrainz lookup failed");
            Fetched::Failed
        }
    }
}

pub fn tags_in(value: &Value) -> Vec<Tag> {
    let mut tags: Vec<Tag> = value["tags"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tag| {
            Some(Tag(
                tag["name"].as_str()?.to_owned(),
                tag["count"].as_u64()?.try_into().ok()?,
            ))
        })
        .filter(|tag| tag.1 > 0)
        .collect();
    tags.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    tags
}

pub fn credited_artists(value: &Value) -> Vec<String> {
    value["artist-credit"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|credit| credit["artist"]["id"].as_str().map(str::to_owned))
        .collect()
}

pub async fn release_group(client: &reqwest::Client, id: &str) -> Fetched<ReleaseGroup> {
    get(client, &format!("release-group/{id}?inc=tags+artist-credits&fmt=json"))
        .await
        .map(|value| ReleaseGroup {
            artists: credited_artists(&value),
            tags: tags_in(&value),
        })
}

pub fn countries_in(value: &Value) -> Vec<String> {
    let mut codes: Vec<String> = Vec::new();
    let mut add = |code: &str| {
        let country = code.split('-').next().unwrap_or_default().to_uppercase();
        if country.len() == 2 && !codes.contains(&country) {
            codes.push(country);
        }
    };
    if let Some(country) = value["country"].as_str() {
        add(country);
    }
    for place in ["area", "begin-area"] {
        for list in ["iso-3166-1-codes", "iso-3166-2-codes"] {
            for code in value[place][list]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                add(code);
            }
        }
    }
    codes
}

pub async fn artist(client: &reqwest::Client, id: &str) -> Fetched<MbArtist> {
    get(client, &format!("artist/{id}?inc=tags&fmt=json"))
        .await
        .map(|value| MbArtist {
            tags: tags_in(&value),
            countries: Some(countries_in(&value)),
        })
}

pub async fn find_artist(client: &reqwest::Client, name: &str, albums: &[String]) -> Fetched<String> {
    let wanted: HashSet<String> = albums
        .iter()
        .map(|album| title_key(album))
        .filter(|key| !key.is_empty())
        .collect();
    let query = format!("artist:\"{0}\" OR alias:\"{0}\"", name.replace('"', ""));
    let found = match get_with(client, "artist", &[("query", &query), ("limit", "5"), ("fmt", "json")]).await {
        Fetched::Found(found) => found,
        Fetched::Missing => return Fetched::Missing,
        Fetched::Failed => return Fetched::Failed,
    };
    let candidates: Vec<String> = found["artists"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|artist| artist["id"].as_str().map(str::to_owned))
        .take(SEARCH_CANDIDATES)
        .collect();
    for id in candidates {
        tokio::time::sleep(PAUSE).await;
        let groups = match get_with(
            client,
            "release-group",
            &[("artist", &id), ("limit", "100"), ("fmt", "json")],
        )
        .await
        {
            Fetched::Found(groups) => groups,
            Fetched::Missing => continue,
            Fetched::Failed => return Fetched::Failed,
        };
        let titles = groups["release-groups"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|group| group["title"].as_str());
        if titles.map(title_key).any(|title| wanted.contains(&title)) {
            return Fetched::Found(id);
        }
    }
    Fetched::Missing
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_tags_strongest_first_and_drops_downvoted_ones() {
        let value = json!({ "tags": [{ "name": "rock", "count": 1 }, { "name": "nu metal", "count": 4 }, { "name": "pop", "count": -2 }] });
        let tags: Vec<(String, u32)> = tags_in(&value).into_iter().map(|tag| (tag.0, tag.1)).collect();
        assert_eq!(tags, [("nu metal".to_owned(), 4), ("rock".to_owned(), 1)]);
    }

    #[test]
    fn reads_countries_from_where_the_artist_is_based_and_was_born() {
        let based_abroad = json!({ "country": "ES", "area": { "iso-3166-1-codes": ["ES"] }, "begin-area": { "iso-3166-2-codes": ["RU-SPE"] } });
        assert_eq!(countries_in(&based_abroad), ["ES", "RU"]);
        let moved_away = json!({ "country": "US", "begin-area": { "iso-3166-2-codes": ["GB-HNS"] } });
        assert_eq!(countries_in(&moved_away), ["US", "GB"]);
        assert!(countries_in(&json!({})).is_empty());
    }

    #[test]
    fn reads_credited_artists_in_order() {
        let value =
            json!({ "artist-credit": [{ "artist": { "id": "a" } }, { "joinphrase": " & ", "artist": { "id": "b" } }] });
        assert_eq!(credited_artists(&value), ["a", "b"]);
    }
}
