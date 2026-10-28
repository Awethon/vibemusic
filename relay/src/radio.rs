use std::collections::HashMap;
use std::time::Duration;

use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::Value;

const AUTH_PARAMS: [&str; 5] = ["u", "t", "s", "v", "c"];
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Radio {
    client: reqwest::Client,
    navidrome: String,
    local_proxy: Option<String>,
}

impl Radio {
    pub fn from_env(navidrome: &str) -> Self {
        let local_proxy = std::env::var("RADIO_LOCAL_PROXY").ok().filter(|value| !value.is_empty()).map(|value| value.trim_end_matches('/').to_owned());
        let client = reqwest::Client::builder().connect_timeout(CONNECT_TIMEOUT).user_agent(concat!("vibemusic-relay/", env!("CARGO_PKG_VERSION"))).build().expect("http client");
        Self { client, navidrome: navidrome.trim_end_matches('/').to_owned(), local_proxy }
    }

    async fn station_url(&self, id: &str, query: &HashMap<String, String>) -> Result<String, StatusCode> {
        let mut params: Vec<(&str, &str)> = AUTH_PARAMS.iter().filter_map(|key| query.get(*key).map(|value| (*key, value.as_str()))).collect();
        params.push(("f", "json"));
        let reply: Value = self.client.get(format!("{}/rest/getInternetRadioStations", self.navidrome)).query(&params).send().await.map_err(|_| StatusCode::BAD_GATEWAY)?.json().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
        let reply = &reply["subsonic-response"];
        if reply["status"] != "ok" {
            return Err(StatusCode::UNAUTHORIZED);
        }
        reply["internetRadioStations"]["internetRadioStation"].as_array().into_iter().flatten().find(|station| station["id"] == id).and_then(|station| station["streamUrl"].as_str()).map(str::to_owned).ok_or(StatusCode::NOT_FOUND)
    }

    pub async fn stream(&self, id: &str, query: &HashMap<String, String>) -> Response {
        let url = match self.station_url(id, query).await {
            Ok(url) => url,
            Err(status) => return status.into_response(),
        };
        let (url, host) = through_local_proxy(&url, self.local_proxy.as_deref());
        let mut request = self.client.get(&url);
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
        let content_type = upstream.headers().get(header::CONTENT_TYPE).cloned().unwrap_or(HeaderValue::from_static("audio/mpeg"));
        let mut response = Body::from_stream(upstream.bytes_stream()).into_response();
        response.headers_mut().insert(header::CONTENT_TYPE, content_type);
        response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response
    }
}

pub fn through_local_proxy(url: &str, proxy: Option<&str>) -> (String, Option<String>) {
    let (Some(proxy), Ok(parsed)) = (proxy, reqwest::Url::parse(url)) else { return (url.to_owned(), None) };
    let Some(host) = parsed.host_str().filter(|host| host.ends_with(".local")) else { return (url.to_owned(), None) };
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
        assert_eq!(through_local_proxy("http://music.local/radio/stream.example/opus", Some("http://caddy")), ("http://caddy/radio/stream.example/opus".to_owned(), Some("music.local".to_owned())));
        assert_eq!(through_local_proxy("https://stream.example/opus", Some("http://caddy")), ("https://stream.example/opus".to_owned(), None));
        assert_eq!(through_local_proxy("http://music.local/opus", None), ("http://music.local/opus".to_owned(), None));
    }
}
