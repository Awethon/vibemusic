//! Rooms of devices for remote control. See `protocol.rs` for the message flow.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::sync::mpsc::UnboundedSender;

use crate::protocol::{ClientMessage, DeviceInfo, ServerMessage};

pub type Outbox = UnboundedSender<String>;

/// How long the active device gets to answer a `Release` with its `Handoff`. A device that went to
/// sleep can look connected for minutes, so after this the move goes ahead with the room's last
/// stored state instead of waiting for it.
pub const HANDOFF_TIMEOUT: Duration = Duration::from_secs(4);

/// One socket. A reload opens a new socket for the same device before the old one closes, so
/// each connection gets an id and only the current one may remove the device.
struct Connection {
    id: u64,
    outbox: Outbox,
}

struct Device {
    id: String,
    name: String,
    connection: Option<Connection>,
}

/// All devices of one Navidrome user, and the last state their active device reported.
#[derive(Default)]
struct Room {
    devices: Vec<Device>,
    active: Option<String>,
    queue: Option<Value>,
    playback: Option<(Value, Instant)>,
    /// A move the active device was asked to hand over: the target, and when it was asked.
    handoff: Option<(String, Instant)>,
}

impl Room {
    fn device(&self, id: &str) -> Option<&Device> {
        self.devices.iter().find(|device| device.id == id)
    }

    fn online(&self, id: &str) -> bool {
        self.device(id).is_some_and(|device| device.connection.is_some())
    }

    fn send(&self, id: &str, message: &ServerMessage) {
        if let Some(connection) = self.device(id).and_then(|device| device.connection.as_ref()) {
            let _ = connection.outbox.send(message.to_text());
        }
    }

    fn broadcast(&self, message: &ServerMessage, except: Option<&str>) {
        let text = message.to_text();
        for device in &self.devices {
            if Some(device.id.as_str()) == except {
                continue;
            }
            if let Some(connection) = &device.connection {
                let _ = connection.outbox.send(text.clone());
            }
        }
    }

    fn device_infos(&self) -> Vec<DeviceInfo> {
        self.devices
            .iter()
            .map(|device| DeviceInfo {
                id: device.id.clone(),
                name: device.name.clone(),
                online: device.connection.is_some(),
            })
            .collect()
    }

    fn device_list(&self) -> ServerMessage {
        ServerMessage::Devices {
            active: self.active.clone(),
            devices: self.device_infos(),
        }
    }

    /// Drops offline devices, except the active one, and tells everyone.
    fn announce_devices(&mut self) {
        let active = self.active.clone();
        self.devices
            .retain(|device| device.connection.is_some() || active.as_deref() == Some(device.id.as_str()));
        self.broadcast(&self.device_list(), None);
    }

    fn playback_now(&self) -> (Value, u64) {
        match &self.playback {
            Some((playback, at)) => (playback.clone(), at.elapsed().as_millis() as u64),
            None => (Value::Null, 0),
        }
    }

    fn take_over(&mut self, to: &str) {
        self.handoff = None;
        self.active = Some(to.to_owned());
        let (playback, age_ms) = self.playback_now();
        let queue = self.queue.clone().unwrap_or(Value::Null);
        self.send(
            to,
            &ServerMessage::Takeover {
                queue,
                playback,
                age_ms,
            },
        );
        self.announce_devices();
    }
}

#[derive(Default)]
pub struct Hub {
    rooms: HashMap<String, Room>,
    next_connection: u64,
}

impl Hub {
    /// Adds or reconnects a device and sends it the room's state. Returns the connection id
    /// to pass to `leave`.
    pub fn join(&mut self, user: &str, device_id: &str, name: &str, outbox: Outbox) -> u64 {
        self.next_connection += 1;
        let connection = Connection {
            id: self.next_connection,
            outbox,
        };
        let room = self.rooms.entry(user.to_owned()).or_default();
        match room.devices.iter_mut().find(|device| device.id == device_id) {
            Some(device) => {
                device.name = name.to_owned();
                device.connection = Some(connection);
            }
            None => room.devices.push(Device {
                id: device_id.to_owned(),
                name: name.to_owned(),
                connection: Some(connection),
            }),
        }
        let (playback, age_ms) = room.playback_now();
        let welcome = ServerMessage::Welcome {
            active: room.active.clone(),
            devices: room.device_infos(),
            queue: room.queue.clone().unwrap_or(Value::Null),
            playback,
            age_ms,
        };
        room.send(device_id, &welcome);
        room.broadcast(&room.device_list(), Some(device_id));
        self.next_connection
    }

    /// Removes a device when its socket closes. The active device stays listed as offline so
    /// another device can still take over its queue.
    pub fn leave(&mut self, user: &str, device_id: &str, connection_id: u64) {
        let Some(room) = self.rooms.get_mut(user) else { return };
        let Some(index) = room.devices.iter().position(|device| device.id == device_id) else {
            return;
        };
        if room.devices[index].connection.as_ref().map(|connection| connection.id) != Some(connection_id) {
            return;
        }
        if room.active.as_deref() == Some(device_id) {
            room.devices[index].connection = None;
        } else {
            room.devices.remove(index);
        }
        room.announce_devices();
        if room.devices.is_empty() {
            self.rooms.remove(user);
        }
    }

    pub fn receive(&mut self, user: &str, device_id: &str, message: ClientMessage) {
        let Some(room) = self.rooms.get_mut(user) else { return };
        let is_active = room.active.as_deref() == Some(device_id);
        log_message(room, device_id, is_active, &message);
        match message {
            ClientMessage::Queue { queue } if is_active => {
                room.queue = Some(queue.clone());
                room.broadcast(&ServerMessage::Queue { queue }, Some(device_id));
            }
            ClientMessage::Playback { playback } if is_active => {
                room.playback = Some((playback, Instant::now()));
                let (playback, age_ms) = room.playback_now();
                room.broadcast(&ServerMessage::Playback { playback, age_ms }, Some(device_id));
            }
            ClientMessage::Command { command } => {
                if let Some(active) = room
                    .active
                    .clone()
                    .filter(|active| active != device_id && room.online(active))
                {
                    let from = device_id.to_owned();
                    room.send(&active, &ServerMessage::Command { command, from });
                }
            }
            ClientMessage::Claim if !is_active => {
                room.handoff = None;
                let previous = room.active.replace(device_id.to_owned());
                if let Some(previous) = previous {
                    let to = device_id.to_owned();
                    room.send(&previous, &ServerMessage::Release { to, handoff: false });
                }
                room.announce_devices();
            }
            ClientMessage::Transfer { to } => {
                if !room.online(&to) {
                    return;
                }
                match room.active.clone() {
                    Some(active) if active == to => {}
                    Some(active) if room.online(&active) => {
                        room.handoff = Some((to.clone(), Instant::now()));
                        room.send(&active, &ServerMessage::Release { to, handoff: true })
                    }
                    _ => room.take_over(&to),
                }
            }
            ClientMessage::Handoff { to, queue, playback } if is_active => {
                room.handoff = None;
                room.queue = Some(queue);
                room.playback = Some((playback, Instant::now()));
                match to.filter(|to| room.online(to)) {
                    Some(to) => room.take_over(&to),
                    None => room.announce_devices(),
                }
            }
            _ => {}
        }
    }

    /// Moves playback for every handover the active device left unanswered past
    /// `HANDOFF_TIMEOUT`, using the room's last stored queue and playback. The silent device is
    /// told it was released, so it doesn't keep playing if it wakes up. Called about once a second.
    pub fn expire_handoffs(&mut self, now: Instant) {
        for room in self.rooms.values_mut() {
            let Some((to, asked)) = room.handoff.clone() else {
                continue;
            };
            if now.duration_since(asked) < HANDOFF_TIMEOUT {
                continue;
            }
            room.handoff = None;
            if !room.online(&to) {
                continue;
            }
            if let Some(previous) = room.active.clone().filter(|previous| *previous != to) {
                tracing::info!(device = previous, "handoff not answered, moving playback without it");
                room.send(
                    &previous,
                    &ServerMessage::Release {
                        to: to.clone(),
                        handoff: false,
                    },
                );
            }
            room.take_over(&to);
        }
    }
}

/// Logs each device message at debug level (no tokens; ids shortened) to trace handovers.
fn log_message(room: &Room, device_id: &str, is_active: bool, message: &ClientMessage) {
    if matches!(message, ClientMessage::Ping) {
        return;
    }
    let short = |id: &str| id[..id.len().min(8)].to_owned();
    let (playback, command) = match message {
        ClientMessage::Playback { playback } | ClientMessage::Handoff { playback, .. } => (playback, &Value::Null),
        ClientMessage::Command { command } => (&Value::Null, command),
        _ => (&Value::Null, &Value::Null),
    };
    tracing::debug!(
        device = short(device_id),
        kind = message.kind(),
        is_active,
        active = room.active.as_deref().map(short).unwrap_or_default(),
        track = playback["trackId"].as_str().unwrap_or(""),
        playing = playback["playing"].as_bool(),
        waiting = playback["waiting"].as_bool(),
        position = playback["position"].as_f64().map(|position| position.round()),
        command = command["kind"].as_str().unwrap_or(""),
        "message"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

    fn message(value: Value) -> ClientMessage {
        serde_json::from_value(value).unwrap()
    }

    fn connect(hub: &mut Hub, user: &str, device: &str) -> (u64, UnboundedReceiver<String>) {
        let (outbox, inbox) = unbounded_channel();
        (hub.join(user, device, device, outbox), inbox)
    }

    fn drain(inbox: &mut UnboundedReceiver<String>) -> Vec<Value> {
        let mut messages = Vec::new();
        while let Ok(text) = inbox.try_recv() {
            messages.push(serde_json::from_str(&text).unwrap());
        }
        messages
    }

    fn types(messages: &[Value]) -> Vec<&str> {
        messages
            .iter()
            .map(|message| message["type"].as_str().unwrap())
            .collect()
    }

    #[test]
    fn users_never_see_each_others_devices() {
        let mut hub = Hub::default();
        let (_, mut alice) = connect(&mut hub, "alice", "a1");
        let (_, mut bob) = connect(&mut hub, "bob", "b1");
        assert_eq!(
            drain(&mut alice).last().unwrap()["devices"].as_array().unwrap().len(),
            1
        );
        assert_eq!(drain(&mut bob)[0]["devices"][0]["id"], "b1");
        hub.receive("bob", "b1", message(json!({ "type": "claim" })));
        hub.receive("bob", "b1", message(json!({ "type": "queue", "queue": [1] })));
        assert!(drain(&mut alice).is_empty());
    }

    #[test]
    fn commands_reach_only_the_active_device() {
        let mut hub = Hub::default();
        let (_, mut player) = connect(&mut hub, "u", "player");
        let (_, mut remote) = connect(&mut hub, "u", "remote");
        hub.receive("u", "player", message(json!({ "type": "claim" })));
        drain(&mut player);
        drain(&mut remote);
        hub.receive(
            "u",
            "remote",
            message(json!({ "type": "command", "command": { "kind": "next" } })),
        );
        let received = drain(&mut player);
        assert_eq!(types(&received), ["command"]);
        assert_eq!(received[0]["from"], "remote");
        assert!(drain(&mut remote).is_empty());
    }

    #[test]
    fn state_from_a_remote_is_ignored() {
        let mut hub = Hub::default();
        let (_, _player) = connect(&mut hub, "u", "player");
        let (_, mut remote) = connect(&mut hub, "u", "remote");
        hub.receive("u", "player", message(json!({ "type": "claim" })));
        hub.receive("u", "remote", message(json!({ "type": "queue", "queue": ["stolen"] })));
        drain(&mut remote);
        let (_, mut late) = connect(&mut hub, "u", "late");
        assert_eq!(drain(&mut late)[0]["queue"], Value::Null);
    }

    #[test]
    fn transfer_asks_the_player_for_a_handoff_then_hands_state_over() {
        let mut hub = Hub::default();
        let (_, mut player) = connect(&mut hub, "u", "player");
        let (_, mut target) = connect(&mut hub, "u", "target");
        hub.receive("u", "player", message(json!({ "type": "claim" })));
        drain(&mut player);
        drain(&mut target);
        hub.receive("u", "target", message(json!({ "type": "transfer", "to": "target" })));
        let release = drain(&mut player);
        assert_eq!(release[0]["type"], "release");
        assert_eq!(release[0]["handoff"], true);
        hub.receive(
            "u",
            "player",
            message(json!({ "type": "handoff", "to": "target", "queue": ["q"], "playback": { "position": 42 } })),
        );
        let received = drain(&mut target);
        assert_eq!(types(&received), ["takeover", "devices"]);
        assert_eq!(received[0]["playback"]["position"], 42);
        assert_eq!(received[1]["active"], "target");
    }

    #[test]
    fn an_unanswered_handoff_moves_playback_with_the_last_state() {
        let mut hub = Hub::default();
        let (_, mut player) = connect(&mut hub, "u", "player");
        let (_, mut target) = connect(&mut hub, "u", "target");
        hub.receive("u", "player", message(json!({ "type": "claim" })));
        hub.receive("u", "player", message(json!({ "type": "queue", "queue": ["q"] })));
        hub.receive(
            "u",
            "player",
            message(json!({ "type": "playback", "playback": { "position": 7 } })),
        );
        drain(&mut player);
        drain(&mut target);
        hub.receive("u", "target", message(json!({ "type": "transfer", "to": "target" })));
        drain(&mut player);
        hub.expire_handoffs(Instant::now());
        assert!(drain(&mut target).is_empty());
        hub.expire_handoffs(Instant::now() + HANDOFF_TIMEOUT);
        let received = drain(&mut target);
        assert_eq!(types(&received), ["takeover", "devices"]);
        assert_eq!(received[0]["queue"], json!(["q"]));
        assert_eq!(received[0]["playback"]["position"], 7);
        assert_eq!(received[1]["active"], "target");
        let released = drain(&mut player);
        assert_eq!(released[0]["type"], "release");
        assert_eq!(released[0]["handoff"], false);
    }

    #[test]
    fn a_handoff_in_time_leaves_nothing_to_expire() {
        let mut hub = Hub::default();
        let (_, mut player) = connect(&mut hub, "u", "player");
        let (_, mut target) = connect(&mut hub, "u", "target");
        hub.receive("u", "player", message(json!({ "type": "claim" })));
        hub.receive("u", "target", message(json!({ "type": "transfer", "to": "target" })));
        hub.receive(
            "u",
            "player",
            message(json!({ "type": "handoff", "to": "target", "queue": [], "playback": { "position": 1 } })),
        );
        drain(&mut player);
        drain(&mut target);
        hub.expire_handoffs(Instant::now() + HANDOFF_TIMEOUT);
        assert!(drain(&mut player).is_empty());
        assert!(drain(&mut target).is_empty());
    }

    #[test]
    fn a_late_handoff_from_the_replaced_player_is_ignored() {
        let mut hub = Hub::default();
        let (_, mut player) = connect(&mut hub, "u", "player");
        let (_, mut target) = connect(&mut hub, "u", "target");
        hub.receive("u", "player", message(json!({ "type": "claim" })));
        hub.receive("u", "target", message(json!({ "type": "transfer", "to": "target" })));
        hub.expire_handoffs(Instant::now() + HANDOFF_TIMEOUT);
        drain(&mut player);
        drain(&mut target);
        hub.receive(
            "u",
            "player",
            message(json!({ "type": "handoff", "to": "gone", "queue": [], "playback": { "position": 99 } })),
        );
        assert!(drain(&mut target).is_empty());
        let (_, mut later) = connect(&mut hub, "u", "later");
        let welcome = drain(&mut later);
        assert_eq!(welcome[0]["active"], "target");
        assert_ne!(welcome[0]["playback"]["position"], 99);
    }

    #[test]
    fn an_offline_player_keeps_the_room_state_for_play_here() {
        let mut hub = Hub::default();
        let (player_connection, _player) = connect(&mut hub, "u", "player");
        hub.receive("u", "player", message(json!({ "type": "claim" })));
        hub.receive("u", "player", message(json!({ "type": "queue", "queue": ["q"] })));
        hub.leave("u", "player", player_connection);
        let (_, mut phone) = connect(&mut hub, "u", "phone");
        let welcome = drain(&mut phone);
        assert_eq!(welcome[0]["devices"].as_array().unwrap().len(), 2);
        assert_eq!(welcome[0]["devices"][0]["online"], false);
        hub.receive("u", "phone", message(json!({ "type": "transfer", "to": "phone" })));
        let received = drain(&mut phone);
        assert_eq!(received[0]["type"], "takeover");
        assert_eq!(received[0]["queue"][0], "q");
    }

    #[test]
    fn claiming_releases_the_previous_player_without_a_handoff() {
        let mut hub = Hub::default();
        let (_, mut first) = connect(&mut hub, "u", "first");
        let (_, _second) = connect(&mut hub, "u", "second");
        hub.receive("u", "first", message(json!({ "type": "claim" })));
        drain(&mut first);
        hub.receive("u", "second", message(json!({ "type": "claim" })));
        let received = drain(&mut first);
        assert_eq!(received[0]["type"], "release");
        assert_eq!(received[0]["handoff"], false);
        assert_eq!(received[1]["active"], "second");
    }

    #[test]
    fn an_offline_player_leaves_the_list_once_playback_moves_on() {
        let mut hub = Hub::default();
        let (player_connection, _player) = connect(&mut hub, "u", "player");
        hub.receive("u", "player", message(json!({ "type": "claim" })));
        hub.leave("u", "player", player_connection);
        let (_, mut phone) = connect(&mut hub, "u", "phone");
        hub.receive("u", "phone", message(json!({ "type": "claim" })));
        let devices = drain(&mut phone).pop().unwrap();
        assert_eq!(devices["devices"].as_array().unwrap().len(), 1);
        assert_eq!(devices["active"], "phone");
    }

    #[test]
    fn a_reload_replaces_the_connection_and_the_old_close_is_ignored() {
        let mut hub = Hub::default();
        let (old_connection, _old) = connect(&mut hub, "u", "tab");
        hub.receive("u", "tab", message(json!({ "type": "claim" })));
        let (_, mut fresh) = connect(&mut hub, "u", "tab");
        hub.leave("u", "tab", old_connection);
        hub.receive("u", "tab", message(json!({ "type": "queue", "queue": ["q"] })));
        let welcome = drain(&mut fresh);
        assert_eq!(welcome[0]["active"], "tab");
        assert_eq!(welcome[0]["devices"][0]["online"], true);
    }
}
