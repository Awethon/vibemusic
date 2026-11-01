//! vibemusic relay: an optional companion server for the vibemusic web app.
//!
//! Routes:
//! - `GET /relay`: WebSocket for remote control between a user's tabs and devices (see
//!   `protocol.rs`), plus enrichment requests and broadcasts (see `enrich.rs`).
//! - `GET /radio/{id}`: streams a Navidrome internet radio station through the relay, so it is
//!   same-origin for the app's Web Audio graph. `GET /radio/{id}/now`: its current song.
//! - `GET /relay/share/{id}`: JSON for a public Navidrome share. `GET /relay/share/{id}/preview`:
//!   an HTML page with Open Graph tags for link previews of that share.
//! - `GET /health`: liveness check.
//!
//! Environment (all optional):
//! - `NAVIDROME_URL` (default `http://127.0.0.1:4533`): the Navidrome the relay talks to.
//! - `LISTEN` (default `0.0.0.0:4600`): address to bind.
//! - `ENRICHMENT_CACHE` (default `/data/enrichment.json`): enrichment cache file; set it empty to
//!   keep the cache in memory only.
//! - `APPLE_PAUSE_MS`, `APPLE_STOREFRONTS`: see `apple.rs`.
//! - `RADIO_LOCAL_PROXY`: see `radio.rs`.
//! - `VIBEMUSIC_RELAY_NAVIDROME_USER`, `VIBEMUSIC_RELAY_NAVIDROME_PASSWORD`: turn on "This is" playlists;
//!   `THIS_IS_STATE`, `THIS_IS_MIN_TRACKS`, `THIS_IS_MAX_TRACKS`, `THIS_IS_EVERY_HOURS` and
//!   `THIS_IS_SKIP` tune them (see `this_is.rs`).
//! - `RUST_LOG`: log filter (default `info`).

mod account;
mod apple;
mod auth;
mod cover;
mod deezer;
mod enrich;
mod hub;
mod musicbrainz;
mod protocol;
mod radio;
mod radio_meta;
mod share;
mod this_is;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use std::collections::HashMap;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::Response;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc::unbounded_channel;

use auth::Navidrome;
use enrich::Enricher;
use hub::Hub;
use protocol::{ClientMessage, ServerMessage};

// A socket that does not authenticate in time is closed, so unauthenticated sockets cannot pile up.
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
// WebSocket pings keep reverse proxies from closing a quiet socket.
const PING_EVERY: Duration = Duration::from_secs(25);
const MAX_NAME_CHARS: usize = 60;
const MAX_DEVICE_ID_CHARS: usize = 64;

#[derive(Clone)]
struct App {
    hub: Arc<Mutex<Hub>>,
    navidrome: Navidrome,
    enricher: Arc<Enricher>,
    radio: Arc<radio::Radio>,
    shares: Arc<share::Shares>,
}

struct Hello {
    token: String,
    device_id: String,
    name: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let navidrome_url = std::env::var("NAVIDROME_URL").unwrap_or_else(|_| "http://127.0.0.1:4533".into());
    let listen = std::env::var("LISTEN").unwrap_or_else(|_| "0.0.0.0:4600".into());
    let cache = std::env::var("ENRICHMENT_CACHE").unwrap_or_else(|_| "/data/enrichment.json".into());
    let cache = (!cache.is_empty()).then(|| std::path::PathBuf::from(cache));
    let enricher = Enricher::new(
        cache,
        apple::Apple::from_env(
            reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()
                .expect("http client"),
        ),
    );
    match this_is::Settings::from_env(&navidrome_url) {
        Some(settings) => this_is::start(settings, enricher.clone()),
        None => tracing::info!(
            "This is playlists are off: set VIBEMUSIC_RELAY_NAVIDROME_USER and VIBEMUSIC_RELAY_NAVIDROME_PASSWORD to turn them on"
        ),
    }
    let app = App {
        hub: Arc::default(),
        navidrome: Navidrome::new(navidrome_url.clone()),
        enricher,
        radio: Arc::new(radio::Radio::from_env(&navidrome_url)),
        shares: Arc::new(share::Shares::new(&navidrome_url)),
    };
    let router = Router::new()
        .route("/relay", get(upgrade))
        .route("/radio/{id}", get(radio_stream))
        .route("/radio/{id}/now", get(radio_now))
        .route("/relay/share/{id}", get(share_info))
        .route("/relay/share/{id}/preview", get(share_preview))
        .route("/health", get(|| async { "ok" }))
        .with_state(app);
    let listener = tokio::net::TcpListener::bind(&listen).await.expect("bind");
    tracing::info!(%listen, %navidrome_url, "relay listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serve");
}

async fn radio_stream(
    State(app): State<App>,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    app.radio.stream(&id, &query).await
}

async fn radio_now(State(app): State<App>, Path(id): Path<String>) -> Response {
    app.radio.now(&id)
}

async fn share_info(State(app): State<App>, Path(id): Path<String>) -> Response {
    app.shares.info(&id).await
}

async fn share_preview(State(app): State<App>, Path(id): Path<String>, headers: axum::http::HeaderMap) -> Response {
    // Open Graph URLs must be absolute and public. Behind a reverse proxy the public host is in
    // X-Forwarded-Host; `Host` may be the relay's internal address.
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(axum::http::header::HOST))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("localhost");
    app.shares.preview(&id, host).await
}

async fn upgrade(State(app): State<App>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(move |socket| serve(app, socket))
}

async fn read_hello(socket: &mut WebSocket) -> Option<Hello> {
    let message = tokio::time::timeout(HELLO_TIMEOUT, socket.recv()).await.ok()??.ok()?;
    let Message::Text(text) = message else { return None };
    let Ok(ClientMessage::Hello { token, device_id, name }) = serde_json::from_str(&text) else {
        return None;
    };
    let hello = Hello { token, device_id, name };
    let valid = !hello.device_id.is_empty() && hello.device_id.chars().count() <= MAX_DEVICE_ID_CHARS;
    valid.then_some(hello)
}

async fn serve(app: App, mut socket: WebSocket) {
    let Some(hello) = read_hello(&mut socket).await else {
        return;
    };
    let Some(user) = app.navidrome.user_of(&hello.token).await else {
        let _ = socket
            .send(Message::Text(ServerMessage::Unauthorized.to_text().into()))
            .await;
        return;
    };
    let name: String = hello.name.chars().take(MAX_NAME_CHARS).collect();
    let (outbox, mut inbox) = unbounded_channel::<String>();
    // Enrichment replies go only to this socket, through the same outbox as hub messages.
    let replies = outbox.clone();
    // Enrichment updates are broadcast to every connected socket, whatever the user: they hold
    // public metadata about artists and albums, not anything private to a user.
    let mut updates = app.enricher.subscribe();
    let connection = app.hub.lock().unwrap().join(&user, &hello.device_id, &name, outbox);
    tracing::info!(user, device = hello.device_id, name, "device connected");
    let (mut sink, mut stream) = socket.split();
    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(PING_EVERY);
        loop {
            tokio::select! {
                text = inbox.recv() => match text {
                    Some(text) => if sink.send(Message::Text(text.into())).await.is_err() { break },
                    None => break,
                },
                _ = ping.tick() => if sink.send(Message::Ping(Default::default())).await.is_err() { break },
                update = updates.recv() => match update {
                    Ok(text) => if sink.send(Message::Text(text.into())).await.is_err() { break },
                    // A slow socket skips the broadcasts it missed instead of being disconnected.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
            }
        }
    });
    while let Some(Ok(message)) = stream.next().await {
        let Message::Text(text) = message else { continue };
        match serde_json::from_str::<ClientMessage>(&text) {
            Ok(ClientMessage::Enrich(request)) => {
                let _ = replies.send(app.enricher.request(request));
            }
            Ok(message) => app.hub.lock().unwrap().receive(&user, &hello.device_id, message),
            Err(error) => tracing::debug!(%error, "ignored a message the relay does not understand"),
        }
    }
    app.hub.lock().unwrap().leave(&user, &hello.device_id, connection);
    writer.abort();
    tracing::info!(user, device = hello.device_id, "device disconnected");
}
