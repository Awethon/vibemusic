mod account;
mod apple;
mod auth;
mod cover;
mod deezer;
mod enrich;
mod hub;
mod musicbrainz;
mod radio;
mod radio_meta;
mod share;
mod this_is;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc::unbounded_channel;

use auth::Navidrome;
use enrich::{EnrichRequest, Enricher};
use hub::Hub;

const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hello {
    token: String,
    device_id: String,
    name: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let navidrome_url = std::env::var("NAVIDROME_URL").unwrap_or_else(|_| "http://127.0.0.1:4533".into());
    let listen = std::env::var("LISTEN").unwrap_or_else(|_| "0.0.0.0:4600".into());
    let cache = std::env::var("ENRICHMENT_CACHE").unwrap_or_else(|_| "/data/enrichment.json".into());
    let cache = (!cache.is_empty()).then(|| std::path::PathBuf::from(cache));
    let enricher = Enricher::new(cache, apple::Apple::from_env(reqwest::Client::builder().timeout(Duration::from_secs(20)).build().expect("http client")));
    match this_is::Settings::from_env(&navidrome_url) {
        Some(settings) => this_is::start(settings, enricher.clone()),
        None => tracing::info!("This is playlists are off: set VIBEMUSIC_NAVIDROME_USER and VIBEMUSIC_NAVIDROME_PASSWORD to turn them on"),
    }
    let app = App { hub: Arc::default(), navidrome: Navidrome::new(navidrome_url.clone()), enricher, radio: Arc::new(radio::Radio::from_env(&navidrome_url)), shares: Arc::new(share::Shares::new(&navidrome_url)) };
    let router = Router::new().route("/relay", get(upgrade)).route("/radio/{id}", get(radio_stream)).route("/radio/{id}/now", get(radio_now)).route("/relay/share/{id}", get(share_info)).route("/relay/share/{id}/preview", get(share_preview)).route("/health", get(|| async { "ok" })).with_state(app);
    let listener = tokio::net::TcpListener::bind(&listen).await.expect("bind");
    tracing::info!(%listen, %navidrome_url, "relay listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serve");
}

async fn radio_stream(State(app): State<App>, Path(id): Path<String>, Query(query): Query<HashMap<String, String>>) -> Response {
    app.radio.stream(&id, &query).await
}

async fn radio_now(State(app): State<App>, Path(id): Path<String>) -> Response {
    app.radio.now(&id)
}

async fn share_info(State(app): State<App>, Path(id): Path<String>) -> Response {
    app.shares.info(&id).await
}

async fn share_preview(State(app): State<App>, Path(id): Path<String>, headers: axum::http::HeaderMap) -> Response {
    let host = headers.get("x-forwarded-host").or_else(|| headers.get(axum::http::header::HOST)).and_then(|value| value.to_str().ok()).unwrap_or("localhost");
    app.shares.preview(&id, host).await
}

async fn upgrade(State(app): State<App>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(move |socket| serve(app, socket))
}

async fn read_hello(socket: &mut WebSocket) -> Option<Hello> {
    let message = tokio::time::timeout(HELLO_TIMEOUT, socket.recv()).await.ok()??.ok()?;
    let Message::Text(text) = message else { return None };
    let value: Value = serde_json::from_str(&text).ok()?;
    if value["type"] != "hello" {
        return None;
    }
    let hello: Hello = serde_json::from_value(value).ok()?;
    let valid = !hello.device_id.is_empty() && hello.device_id.chars().count() <= MAX_DEVICE_ID_CHARS;
    valid.then_some(hello)
}

async fn serve(app: App, mut socket: WebSocket) {
    let Some(hello) = read_hello(&mut socket).await else { return };
    let Some(user) = app.navidrome.user_of(&hello.token).await else {
        let _ = socket.send(Message::Text(json!({ "type": "unauthorized" }).to_string().into())).await;
        return;
    };
    let name: String = hello.name.chars().take(MAX_NAME_CHARS).collect();
    let (outbox, mut inbox) = unbounded_channel::<String>();
    let replies = outbox.clone();
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
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
            }
        }
    });
    while let Some(Ok(message)) = stream.next().await {
        let Message::Text(text) = message else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
        if value["type"] == "enrich" {
            if let Ok(request) = serde_json::from_value::<EnrichRequest>(value) {
                let _ = replies.send(app.enricher.request(request));
            }
            continue;
        }
        app.hub.lock().unwrap().receive(&user, &hello.device_id, &value);
    }
    app.hub.lock().unwrap().leave(&user, &hello.device_id, connection);
    writer.abort();
    tracing::info!(user, device = hello.device_id, "device disconnected");
}
