//! Messages exchanged over the `/relay` WebSocket, as JSON objects tagged by `type`.
//!
//! The mirror of these types on the app side is `RelayRequest` and `RelayMessage` in
//! `app/src/lib/remote/relay.svelte.ts`; change both together.
//!
//! One Navidrome user is one room. Each browser tab is a device in it. At most one device is
//! "active": it plays the music and owns the queue. The others are remotes: they show the
//! active device's state and send it commands. The relay stores the last queue and playback
//! state so a device that joins later, or takes over from a closed tab, can pick up exactly
//! where playback was. Queue, playback and command bodies are owned by the app; the relay
//! passes them through without reading them.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::enrich::EnrichRequest;

/// What a device sends. The first message on a socket must be `Hello`.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    /// Opens the session. `token` is the user's Navidrome token; the relay asks Navidrome who
    /// it belongs to. `device_id` is stable per tab across reloads.
    #[serde(rename_all = "camelCase")]
    Hello {
        token: String,
        device_id: String,
        name: String,
    },
    /// Keeps proxies from closing an idle socket. No reply.
    Ping,
    /// "I am playing now": makes this device active without asking the current one.
    Claim,
    /// Full queue from the active device. Ignored from any other device.
    Queue {
        #[serde(default)]
        queue: Value,
    },
    /// Playback state (track, position, playing…) from the active device. Ignored otherwise.
    Playback {
        #[serde(default)]
        playback: Value,
    },
    /// A remote's command (play, pause, next…) forwarded to the active device.
    Command {
        #[serde(default)]
        command: Value,
    },
    /// Asks for playback to move to device `to`. If the active device doesn't answer the
    /// `Release` with a `Handoff` within `hub::HANDOFF_TIMEOUT`, playback moves with the room's
    /// last stored state.
    Transfer { to: String },
    /// The active device's answer to a `Release` with `handoff: true`: its final queue and
    /// playback, so `to` can continue from the same position.
    Handoff {
        to: Option<String>,
        #[serde(default)]
        queue: Value,
        #[serde(default)]
        playback: Value,
    },
    /// Asks for genre, country and popularity data from MusicBrainz, Deezer and Apple.
    /// Answered with an `enrichment` message, and later ones as lookups finish.
    Enrich(EnrichRequest),
}

impl ClientMessage {
    pub fn kind(&self) -> &'static str {
        match self {
            ClientMessage::Hello { .. } => "hello",
            ClientMessage::Ping => "ping",
            ClientMessage::Claim => "claim",
            ClientMessage::Queue { .. } => "queue",
            ClientMessage::Playback { .. } => "playback",
            ClientMessage::Command { .. } => "command",
            ClientMessage::Transfer { .. } => "transfer",
            ClientMessage::Handoff { .. } => "handoff",
            ClientMessage::Enrich(_) => "enrich",
        }
    }
}

/// A device as shown in the devices list. An offline device stays listed while it is still
/// the active one, so "Play here" can take over its queue.
#[derive(Serialize, Debug)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub online: bool,
}

/// What the relay sends. The `enrichment` message is built in `enrich.rs`.
#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    /// The token in `Hello` was not accepted; the socket closes after this.
    Unauthorized,
    /// First reply to `Hello`: the room as it is now.
    #[serde(rename_all = "camelCase")]
    Welcome {
        active: Option<String>,
        devices: Vec<DeviceInfo>,
        queue: Value,
        playback: Value,
        /// How long ago `playback` was reported, so the receiver can advance the position.
        age_ms: u64,
    },
    /// The device list or the active device changed.
    Devices {
        active: Option<String>,
        devices: Vec<DeviceInfo>,
    },
    /// The active device's queue, sent on to everyone else.
    Queue { queue: Value },
    /// The active device's playback, sent on to everyone else.
    #[serde(rename_all = "camelCase")]
    Playback { playback: Value, age_ms: u64 },
    /// A remote's command for the active device; `from` is the remote's device id.
    Command { command: Value, from: String },
    /// Tells the active device it is no longer active. With `handoff`, it should first send a
    /// `Handoff` with its state so `to` can continue; without, someone simply claimed playback.
    Release { to: String, handoff: bool },
    /// Makes the receiver the active device, with the queue and playback to continue from.
    #[serde(rename_all = "camelCase")]
    Takeover { queue: Value, playback: Value, age_ms: u64 },
}

impl ServerMessage {
    pub fn to_text(&self) -> String {
        serde_json::to_string(self).expect("relay messages always serialize")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_what_the_app_sends() {
        let hello = json!({ "type": "hello", "token": "t", "deviceId": "d", "name": "Firefox · Mac" });
        assert!(
            matches!(serde_json::from_value(hello), Ok(ClientMessage::Hello { device_id, .. }) if device_id == "d")
        );
        let handoff = json!({ "type": "handoff", "to": "phone", "queue": [], "playback": { "position": 3 } });
        assert!(
            matches!(serde_json::from_value(handoff), Ok(ClientMessage::Handoff { to: Some(to), .. }) if to == "phone")
        );
        let enrich = json!({ "type": "enrich", "since": 5, "releaseGroups": ["rg"] });
        assert!(matches!(serde_json::from_value(enrich), Ok(ClientMessage::Enrich(_))));
        assert!(serde_json::from_value::<ClientMessage>(json!({ "type": "dance" })).is_err());
    }

    #[test]
    fn writes_what_the_app_reads() {
        let playback = ServerMessage::Playback {
            playback: json!({ "position": 1 }),
            age_ms: 20,
        };
        assert_eq!(
            serde_json::to_value(&playback).unwrap(),
            json!({ "type": "playback", "playback": { "position": 1 }, "ageMs": 20 })
        );
        let release = ServerMessage::Release {
            to: "b".into(),
            handoff: true,
        };
        assert_eq!(
            serde_json::to_value(&release).unwrap(),
            json!({ "type": "release", "to": "b", "handoff": true })
        );
    }
}
