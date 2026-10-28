use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde_json::Value;

use crate::enrich::{DeezerArtist, Fetched};

const BASE: &str = "https://api.deezer.com";
const PAUSE: Duration = Duration::from_millis(250);
const QUOTA_PAUSE: Duration = Duration::from_secs(6);
const ATTEMPTS: usize = 3;
const SEARCHED_SONGS: usize = 5;
const ARTIST_CANDIDATES: usize = 3;
const TOP_SONGS: usize = 100;
const MIN_FANS_BY_NAME: u64 = 1000;
const NO_DATA: i64 = 800;
const FEATURING: [&str; 8] = [" feat.", " feat ", " ft.", " ft ", " featuring ", " при уч", " при участии", " w/ "];

fn letters(text: &str) -> String {
    text.to_lowercase().replace('ё', "е").chars().filter(|character| character.is_alphanumeric()).collect()
}

pub fn song_name(title: &str) -> String {
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
    let lower = format!("{} ", kept.split(" - ").next().unwrap_or_default().to_lowercase());
    let end = FEATURING.iter().filter_map(|marker| lower.find(marker)).min().unwrap_or(lower.len());
    lower[..end].trim().to_owned()
}

pub fn title_key(title: &str) -> String {
    letters(&song_name(title))
}

const RECORDING: [&str; 20] = [
    "remix", "rmx", "mix", "live", "instrumental", "acoustic", "unplugged", "demo", "cover", "karaoke", "rework", "bootleg", "reprise", "ремикс", "микс", "кавер", "инструментал", "акустика", "лайв", "концерт",
];

pub fn is_other_recording(title: &str) -> bool {
    let mut depth = 0usize;
    let mut extra = String::new();
    for character in title.chars() {
        match character {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth > 0 => extra.push(character),
            _ => {}
        }
    }
    let mut parts = title.splitn(2, " - ");
    parts.next();
    extra.push(' ');
    extra.push_str(parts.next().unwrap_or_default());
    extra.to_lowercase().split(|character: char| !character.is_alphanumeric()).any(|word| RECORDING.contains(&word))
}

pub fn song_rank(top: &[(String, u64)], title: &str) -> Option<u64> {
    let exact = letters(title);
    if let Some((_, rank)) = top.iter().find(|(found, _)| letters(found) == exact) {
        return Some(*rank);
    }
    if is_other_recording(title) {
        return None;
    }
    let loose = title_key(title);
    top.iter().find(|(found, _)| !is_other_recording(found) && title_key(found) == loose).map(|(_, rank)| *rank)
}

struct Unavailable;

async fn get(client: &reqwest::Client, path: &str, query: &[(&str, &str)]) -> Result<Value, Unavailable> {
    for _ in 0..ATTEMPTS {
        tokio::time::sleep(PAUSE).await;
        let Ok(response) = client.get(format!("{BASE}/{path}")).query(query).send().await else { continue };
        let Some(value) = response.bytes().await.ok().and_then(|body| serde_json::from_slice::<Value>(&body).ok()) else { continue };
        match value["error"]["code"].as_i64() {
            None => return Ok(value),
            Some(NO_DATA) => return Ok(Value::Null),
            Some(4) => tokio::time::sleep(QUOTA_PAUSE).await,
            Some(code) => tracing::warn!(code, path, "deezer lookup failed"),
        }
    }
    Err(Unavailable)
}

pub fn artist_of_song(results: &Value, title: &str) -> Option<u64> {
    let songs = results["data"].as_array()?;
    let titled = |key: fn(&str) -> String| {
        let wanted = key(title);
        songs.iter().find(|song| song["title"].as_str().is_some_and(|found| key(found) == wanted))
    };
    titled(letters).or_else(|| titled(title_key))?["artist"]["id"].as_u64()
}

fn albums_of(value: &Value) -> Vec<(String, i64)> {
    value["data"].as_array().into_iter().flatten().filter_map(|album| Some((album["title"].as_str()?.to_owned(), album["genre_id"].as_i64().unwrap_or(-1)))).collect()
}

fn top_songs(value: &Value) -> Vec<(String, u64)> {
    value["data"].as_array().into_iter().flatten().filter_map(|song| Some((song["title"].as_str()?.to_owned(), song["rank"].as_u64().unwrap_or(0)))).collect()
}

fn overlaps(top: &[(String, u64)], titles: &HashSet<String>) -> bool {
    top.iter().any(|(title, _)| titles.contains(&title_key(title)))
}

async fn top_of(client: &reqwest::Client, id: u64) -> Result<Vec<(String, u64)>, Unavailable> {
    Ok(top_songs(&get(client, &format!("artist/{id}/top"), &[("limit", &TOP_SONGS.to_string())]).await?))
}

async fn by_songs(client: &reqwest::Client, name: &str, songs: &[String]) -> Result<Option<u64>, Unavailable> {
    let mut votes: HashMap<u64, usize> = HashMap::new();
    let mut unavailable = false;
    for title in songs.iter().take(SEARCHED_SONGS) {
        let query = format!("{name} {}", song_name(title));
        match get(client, "search", &[("q", &query), ("limit", "10")]).await {
            Ok(results) => {
                if let Some(id) = artist_of_song(&results, title) {
                    *votes.entry(id).or_default() += 1;
                }
            }
            Err(Unavailable) => unavailable = true,
        }
    }
    match votes.into_iter().max_by_key(|&(id, count)| (count, std::cmp::Reverse(id))) {
        Some((id, _)) => Ok(Some(id)),
        None if unavailable => Err(Unavailable),
        None => Ok(None),
    }
}

pub fn same_name(candidates: &[(u64, String, u64)], name: &str) -> Option<u64> {
    let wanted = letters(name);
    candidates.iter().filter(|(_, found, fans)| *fans >= MIN_FANS_BY_NAME && letters(found) == wanted).max_by_key(|(_, _, fans)| *fans).map(|(id, _, _)| *id)
}

async fn by_name(client: &reqwest::Client, name: &str, titles: &HashSet<String>) -> Result<Option<(u64, Vec<(String, u64)>)>, Unavailable> {
    let found = get(client, "search/artist", &[("q", name), ("limit", "10")]).await?;
    let mut candidates: Vec<(u64, String, u64)> = found["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|artist| Some((artist["id"].as_u64()?, artist["name"].as_str().unwrap_or_default().to_owned(), artist["nb_fan"].as_u64().unwrap_or(0))))
        .collect();
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.2));
    for (id, _, _) in candidates.iter().take(ARTIST_CANDIDATES) {
        let top = top_of(client, *id).await?;
        if overlaps(&top, titles) {
            return Ok(Some((*id, top)));
        }
    }
    match same_name(&candidates, name) {
        Some(id) => Ok(Some((id, top_of(client, id).await?))),
        None => Ok(None),
    }
}

pub async fn find_artist(client: &reqwest::Client, name: &str, songs: &[String]) -> Fetched<DeezerArtist> {
    let titles: HashSet<String> = songs.iter().map(|title| title_key(title)).filter(|key| !key.is_empty()).collect();
    let found = match by_songs(client, name, songs).await {
        Ok(Some(id)) => top_of(client, id).await.map(|top| Some((id, top))),
        Ok(None) => by_name(client, name, &titles).await,
        Err(unavailable) => Err(unavailable),
    };
    let (id, top) = match found {
        Ok(Some(found)) => found,
        Ok(None) => return Fetched::Missing,
        Err(Unavailable) => return Fetched::Failed,
    };
    let Ok(artist) = get(client, &format!("artist/{id}"), &[]).await else { return Fetched::Failed };
    let Ok(albums) = get(client, &format!("artist/{id}/albums"), &[("limit", &TOP_SONGS.to_string())]).await else { return Fetched::Failed };
    Fetched::Found(DeezerArtist { id, name: artist["name"].as_str().unwrap_or_default().to_owned(), fans: artist["nb_fan"].as_u64().unwrap_or(0), top, albums: Some(albums_of(&albums)) })
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
        assert_eq!(title_key("Тихий город при уч. Иван Петров"), "тихийгород");
        assert_eq!(title_key("Night Drive feat. Sam Rivers"), "nightdrive");
        assert_eq!(song_name("Наше интро при уч.  Иван Петров и Игорь"), "наше интро");
    }

    #[test]
    fn ranks_songs_by_title_without_lending_scores_to_remixes() {
        let top = [("Paper Moon".to_owned(), 693_944), ("Small Hours (Album Version)".to_owned(), 321_967)];
        assert_eq!(song_rank(&top, "Paper Moon (Remastered)"), Some(693_944));
        assert_eq!(song_rank(&top, "Paper Moon (Night Owl club mix)"), None);
        assert_eq!(song_rank(&top, "Small Hours"), Some(321_967));
        assert_eq!(song_rank(&top, "Driftwood"), None);
    }

    #[test]
    fn trusts_a_name_alone_only_for_an_established_artist() {
        let candidates = [(1, "Lume".to_owned(), 87), (2, "ДК-12".to_owned(), 21_043), (3, "DK-12".to_owned(), 1_913)];
        assert_eq!(same_name(&candidates, "Lume"), None);
        assert_eq!(same_name(&candidates, "ДК-12"), Some(2));
        assert_eq!(same_name(&candidates, "дк 12"), Some(2));
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
