use std::time::Duration;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::Value;

const MARKER: &str = "window.__SHARE_INFO__ = ";
const TIMEOUT: Duration = Duration::from_secs(15);

pub struct Shares {
    client: reqwest::Client,
    navidrome: String,
}

impl Shares {
    pub fn new(navidrome: &str) -> Self {
        Self { client: reqwest::Client::builder().timeout(TIMEOUT).build().expect("http client"), navidrome: navidrome.trim_end_matches('/').to_owned() }
    }

    pub async fn info(&self, id: &str) -> Response {
        if id.is_empty() || !id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_') {
            return StatusCode::NOT_FOUND.into_response();
        }
        let page = match self.client.get(format!("{}/share/{id}", self.navidrome)).send().await {
            Ok(page) => page,
            Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
        };
        match page.status().as_u16() {
            200 => {}
            404 => return StatusCode::NOT_FOUND.into_response(),
            410 => return StatusCode::GONE.into_response(),
            _ => return StatusCode::BAD_GATEWAY.into_response(),
        }
        let Ok(html) = page.text().await else { return StatusCode::BAD_GATEWAY.into_response() };
        match share_info_in(&html) {
            Some(info) => Json(info).into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        }
    }
}

pub fn share_info_in(html: &str) -> Option<Value> {
    let start = html.find(MARKER)? + MARKER.len();
    let line = html[start..].lines().next()?.trim().trim_end_matches(';');
    let text: String = serde_json::from_str(line).ok()?;
    serde_json::from_str(&text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_share_navidrome_embeds_in_its_page() {
        let html = "<script>\n      window.__SHARE_INFO__ = \"{\\\"id\\\":\\\"ab\\\",\\\"description\\\":\\\"Weekend\\\",\\\"tracks\\\":[{\\\"id\\\":\\\"t.k\\\",\\\"title\\\":\\\"Undertow \\u003c3\\\"}]}\"\n</script>";
        let info = share_info_in(html).unwrap();
        assert_eq!(info["description"], "Weekend");
        assert_eq!(info["tracks"][0]["title"], "Undertow <3");
        assert!(share_info_in("<html></html>").is_none());
    }
}
