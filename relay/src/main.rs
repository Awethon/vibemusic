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
//! - `ENRICHMENT_SOURCES` (default `musicbrainz,deezer,apple`): the outside services enrichment and
//!   "This is" playlists may ask; set it empty to ask none (see `enrich.rs`).
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
use std::time::{Duration, Instant};

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
// A device that sends nothing for this long is gone, even if its socket still looks open: a laptop
// that went to sleep never closes it. Browsers answer the pings above even in a throttled
// background tab, and the app sends its own every 25 seconds, so a live device is never this quiet.
const SILENCE_LIMIT: Duration = Duration::from_secs(70);
const MAX_NAME_CHARS: usize = 60;
const MAX_DEVICE_ID_CHARS: usize = 64;

#[derive(Clone)]
struct App {
    hub: Arc<Mutex<Hub>>,
    navidrome: Navidrome,
    enricher: Arc<Enricher>,
    radio: Arc<radio::Radio>,
    shares: Arc<share::Shares>,
    // HELLO_TIMEOUT and SILENCE_LIMIT, held here so tests can shorten the waits.
    hello_timeout: Duration,
    silence_limit: Duration,
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
    let sources = enrich::Sources::from_env();
    tracing::info!(
        musicbrainz = sources.musicbrainz,
        deezer = sources.deezer,
        apple = sources.apple,
        "enrichment sources"
    );
    let enricher = Enricher::new(
        cache,
        apple::Apple::from_env(
            reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()
                .expect("http client"),
        ),
        sources,
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
        hello_timeout: HELLO_TIMEOUT,
        silence_limit: SILENCE_LIMIT,
    };
    let hub = app.hub.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        loop {
            tick.tick().await;
            hub.lock().unwrap().expire_handoffs(Instant::now());
        }
    });
    let router = router(app);
    let listener = tokio::net::TcpListener::bind(&listen).await.expect("bind");
    tracing::info!(%listen, %navidrome_url, "relay listening");
    // Stops at once, without waiting for connections to finish: they are WebSockets and radio
    // streams, which never do, and the app reconnects by itself.
    tokio::select! {
        served = axum::serve(listener, router) => served.expect("serve"),
        () = stop_signal() => tracing::info!("relay stopping"),
    }
}

fn router(app: App) -> Router {
    Router::new()
        .route("/relay", get(upgrade))
        .route("/radio/{id}", get(radio_stream))
        .route("/radio/{id}/now", get(radio_now))
        .route("/relay/share/{id}", get(share_info))
        .route("/relay/share/{id}/preview", get(share_preview))
        .route("/health", get(|| async { "ok" }))
        .with_state(app)
}

/// Ctrl-C, or the SIGTERM that `docker stop` sends. In a container the relay is process 1, which
/// ignores SIGTERM unless it handles it, so Docker waited ten seconds and killed it.
async fn stop_signal() {
    let interrupt = tokio::signal::ctrl_c();
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => signal.recv().await,
            Err(_) => std::future::pending().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<Option<()>>();
    tokio::select! {
        _ = interrupt => {}
        _ = terminate => {}
    }
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

async fn read_hello(socket: &mut WebSocket, timeout: Duration) -> Option<Hello> {
    let message = tokio::time::timeout(timeout, socket.recv()).await.ok()??.ok()?;
    let Message::Text(text) = message else { return None };
    let Ok(ClientMessage::Hello { token, device_id, name }) = serde_json::from_str(&text) else {
        return None;
    };
    let hello = Hello { token, device_id, name };
    let valid = !hello.device_id.is_empty() && hello.device_id.chars().count() <= MAX_DEVICE_ID_CHARS;
    valid.then_some(hello)
}

async fn serve(app: App, mut socket: WebSocket) {
    let Some(hello) = read_hello(&mut socket, app.hello_timeout).await else {
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
    let reason = loop {
        let message = match tokio::time::timeout(app.silence_limit, stream.next()).await {
            Ok(Some(Ok(message))) => message,
            Ok(_) => break "closed",
            Err(_) => break "silent",
        };
        let Message::Text(text) = message else { continue };
        match serde_json::from_str::<ClientMessage>(&text) {
            Ok(ClientMessage::Enrich(request)) => {
                let _ = replies.send(app.enricher.request(request));
            }
            Ok(message) => app.hub.lock().unwrap().receive(&user, &hello.device_id, message),
            Err(error) => tracing::debug!(%error, "ignored a message the relay does not understand"),
        }
    };
    app.hub.lock().unwrap().leave(&user, &hello.device_id, connection);
    writer.abort();
    tracing::info!(user, device = hello.device_id, reason, "device disconnected");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, StatusCode};
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::{Value, json};
    use tokio::net::{TcpListener, TcpStream};
    use tokio_tungstenite::tungstenite::Message as Frame;
    use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

    type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

    // Far longer than any step takes: it only runs out when the relay hangs, and then fails the test.
    const PATIENCE: Duration = Duration::from_secs(5);
    const NOTHING: [Value; 0] = [];

    async fn listen(router: Router) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        tokio::spawn(async move { axum::serve(listener, router).await });
        address
    }

    /// A stand-in for Navidrome that accepts the tokens signed "signed" and rejects all others.
    async fn fake_navidrome() -> String {
        async fn keepalive(headers: HeaderMap) -> StatusCode {
            let token = headers.get("x-nd-authorization").and_then(|value| value.to_str().ok());
            if token.is_some_and(|token| token.starts_with("Bearer ") && token.ends_with(".signed")) {
                StatusCode::OK
            } else {
                StatusCode::UNAUTHORIZED
            }
        }
        let router = Router::new().route("/api/keepalive/keepalive", get(keepalive));
        format!("http://{}", listen(router).await)
    }

    /// A token as Navidrome issues them, with these claims; `fake_navidrome` accepts it.
    fn token_with(claims: &str) -> String {
        format!("header.{}.signed", URL_SAFE_NO_PAD.encode(claims))
    }

    fn token(user: &str) -> String {
        token_with(&json!({ "uid": user }).to_string())
    }

    fn forged_token(user: &str) -> String {
        token(user).replace(".signed", ".forged")
    }

    /// Serves the relay's real router and returns the address of its WebSocket.
    async fn relay_with(navidrome: &str, hello_timeout: Duration, silence_limit: Duration) -> String {
        let nothing = enrich::Sources {
            musicbrainz: false,
            deezer: false,
            apple: false,
        };
        let app = App {
            hub: Arc::default(),
            navidrome: Navidrome::new(navidrome.to_owned()),
            enricher: Enricher::new(None, apple::Apple::from_env(reqwest::Client::new()), nothing),
            radio: Arc::new(radio::Radio::from_env(navidrome)),
            shares: Arc::new(share::Shares::new(navidrome)),
            hello_timeout,
            silence_limit,
        };
        format!("ws://{}/relay", listen(router(app)).await)
    }

    async fn relay() -> String {
        relay_with(&fake_navidrome().await, HELLO_TIMEOUT, SILENCE_LIMIT).await
    }

    async fn open(relay: &str) -> Socket {
        tokio_tungstenite::connect_async(relay).await.unwrap().0
    }

    async fn say(socket: &mut Socket, message: Value) {
        socket.send(Frame::text(message.to_string())).await.unwrap();
    }

    fn hello(token: String, device: &str) -> Value {
        json!({ "type": "hello", "token": token, "deviceId": device, "name": device })
    }

    /// The next message from the relay, or `None` once the relay has closed the socket.
    async fn next_message(socket: &mut Socket) -> Option<Value> {
        loop {
            let frame = tokio::time::timeout(PATIENCE, socket.next())
                .await
                .expect("the relay neither answered nor closed the socket");
            match frame {
                Some(Ok(Frame::Text(text))) => return Some(serde_json::from_str(&text).unwrap()),
                Some(Ok(_)) => continue,
                Some(Err(_)) | None => return None,
            }
        }
    }

    async fn hear(socket: &mut Socket) -> Value {
        next_message(socket).await.expect("the relay closed the socket")
    }

    /// Everything the relay has sent this socket up to now. The relay answers an `enrich` request
    /// on the same socket, after the messages before it, so that answer marks "now" without waiting.
    async fn heard(socket: &mut Socket) -> Vec<Value> {
        say(socket, json!({ "type": "enrich" })).await;
        let mut messages = Vec::new();
        loop {
            let message = hear(socket).await;
            if message["type"] == "enrichment" {
                return messages;
            }
            messages.push(message);
        }
    }

    /// Waits for the relay to close the socket, which it does only after the device has left its
    /// room, and returns what it said before that.
    async fn closed(socket: &mut Socket) -> Vec<Value> {
        let mut messages = Vec::new();
        while let Some(message) = next_message(socket).await {
            messages.push(message);
        }
        messages
    }

    async fn join(relay: &str, user: &str, device: &str) -> (Socket, Value) {
        let mut socket = open(relay).await;
        say(&mut socket, hello(token(user), device)).await;
        let welcome = hear(&mut socket).await;
        assert_eq!(welcome["type"], "welcome");
        (socket, welcome)
    }

    fn device(id: &str, online: bool) -> Value {
        json!({ "id": id, "name": id, "online": online })
    }

    #[tokio::test]
    async fn accounts_stay_apart_even_with_the_same_device_id() {
        let relay = relay().await;
        let (mut ana_player, _) = join(&relay, "ana", "tab-1").await;
        let (mut ana_remote, _) = join(&relay, "ana", "tab-2").await;
        say(&mut ana_player, json!({ "type": "claim" })).await;
        say(&mut ana_player, json!({ "type": "queue", "queue": ["ana's song"] })).await;
        say(
            &mut ana_player,
            json!({ "type": "playback", "playback": { "position": 7 } }),
        )
        .await;
        heard(&mut ana_player).await;
        heard(&mut ana_remote).await;

        let (mut theo, welcome) = join(&relay, "theo", "tab-1").await;
        assert_eq!(
            welcome,
            json!({
                "type": "welcome", "active": null, "devices": [device("tab-1", true)],
                "queue": null, "playback": null, "ageMs": 0
            })
        );
        // Everything a device can send, aimed at Ana's tab-2, before and after Theo becomes the
        // player of his own room.
        for attempt in [
            json!({ "type": "command", "command": { "kind": "pause" } }),
            json!({ "type": "transfer", "to": "tab-2" }),
            json!({ "type": "claim" }),
            json!({ "type": "queue", "queue": ["theo's song"] }),
            json!({ "type": "playback", "playback": { "position": 99 } }),
            json!({ "type": "transfer", "to": "tab-2" }),
            json!({ "type": "handoff", "to": "tab-2", "queue": ["theo's song"], "playback": { "position": 99 } }),
        ] {
            say(&mut theo, attempt).await;
        }
        let own_room = json!({ "type": "devices", "active": "tab-1", "devices": [device("tab-1", true)] });
        let theo_heard = heard(&mut theo).await;
        assert!(
            !theo_heard.is_empty() && theo_heard.iter().all(|message| *message == own_room),
            "{theo_heard:?}"
        );
        assert_eq!(heard(&mut ana_player).await, NOTHING);
        assert_eq!(heard(&mut ana_remote).await, NOTHING);

        // Theo's tab-1 closing must not take Ana's tab-1 with it.
        theo.close(None).await.unwrap();
        closed(&mut theo).await;
        let (_, welcome) = join(&relay, "ana", "tab-3").await;
        assert_eq!(welcome["active"], "tab-1");
        assert_eq!(
            welcome["devices"],
            json!([device("tab-1", true), device("tab-2", true), device("tab-3", true)])
        );
        assert_eq!(welcome["queue"], json!(["ana's song"]));
        assert_eq!(welcome["playback"]["position"], 7);
    }

    #[tokio::test]
    async fn a_token_navidrome_does_not_vouch_for_is_refused_and_joins_no_room() {
        let relay = relay().await;
        let (mut ana, _) = join(&relay, "ana", "tab-1").await;
        let refused = [
            forged_token("ana"),
            // Accepted by Navidrome, but naming no user to make a room for.
            token_with("{}"),
            token_with(r#"{"uid":""}"#),
            "header.not-base64!.signed".to_owned(),
            "signed".to_owned(),
        ];
        for token in refused {
            let mut intruder = open(&relay).await;
            say(&mut intruder, hello(token.clone(), "tab-2")).await;
            assert_eq!(
                closed(&mut intruder).await,
                [json!({ "type": "unauthorized" })],
                "{token}"
            );
        }
        assert_eq!(heard(&mut ana).await, NOTHING);
    }

    #[tokio::test]
    async fn nobody_gets_in_while_navidrome_cannot_be_asked() {
        // A port nothing listens on: the listener is dropped at the end of this statement.
        let unused = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap();
        let relay = relay_with(&format!("http://{unused}"), HELLO_TIMEOUT, SILENCE_LIMIT).await;
        let mut socket = open(&relay).await;
        say(&mut socket, hello(token("ana"), "tab-1")).await;
        assert_eq!(closed(&mut socket).await, [json!({ "type": "unauthorized" })]);
    }

    #[tokio::test]
    async fn sockets_that_do_not_open_with_a_usable_hello_are_closed() {
        let relay = relay().await;
        let too_long = "д".repeat(MAX_DEVICE_ID_CHARS + 1);
        let openers = [
            json!({ "type": "claim" }).to_string(),
            hello(token("ana"), "").to_string(),
            hello(token("ana"), &too_long).to_string(),
            json!({ "type": "hello", "token": token("ana") }).to_string(),
            "hello".to_owned(),
        ];
        for opener in openers {
            let mut socket = open(&relay).await;
            socket.send(Frame::text(opener.clone())).await.unwrap();
            let said = closed(&mut socket).await;
            assert!(said.iter().all(|message| message["type"] != "welcome"), "{opener}");
        }
        let (_, welcome) = join(&relay, "ana", "tab-1").await;
        assert_eq!(welcome["devices"], json!([device("tab-1", true)]));
    }

    #[tokio::test]
    async fn names_and_device_ids_are_measured_in_characters_not_bytes() {
        let relay = relay().await;
        // 64 two-byte characters: within the limit by characters, twice over it by bytes.
        let id = "д".repeat(MAX_DEVICE_ID_CHARS);
        let mut socket = open(&relay).await;
        let name = "Тео 🎧".repeat(20);
        say(
            &mut socket,
            json!({ "type": "hello", "token": token("theo"), "deviceId": id, "name": name }),
        )
        .await;
        let welcome = hear(&mut socket).await;
        assert_eq!(
            welcome["devices"],
            json!([{ "id": id, "name": "Тео 🎧".repeat(MAX_NAME_CHARS / 5), "online": true }])
        );
        say(&mut socket, json!({ "type": "claim" })).await;
        assert_eq!(heard(&mut socket).await[0]["active"], id.as_str());
    }

    #[tokio::test]
    async fn a_second_hello_does_not_move_a_socket_into_another_account() {
        let relay = relay().await;
        let (mut theo, _) = join(&relay, "theo", "tab-1").await;
        let (mut ana, _) = join(&relay, "ana", "tab-2").await;
        say(&mut ana, hello(forged_token("theo"), "tab-9")).await;
        say(&mut ana, json!({ "type": "claim" })).await;
        assert_eq!(
            heard(&mut ana).await,
            [json!({ "type": "devices", "active": "tab-2", "devices": [device("tab-2", true)] })]
        );
        assert_eq!(heard(&mut theo).await, NOTHING);
    }

    #[tokio::test]
    async fn a_socket_that_never_says_hello_is_closed() {
        let relay = relay_with(&fake_navidrome().await, Duration::from_millis(30), SILENCE_LIMIT).await;
        let mut socket = open(&relay).await;
        assert_eq!(closed(&mut socket).await, NOTHING);
    }

    #[tokio::test]
    async fn a_player_that_goes_silent_is_shown_offline_and_its_queue_can_be_taken_over() {
        let relay = relay_with(&fake_navidrome().await, HELLO_TIMEOUT, Duration::from_millis(40)).await;
        let (mut laptop, _) = join(&relay, "ana", "laptop").await;
        say(&mut laptop, json!({ "type": "claim" })).await;
        say(&mut laptop, json!({ "type": "queue", "queue": ["ana's song"] })).await;
        // The laptop falls asleep: it sends nothing more and never closes its socket.
        closed(&mut laptop).await;
        let (mut phone, welcome) = join(&relay, "ana", "phone").await;
        assert_eq!(welcome["active"], "laptop");
        assert_eq!(
            welcome["devices"],
            json!([device("laptop", false), device("phone", true)])
        );
        say(&mut phone, json!({ "type": "transfer", "to": "phone" })).await;
        let takeover = hear(&mut phone).await;
        assert_eq!(
            (&takeover["type"], &takeover["queue"]),
            (&json!("takeover"), &json!(["ana's song"]))
        );
    }

    #[tokio::test]
    async fn garbage_on_a_socket_is_ignored_and_the_room_carries_on() {
        let relay = relay().await;
        let (mut player, _) = join(&relay, "ana", "player").await;
        let (mut remote, _) = join(&relay, "ana", "remote").await;
        say(&mut player, json!({ "type": "claim" })).await;
        heard(&mut player).await;
        heard(&mut remote).await;

        let nested = format!(
            r#"{{"type":"queue","queue":{}{}}}"#,
            "[".repeat(10_000),
            "]".repeat(10_000)
        );
        let garbage = [
            Frame::text("not json"),
            Frame::text(""),
            Frame::text("null"),
            Frame::text(r#"{"type":"dance"}"#),
            Frame::text(r#"{"type":"transfer"}"#),
            Frame::text(r#"{"type":"transfer","to":7}"#),
            Frame::text(r#"{"type":"handoff","to":{"device":"remote"}}"#),
            Frame::text(nested),
            Frame::binary(vec![0xff, 0x00, 0x9f]),
        ];
        for frame in garbage {
            player.send(frame.clone()).await.unwrap();
            remote.send(frame).await.unwrap();
        }
        // A queue far larger than any real one still arrives whole.
        let long_queue = json!(["x".repeat(1 << 20)]);
        say(&mut player, json!({ "type": "queue", "queue": long_queue })).await;
        assert_eq!(heard(&mut player).await, NOTHING);
        assert_eq!(
            heard(&mut remote).await,
            [json!({ "type": "queue", "queue": long_queue })]
        );

        say(&mut remote, json!({ "type": "command", "command": { "kind": "next" } })).await;
        heard(&mut remote).await;
        assert_eq!(
            heard(&mut player).await,
            [json!({ "type": "command", "command": { "kind": "next" }, "from": "remote" })]
        );
        let (_, welcome) = join(&relay, "ana", "late").await;
        assert_eq!(welcome["active"], "player");
        assert_eq!(
            welcome["devices"],
            json!([device("player", true), device("remote", true), device("late", true)])
        );
    }
}
