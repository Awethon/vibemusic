mod auth;
mod hub;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc::unbounded_channel;

use auth::Navidrome;
use hub::Hub;

const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
const PING_EVERY: Duration = Duration::from_secs(25);
const MAX_NAME_CHARS: usize = 60;
const MAX_DEVICE_ID_CHARS: usize = 64;

#[derive(Clone)]
struct App {
    hub: Arc<Mutex<Hub>>,
    navidrome: Navidrome,
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
    let app = App { hub: Arc::default(), navidrome: Navidrome::new(navidrome_url.clone()) };
    let router = Router::new().route("/relay", get(upgrade)).route("/health", get(|| async { "ok" })).with_state(app);
    let listener = tokio::net::TcpListener::bind(&listen).await.expect("bind");
    tracing::info!(%listen, %navidrome_url, "relay listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("serve");
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
            }
        }
    });
    while let Some(Ok(message)) = stream.next().await {
        let Message::Text(text) = message else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
        app.hub.lock().unwrap().receive(&user, &hello.device_id, &value);
    }
    app.hub.lock().unwrap().leave(&user, &hello.device_id, connection);
    writer.abort();
    tracing::info!(user, device = hello.device_id, "device disconnected");
}
