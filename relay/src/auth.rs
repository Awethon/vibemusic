//! Checks a user's Navidrome token for the `/relay` WebSocket (`NAVIDROME_URL`).
//!
//! The relay does not know Navidrome's signing secret, so Navidrome itself validates the token.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;

#[derive(Deserialize)]
struct Claims {
    uid: String,
}

#[derive(Clone)]
pub struct Navidrome {
    client: reqwest::Client,
    url: String,
}

impl Navidrome {
    pub fn new(url: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            url: url.trim_end_matches('/').to_owned(),
        }
    }

    /// The Navidrome user id the token belongs to, or `None` if Navidrome rejects the token.
    /// The id becomes the remote-control room, so all tabs of one user meet there.
    pub async fn user_of(&self, token: &str) -> Option<String> {
        // keepalive is the cheapest authenticated endpoint of Navidrome's native API.
        let response = self
            .client
            .get(format!("{}/api/keepalive/keepalive", self.url))
            .header("x-nd-authorization", format!("Bearer {token}"))
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        // Navidrome accepted the token, so its payload can be trusted without checking the
        // signature here. `uid` is the user id claim in Navidrome's JWT.
        user_id_in(token)
    }
}

fn user_id_in(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let claims: Claims = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    Some(claims.uid).filter(|uid| !uid.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_user_id_from_a_navidrome_token() {
        let payload = URL_SAFE_NO_PAD.encode(r#"{"adm":false,"sub":"friend","uid":"u-42"}"#);
        assert_eq!(
            user_id_in(&format!("header.{payload}.signature")).as_deref(),
            Some("u-42")
        );
        assert_eq!(user_id_in("not-a-token"), None);
    }
}
