//! Public Navidrome shares: their track list as JSON for the app's share page, and an HTML page
//! with Open Graph tags so chat apps can show a link preview.
//!
//! Navidrome has no JSON endpoint for a public share; the data is read from its share web page.

use std::time::Duration;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use serde_json::Value;

// Navidrome's share page assigns the share to this variable in an inline script.
const MARKER: &str = "window.__SHARE_INFO__ = ";
const TIMEOUT: Duration = Duration::from_secs(15);
// og:image and the warm-up request must use the same query, or the warmed image is not the one
// that gets fetched.
const COVER_QUERY: &str = "size=300&square=true";
const COVER_ATTEMPTS: usize = 2;

pub struct Shares {
    client: reqwest::Client,
    navidrome: String,
}

impl Shares {
    pub fn new(navidrome: &str) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(TIMEOUT)
                .build()
                .expect("http client"),
            navidrome: navidrome.trim_end_matches('/').to_owned(),
        }
    }

    pub async fn info(&self, id: &str) -> Response {
        match self.load(id).await {
            Ok(info) => Json(info).into_response(),
            Err(status) => status.into_response(),
        }
    }

    pub async fn preview(&self, id: &str, host: &str) -> Response {
        match self.load(id).await {
            Ok(info) => {
                if let Some(token) = info["tracks"][0]["id"].as_str() {
                    self.warm_cover(token).await;
                }
                Html(preview_page(&info, id, host)).into_response()
            }
            Err(status) => status.into_response(),
        }
    }

    // Requests the cover once before the preview is returned. Navidrome resizes images on first
    // request and caches the result, so the link-preview service fetching og:image right after
    // gets a cached image instead of waiting on a resize. Failures are ignored.
    async fn warm_cover(&self, token: &str) {
        let url = format!("{}/share/img/{token}?{COVER_QUERY}", self.navidrome);
        for _ in 0..COVER_ATTEMPTS {
            if self
                .client
                .get(&url)
                .send()
                .await
                .is_ok_and(|response| response.status().is_success())
            {
                return;
            }
        }
    }

    async fn load(&self, id: &str) -> Result<Value, StatusCode> {
        // The id goes into a Navidrome URL path, so only accept the characters share ids use.
        if id.is_empty()
            || !id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
        {
            return Err(StatusCode::NOT_FOUND);
        }
        let page = self
            .client
            .get(format!("{}/share/{id}", self.navidrome))
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        match page.status().as_u16() {
            200 => {}
            404 => return Err(StatusCode::NOT_FOUND),
            // Navidrome answers 410 for an expired share.
            410 => return Err(StatusCode::GONE),
            _ => return Err(StatusCode::BAD_GATEWAY),
        }
        let html = page.text().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
        share_info_in(&html).ok_or(StatusCode::NOT_FOUND)
    }
}

/// The share embedded in Navidrome's share page. The value is a JavaScript string literal that
/// holds JSON, so it is decoded twice: once as a JSON string, then as the JSON inside it.
pub fn share_info_in(html: &str) -> Option<Value> {
    let start = html.find(MARKER)? + MARKER.len();
    let line = html[start..].lines().next()?.trim().trim_end_matches(';');
    let text: String = serde_json::from_str(line).ok()?;
    serde_json::from_str(&text).ok()
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// A minimal HTML page with Open Graph and Twitter card tags for a share. One track reads as a
/// song ("Title · Artist", album or "Single", length); several read as a playlist (count, total
/// minutes). Links assume the app is served over https on `host`.
pub fn preview_page(info: &Value, id: &str, host: &str) -> String {
    let tracks = info["tracks"].as_array().map(Vec::as_slice).unwrap_or_default();
    let text = |value: &Value| value.as_str().unwrap_or_default().to_owned();
    let first = tracks.first();
    let description = text(&info["description"]);
    let title = match first {
        Some(track) if description.is_empty() => format!("{} · {}", text(&track["title"]), text(&track["artist"])),
        _ if description.is_empty() => "Shared music".to_owned(),
        _ => description,
    };
    let minutes = (tracks
        .iter()
        .filter_map(|track| track["duration"].as_f64())
        .sum::<f64>()
        / 60.0)
        .round();
    let summary = match tracks {
        [track] => {
            let album = text(&track["album"]);
            let length = track["duration"]
                .as_f64()
                // Rounded once, as a whole: rounding only the seconds part turned 59.6 s into "0:00".
                .map(|seconds| seconds.round() as u64)
                .map(|seconds| format!("{}:{:02}", seconds / 60, seconds % 60))
                .unwrap_or_default();
            let release = if album.is_empty() || album.trim().eq_ignore_ascii_case(text(&track["title"]).trim()) {
                "Single".to_owned()
            } else {
                album
            };
            [release, length]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" · ")
        }
        _ => format!("{} tracks · {minutes} min", tracks.len()),
    };
    let base = format!("https://{host}");
    let url = format!("{base}/share/{id}");
    let image = first.map(|track| format!("{base}/share/img/{}?{COVER_QUERY}", text(&track["id"])));
    let kind = if tracks.len() == 1 {
        "music.song"
    } else {
        "music.playlist"
    };
    let mut head = vec![
        format!("<title>{}</title>", escape(&title)),
        r#"<meta property="og:site_name" content="vibemusic">"#.to_owned(),
        format!(r#"<meta property="og:type" content="{kind}">"#),
        format!(r#"<meta property="og:title" content="{}">"#, escape(&title)),
        format!(r#"<meta property="og:description" content="{}">"#, escape(&summary)),
        format!(r#"<meta name="description" content="{}">"#, escape(&summary)),
        format!(r#"<meta property="og:url" content="{}">"#, escape(&url)),
        r#"<meta name="twitter:card" content="summary">"#.to_owned(),
    ];
    if let Some(image) = image {
        head.push(format!(r#"<meta property="og:image" content="{}">"#, escape(&image)));
        head.push(
            r#"<meta property="og:image:width" content="300"><meta property="og:image:height" content="300">"#
                .to_owned(),
        );
    }
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">{}</head><body><a href=\"{}\">{}</a></body></html>",
        head.join(""),
        escape(&url),
        escape(&title)
    )
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

    #[test]
    fn writes_preview_tags_for_chat_apps() {
        let info = serde_json::json!({ "description": "Undertow · Glass Harbor", "tracks": [{ "id": "t.k", "title": "Undertow", "artist": "Glass Harbor", "album": "Second Wind <Live>", "duration": 252.0 }] });
        let page = preview_page(&info, "ab", "music.example.com");
        assert!(page.contains(r#"<meta property="og:title" content="Undertow · Glass Harbor">"#));
        assert!(page.contains(r#"<meta property="og:description" content="Second Wind &lt;Live&gt; · 4:12">"#));
        assert!(page.contains(
            r#"<meta property="og:image" content="https://music.example.com/share/img/t.k?size=300&amp;square=true">"#
        ));
        let several = serde_json::json!({ "description": "", "tracks": [{ "title": "A", "artist": "X", "duration": 90.0 }, { "title": "B", "artist": "Y", "duration": 90.0 }] });
        assert!(preview_page(&several, "cd", "h").contains(r#"content="2 tracks · 3 min""#));
        let single = serde_json::json!({ "tracks": [{ "id": "t", "title": "Lantern", "artist": "Low Tide", "album": "Lantern", "duration": 283.4 }] });
        assert!(
            preview_page(&single, "ef", "h").contains(r#"<meta property="og:description" content="Single · 4:43">"#)
        );
    }

    #[test]
    fn text_from_navidrome_cannot_add_markup_to_the_preview() {
        let hostile = r#""><script>alert('x')</script>&"#;
        let pages_for = |text: &str| {
            let song = serde_json::json!({ "tracks": [{ "id": text, "title": text, "artist": text, "album": format!("{text} (live)"), "duration": 60.0 }] });
            let playlist =
                serde_json::json!({ "description": text, "tracks": [{ "id": text, "title": text }, { "id": text }] });
            preview_page(&song, text, text) + &preview_page(&playlist, text, text)
        };
        let (plain, attacked) = (pages_for("Lume"), pages_for(hostile));
        // Escaped text adds none of the characters that open or close a tag or an attribute.
        for mark in ['<', '>', '"'] {
            assert_eq!(
                attacked.matches(mark).count(),
                plain.matches(mark).count(),
                "{mark} from a share got into the page"
            );
        }
        assert!(attacked.contains(
            r#"<meta property="og:title" content="&quot;&gt;&lt;script&gt;alert('x')&lt;/script&gt;&amp;">"#
        ));
    }

    #[test]
    fn a_track_length_carries_rounded_seconds_into_the_minute() {
        let summary_of = |seconds: f64| {
            let info = serde_json::json!({ "tracks": [{ "id": "t", "title": "Lantern", "artist": "Low Tide", "album": "Harbor Lights", "duration": seconds }] });
            preview_page(&info, "ab", "h")
        };
        assert!(summary_of(59.6).contains(r#"content="Harbor Lights · 1:00""#));
        assert!(summary_of(239.5).contains(r#"content="Harbor Lights · 4:00""#));
        assert!(summary_of(239.4).contains(r#"content="Harbor Lights · 3:59""#));
    }
}
