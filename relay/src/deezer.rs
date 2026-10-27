use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde_json::Value;

use crate::enrich::{DeezerArtist, Fetched};

const BASE: &str = "https://api.deezer.com";
const PAUSE: Duration = Duration::from_millis(250);
const QUOTA_PAUSE: Duration = Duration::from_secs(6);
const ATTEMPTS: usize = 3;
const SEARCHED_SONGS: usize = 3;
const ARTIST_CANDIDATES: usize = 3;
const TOP_SONGS: usize = 100;

fn letters(text: &str) -> String {
    text.to_lowercase().replace('ё', "е").chars().filter(|character| character.is_alphanumeric()).collect()
}

pub fn title_key(title: &str) -> String {
    let mut depth = 0usize;
    let mut kept = String::new();
    for character in title.chars() {
        match character {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => kept.push(character),
            _ => {}
        }
    }
    letters(kept.split(" - ").next().unwrap_or_default())
}

async fn get(client: &reqwest::Client, path: &str, query: &[(&str, &str)]) -> Option<Value> {
    for _ in 0..ATTEMPTS {
        tokio::time::sleep(PAUSE).await;
        let Ok(response) = client.get(format!("{BASE}/{path}")).query(query).send().await else { continue };
        let Some(value) = response.bytes().await.ok().and_then(|body| serde_json::from_slice::<Value>(&body).ok()) else { continue };
        if value["error"].is_object() {
            if value["error"]["code"] == 4 {
                tokio::time::sleep(QUOTA_PAUSE).await;
                continue;
            }
            return None;
        }
        return Some(value);
    }
    None
}

pub fn artist_of_song(results: &Value, title: &str) -> Option<u64> {
    let songs = results["data"].as_array()?;
    let titled = |key: fn(&str) -> String| {
        let wanted = key(title);
        songs.iter().find(|song| song["title"].as_str().is_some_and(|found| key(found) == wanted))
    };
    titled(letters).or_else(|| titled(title_key))?["artist"]["id"].as_u64()
}

fn top_songs(value: &Value) -> Vec<(String, u64)> {
    value["data"].as_array().into_iter().flatten().filter_map(|song| Some((song["title"].as_str()?.to_owned(), song["rank"].as_u64().unwrap_or(0)))).collect()
}

fn overlaps(top: &[(String, u64)], titles: &HashSet<String>) -> bool {
    top.iter().any(|(title, _)| titles.contains(&title_key(title)))
}

async fn by_songs(client: &reqwest::Client, name: &str, songs: &[String]) -> Option<u64> {
    let mut votes: HashMap<u64, usize> = HashMap::new();
    for title in songs.iter().take(SEARCHED_SONGS) {
        let query = format!("{name} {title}");
        let Some(results) = get(client, "search", &[("q", &query), ("limit", "10")]).await else { continue };
        if let Some(id) = artist_of_song(&results, title) {
            *votes.entry(id).or_default() += 1;
        }
    }
    votes.into_iter().max_by_key(|&(id, count)| (count, std::cmp::Reverse(id))).map(|(id, _)| id)
}

async fn by_name(client: &reqwest::Client, name: &str, titles: &HashSet<String>) -> Option<(u64, Vec<(String, u64)>)> {
    let found = get(client, "search/artist", &[("q", name), ("limit", "10")]).await?;
    let mut candidates: Vec<(u64, u64)> = found["data"].as_array()?.iter().filter_map(|artist| Some((artist["id"].as_u64()?, artist["nb_fan"].as_u64().unwrap_or(0)))).collect();
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.1));
    for (id, _) in candidates.into_iter().take(ARTIST_CANDIDATES) {
        let top = top_songs(&get(client, &format!("artist/{id}/top"), &[("limit", &TOP_SONGS.to_string())]).await?);
        if overlaps(&top, titles) {
            return Some((id, top));
        }
    }
    None
}

pub async fn find_artist(client: &reqwest::Client, name: &str, songs: &[String]) -> Fetched<DeezerArtist> {
    let titles: HashSet<String> = songs.iter().map(|title| title_key(title)).filter(|key| !key.is_empty()).collect();
    let (id, top) = match by_songs(client, name, songs).await {
        Some(id) => match get(client, &format!("artist/{id}/top"), &[("limit", &TOP_SONGS.to_string())]).await {
            Some(value) => (id, top_songs(&value)),
            None => return Fetched::Failed,
        },
        None => match by_name(client, name, &titles).await {
            Some(found) => found,
            None => return Fetched::Missing,
        },
    };
    let Some(artist) = get(client, &format!("artist/{id}"), &[]).await else { return Fetched::Failed };
    Fetched::Found(DeezerArtist { id, name: artist["name"].as_str().unwrap_or_default().to_owned(), fans: artist["nb_fan"].as_u64().unwrap_or(0), top })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn title_keys_ignore_case_punctuation_and_extras() {
        assert_eq!(title_key("Lights On a Hill"), title_key("Lights on a Hill (Remastered)"));
        assert_eq!(title_key("Undertow - Live at Harbour Hall"), "undertow");
        assert_eq!(title_key("Ёжик [Bonus Track]"), "ежик");
        assert_eq!(title_key("Рассвет"), "рассвет");
    }

    #[test]
    fn takes_the_artist_of_the_song_with_the_same_title_not_a_cover() {
        let results = json!({ "data": [
            { "title": "Lights On A Hill (as made famous by Lume)", "artist": { "id": 304872 } },
            { "title": "Lights On a Hill", "artist": { "id": 1327 } }
        ] });
        assert_eq!(artist_of_song(&results, "Lights on a Hill"), Some(1327));
        assert_eq!(artist_of_song(&results, "Driftwood"), None);
    }
}
