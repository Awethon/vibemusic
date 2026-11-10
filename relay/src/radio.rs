//! Internet radio proxy: streams the stations configured in Navidrome through the relay and
//! keeps track of what each one is playing.
//!
//! Browsers only let the Web Audio API analyse cross-origin audio when the station sends CORS
//! headers, which most do not. Served from the relay, the stream is same-origin for the app.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Json;
use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use serde_json::Value;

use crate::radio_meta::{IcyStripper, NowPlaying, OggTags};

// Subsonic credentials the app adds to the stream URL. The relay asks Navidrome for the station
// list with them, so it needs no account of its own and only users Navidrome accepts can stream.
const AUTH_PARAMS: [&str; 5] = ["u", "t", "s", "v", "c"];
// Only connecting is time-limited: a radio stream never ends, so a total timeout would cut it.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Radio {
    client: reqwest::Client,
    navidrome: String,
    local_proxy: Option<String>,
    // Per station: open streams and the last song heard. The entry goes away with the last stream.
    playing: Arc<Mutex<HashMap<String, (usize, NowPlaying)>>>,
}

// One open stream of a station. Dropped with the response body, which ends its count.
struct Listener {
    playing: Arc<Mutex<HashMap<String, (usize, NowPlaying)>>>,
    station: String,
}

impl Listener {
    fn join(playing: Arc<Mutex<HashMap<String, (usize, NowPlaying)>>>, station: &str) -> Self {
        playing.lock().unwrap().entry(station.to_owned()).or_default().0 += 1;
        Self {
            playing,
            station: station.to_owned(),
        }
    }

    fn heard(&self, now: NowPlaying) {
        if let Some(entry) = self.playing.lock().unwrap().get_mut(&self.station) {
            entry.1 = now;
        }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        let mut playing = self.playing.lock().unwrap();
        if let Some(entry) = playing.get_mut(&self.station) {
            entry.0 -= 1;
            if entry.0 == 0 {
                playing.remove(&self.station);
            }
        }
    }
}

impl Radio {
    pub fn from_env(navidrome: &str) -> Self {
        let local_proxy = std::env::var("RADIO_LOCAL_PROXY")
            .ok()
            .filter(|value| !value.is_empty())
            .map(|value| value.trim_end_matches('/').to_owned());
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .user_agent(concat!("vibemusic-relay/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self {
            client,
            navidrome: navidrome.trim_end_matches('/').to_owned(),
            local_proxy,
            playing: Arc::default(),
        }
    }

    // The station URL comes from Navidrome, never from the request: the client only names a
    // station id, so the relay cannot be used to fetch arbitrary URLs.
    async fn station_url(&self, id: &str, query: &HashMap<String, String>) -> Result<String, StatusCode> {
        let mut params: Vec<(&str, &str)> = AUTH_PARAMS
            .iter()
            .filter_map(|key| query.get(*key).map(|value| (*key, value.as_str())))
            .collect();
        params.push(("f", "json"));
        let reply: Value = self
            .client
            .get(format!("{}/rest/getInternetRadioStations", self.navidrome))
            .query(&params)
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?
            .json()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        let reply = &reply["subsonic-response"];
        if reply["status"] != "ok" {
            return Err(StatusCode::UNAUTHORIZED);
        }
        reply["internetRadioStations"]["internetRadioStation"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|station| station["id"] == id)
            .and_then(|station| station["streamUrl"].as_str())
            .map(str::to_owned)
            .ok_or(StatusCode::NOT_FOUND)
    }

    pub async fn stream(&self, id: &str, query: &HashMap<String, String>) -> Response {
        let url = match self.station_url(id, query).await {
            Ok(url) => url,
            Err(status) => return status.into_response(),
        };
        let (url, host) = through_local_proxy(&url, self.local_proxy.as_deref());
        // Ask Shoutcast/Icecast servers to interleave now-playing metadata into the stream. They
        // answer with `icy-metaint` (audio bytes between metadata blocks), and the blocks are cut
        // out before the audio reaches the browser, which would otherwise play them as noise.
        let mut request = self.client.get(&url).header("Icy-MetaData", "1");
        if let Some(host) = host {
            request = request.header(header::HOST, host);
        }
        let upstream = match request.send().await {
            Ok(upstream) if upstream.status().is_success() => upstream,
            Ok(upstream) => {
                tracing::warn!(id, status = upstream.status().as_u16(), "radio station refused");
                return StatusCode::BAD_GATEWAY.into_response();
            }
            Err(error) => {
                tracing::warn!(id, %error, "radio station unreachable");
                return StatusCode::BAD_GATEWAY.into_response();
            }
        };
        let Some(content_type) = audio_type(upstream.headers().get(header::CONTENT_TYPE)) else {
            tracing::warn!(id, kind = ?upstream.headers().get(header::CONTENT_TYPE), "radio station did not send audio");
            return StatusCode::BAD_GATEWAY.into_response();
        };
        let every = upstream
            .headers()
            .get("icy-metaint")
            .and_then(|value| value.to_str().ok()?.parse::<usize>().ok())
            .filter(|&every| every > 0);
        // Ogg streams (Opus, Vorbis) carry the song in their comment headers instead of ICY blocks.
        let ogg = content_type.to_str().is_ok_and(|kind| kind.contains("ogg"));
        let mut stripper = every.map(IcyStripper::new);
        let mut tags = ogg.then(OggTags::default);
        let listener = Listener::join(self.playing.clone(), id);
        let body = upstream.bytes_stream().map(move |chunk| {
            let chunk = chunk?;
            let (audio, now) = match (&mut stripper, &mut tags) {
                (Some(stripper), _) => {
                    let (audio, now) = stripper.feed(&chunk);
                    (axum::body::Bytes::from(audio), now)
                }
                (None, Some(tags)) => {
                    let now = tags.feed(&chunk);
                    (chunk, now)
                }
                (None, None) => (chunk, None),
            };
            if let Some(now) = now {
                listener.heard(now);
            }
            Ok::<_, reqwest::Error>(audio)
        });
        let mut response = Body::from_stream(body).into_response();
        response.headers_mut().insert(header::CONTENT_TYPE, content_type);
        // Keeps a browser from deciding by itself that the bytes are a page after all.
        response
            .headers_mut()
            .insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response
    }
}

/// The content type to answer with: the station's own when it names audio, `audio/mpeg` when it
/// names none, and `None` for anything else. The stream is served from the app's own address, so a
/// station (or whoever answers in its place) that sent `text/html` would get a page there, with
/// the listener's stored sign-in within its reach.
fn audio_type(sent: Option<&HeaderValue>) -> Option<HeaderValue> {
    let Some(sent) = sent else {
        return Some(HeaderValue::from_static("audio/mpeg"));
    };
    let kind = sent.to_str().ok()?.split(';').next()?.trim().to_ascii_lowercase();
    (kind.starts_with("audio/") || kind == "application/ogg").then(|| sent.clone())
}

impl Radio {
    /// The last song heard on a station, empty if nobody is streaming it through the relay. Only
    /// known while a stream is open, since the metadata is read from that stream.
    pub fn now(&self, id: &str) -> Response {
        Json(
            self.playing
                .lock()
                .unwrap()
                .get(id)
                .map(|entry| entry.1.clone())
                .unwrap_or_default(),
        )
        .into_response()
    }
}

/// With `RADIO_LOCAL_PROXY` set, stations on `.local` (mDNS) hosts are fetched through that
/// proxy with the original `Host` header. A relay in a container usually cannot resolve `.local`
/// names; a proxy on the host network can. Other URLs are returned unchanged.
pub fn through_local_proxy(url: &str, proxy: Option<&str>) -> (String, Option<String>) {
    let (Some(proxy), Ok(parsed)) = (proxy, reqwest::Url::parse(url)) else {
        return (url.to_owned(), None);
    };
    let Some(host) = parsed.host_str().filter(|host| host.ends_with(".local")) else {
        return (url.to_owned(), None);
    };
    let host = match parsed.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_owned(),
    };
    let rest = &url[parsed.origin().ascii_serialization().len()..];
    (format!("{proxy}{rest}"), Some(host))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_lan_only_hosts_through_the_local_proxy() {
        assert_eq!(
            through_local_proxy("http://music.local/radio/stream.example/opus", Some("http://caddy")),
            (
                "http://caddy/radio/stream.example/opus".to_owned(),
                Some("music.local".to_owned())
            )
        );
        assert_eq!(
            through_local_proxy("https://stream.example/opus", Some("http://caddy")),
            ("https://stream.example/opus".to_owned(), None)
        );
        assert_eq!(
            through_local_proxy("http://music.local/opus", None),
            ("http://music.local/opus".to_owned(), None)
        );
    }

    #[test]
    fn passes_on_audio_types_only() {
        let sent = |kind: &'static str| audio_type(Some(&HeaderValue::from_static(kind)));
        for kind in ["audio/mpeg", "audio/aacp", "Audio/Ogg; codecs=opus", "application/ogg"] {
            assert_eq!(sent(kind), Some(HeaderValue::from_static(kind)));
        }
        for kind in [
            "text/html",
            "text/html; charset=utf-8",
            "application/octet-stream",
            "image/svg+xml",
            "",
        ] {
            assert_eq!(sent(kind), None, "{kind}");
        }
        assert_eq!(audio_type(None), Some(HeaderValue::from_static("audio/mpeg")));
    }
}
