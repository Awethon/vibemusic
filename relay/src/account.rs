use serde_json::{Value, json};

const PAGE_SIZE: usize = 2000;
const CLIENT_NAME: &str = "vibemusic-relay";

#[derive(Debug)]
pub struct AccountError(pub String);

impl std::fmt::Display for AccountError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl<E: std::error::Error> From<E> for AccountError {
    fn from(error: E) -> Self {
        AccountError(error.to_string())
    }
}

pub struct Account {
    client: reqwest::Client,
    url: String,
    pub id: String,
    token: String,
    subsonic: Vec<(&'static str, String)>,
}

impl Account {
    pub async fn sign_in(
        client: reqwest::Client,
        url: &str,
        username: &str,
        password: &str,
    ) -> Result<Self, AccountError> {
        let url = url.trim_end_matches('/').to_owned();
        let login: Value = client
            .post(format!("{url}/auth/login"))
            .json(&json!({ "username": username, "password": password }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let text = |key: &str| {
            login[key]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| AccountError(format!("login reply has no {key}")))
        };
        let subsonic = vec![
            ("u", text("username")?),
            ("t", text("subsonicToken")?),
            ("s", text("subsonicSalt")?),
            ("v", "1.16.1".to_owned()),
            ("c", CLIENT_NAME.to_owned()),
            ("f", "json".to_owned()),
        ];
        Ok(Self {
            client,
            id: text("id")?,
            token: text("token")?,
            url,
            subsonic,
        })
    }

    fn native(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{}/api/{path}", self.url))
            .header("x-nd-authorization", format!("Bearer {}", self.token))
    }

    pub async fn all(&self, path: &str) -> Result<Vec<Value>, AccountError> {
        let separator = if path.contains('?') { '&' } else { '?' };
        let mut items = Vec::new();
        loop {
            let response = self
                .native(
                    reqwest::Method::GET,
                    &format!(
                        "{path}{separator}_start={}&_end={}",
                        items.len(),
                        items.len() + PAGE_SIZE
                    ),
                )
                .send()
                .await?
                .error_for_status()?;
            let total: Option<usize> = response
                .headers()
                .get("x-total-count")
                .and_then(|value| value.to_str().ok()?.parse().ok());
            let page: Vec<Value> = response.json().await?;
            let done = page.is_empty();
            items.extend(page);
            if done || total.is_none_or(|total| items.len() >= total) {
                return Ok(items);
            }
        }
    }

    pub async fn update_playlist(&self, id: &str, name: &str, comment: &str) -> Result<(), AccountError> {
        self.native(reqwest::Method::PUT, &format!("playlist/{id}"))
            .json(&json!({ "name": name, "comment": comment, "public": true }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn delete_playlist(&self, id: &str) -> Result<(), AccountError> {
        self.native(reqwest::Method::DELETE, &format!("playlist/{id}"))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn upload_cover(&self, playlist_id: &str, jpeg: Vec<u8>) -> Result<(), AccountError> {
        let part = reqwest::multipart::Part::bytes(jpeg)
            .file_name("cover.jpg")
            .mime_str("image/jpeg")?;
        self.native(reqwest::Method::POST, &format!("playlist/{playlist_id}/image"))
            .multipart(reqwest::multipart::Form::new().part("image", part))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn subsonic(&self, method: &str, params: &[(&str, String)]) -> Result<Value, AccountError> {
        let form: Vec<(&str, String)> = self.subsonic.iter().cloned().chain(params.iter().cloned()).collect();
        let reply: Value = self
            .client
            .post(format!("{}/rest/{method}", self.url))
            .form(&form)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let reply = reply["subsonic-response"].clone();
        if reply["status"] != "ok" {
            return Err(AccountError(format!("{method}: {}", reply["error"])));
        }
        Ok(reply)
    }

    pub async fn cover_art(&self, id: &str, size: u32) -> Result<Vec<u8>, AccountError> {
        let mut query = self.subsonic.clone();
        query.push(("id", id.to_owned()));
        query.push(("size", size.to_string()));
        Ok(self
            .client
            .get(format!("{}/rest/getCoverArt", self.url))
            .query(&query)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?
            .to_vec())
    }
}
