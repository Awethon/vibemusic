use std::collections::HashMap;
use std::time::Instant;

use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedSender;

pub type Outbox = UnboundedSender<String>;

struct Connection {
    id: u64,
    outbox: Outbox,
}

struct Device {
    id: String,
    name: String,
    connection: Option<Connection>,
}

#[derive(Default)]
struct Room {
    devices: Vec<Device>,
    active: Option<String>,
    queue: Option<Value>,
    playback: Option<(Value, Instant)>,
}

impl Room {
    fn device(&self, id: &str) -> Option<&Device> {
        self.devices.iter().find(|device| device.id == id)
    }

    fn online(&self, id: &str) -> bool {
        self.device(id).is_some_and(|device| device.connection.is_some())
    }

    fn send(&self, id: &str, message: &Value) {
        if let Some(connection) = self.device(id).and_then(|device| device.connection.as_ref()) {
            let _ = connection.outbox.send(message.to_string());
        }
    }

    fn broadcast(&self, message: &Value, except: Option<&str>) {
        let text = message.to_string();
        for device in &self.devices {
            if Some(device.id.as_str()) == except {
                continue;
            }
            if let Some(connection) = &device.connection {
                let _ = connection.outbox.send(text.clone());
            }
        }
    }

    fn device_list(&self) -> Value {
        json!({
            "type": "devices",
            "active": self.active,
            "devices": self.devices.iter().map(|device| json!({ "id": device.id, "name": device.name, "online": device.connection.is_some() })).collect::<Vec<_>>(),
        })
    }

    fn announce_devices(&mut self) {
        let active = self.active.clone();
        self.devices.retain(|device| device.connection.is_some() || active.as_deref() == Some(device.id.as_str()));
        self.broadcast(&self.device_list(), None);
    }

    fn playback_message(&self) -> Value {
        match &self.playback {
            Some((playback, at)) => json!({ "type": "playback", "playback": playback, "ageMs": at.elapsed().as_millis() as u64 }),
            None => json!({ "type": "playback", "playback": null, "ageMs": 0 }),
        }
    }

    fn take_over(&mut self, to: &str) {
        self.active = Some(to.to_owned());
        let playback = self.playback_message();
        self.send(to, &json!({ "type": "takeover", "queue": self.queue, "playback": playback["playback"], "ageMs": playback["ageMs"] }));
        self.announce_devices();
    }
}

#[derive(Default)]
pub struct Hub {
    rooms: HashMap<String, Room>,
    next_connection: u64,
}

impl Hub {
    pub fn join(&mut self, user: &str, device_id: &str, name: &str, outbox: Outbox) -> u64 {
        self.next_connection += 1;
        let connection = Connection { id: self.next_connection, outbox };
        let room = self.rooms.entry(user.to_owned()).or_default();
        match room.devices.iter_mut().find(|device| device.id == device_id) {
            Some(device) => {
                device.name = name.to_owned();
                device.connection = Some(connection);
            }
            None => room.devices.push(Device { id: device_id.to_owned(), name: name.to_owned(), connection: Some(connection) }),
        }
        let mut welcome = room.device_list();
        welcome["type"] = json!("welcome");
        welcome["queue"] = room.queue.clone().unwrap_or(Value::Null);
        let playback = room.playback_message();
        welcome["playback"] = playback["playback"].clone();
        welcome["ageMs"] = playback["ageMs"].clone();
        room.send(device_id, &welcome);
        room.broadcast(&room.device_list(), Some(device_id));
        self.next_connection
    }

    pub fn leave(&mut self, user: &str, device_id: &str, connection_id: u64) {
        let Some(room) = self.rooms.get_mut(user) else { return };
        let Some(index) = room.devices.iter().position(|device| device.id == device_id) else { return };
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

    pub fn receive(&mut self, user: &str, device_id: &str, message: &Value) {
        let Some(room) = self.rooms.get_mut(user) else { return };
        let is_active = room.active.as_deref() == Some(device_id);
        match message["type"].as_str() {
            Some("queue") if is_active => {
                room.queue = Some(message["queue"].clone());
                room.broadcast(message, Some(device_id));
            }
            Some("playback") if is_active => {
                room.playback = Some((message["playback"].clone(), Instant::now()));
                room.broadcast(&room.playback_message(), Some(device_id));
            }
            Some("command") => {
                if let Some(active) = room.active.clone().filter(|active| active != device_id && room.online(active)) {
                    room.send(&active, &json!({ "type": "command", "command": message["command"], "from": device_id }));
                }
            }
            Some("claim") if !is_active => {
                let previous = room.active.replace(device_id.to_owned());
                if let Some(previous) = previous {
                    room.send(&previous, &json!({ "type": "release", "to": device_id, "handoff": false }));
                }
                room.announce_devices();
            }
            Some("transfer") => {
                let Some(to) = message["to"].as_str().filter(|to| room.online(to)) else { return };
                match room.active.clone() {
                    Some(active) if active == to => {}
                    Some(active) if room.online(&active) => room.send(&active, &json!({ "type": "release", "to": to, "handoff": true })),
                    _ => room.take_over(to),
                }
            }
            Some("handoff") if is_active => {
                room.queue = Some(message["queue"].clone());
                room.playback = Some((message["playback"].clone(), Instant::now()));
                match message["to"].as_str().filter(|to| room.online(to)).map(str::to_owned) {
                    Some(to) => room.take_over(&to),
                    None => room.announce_devices(),
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

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
        messages.iter().map(|message| message["type"].as_str().unwrap()).collect()
    }

    #[test]
    fn users_never_see_each_others_devices() {
        let mut hub = Hub::default();
        let (_, mut alice) = connect(&mut hub, "alice", "a1");
        let (_, mut bob) = connect(&mut hub, "bob", "b1");
        assert_eq!(drain(&mut alice).last().unwrap()["devices"].as_array().unwrap().len(), 1);
        assert_eq!(drain(&mut bob)[0]["devices"][0]["id"], "b1");
        hub.receive("bob", "b1", &json!({ "type": "claim" }));
        hub.receive("bob", "b1", &json!({ "type": "queue", "queue": [1] }));
        assert!(drain(&mut alice).is_empty());
    }

    #[test]
    fn commands_reach_only_the_active_device() {
        let mut hub = Hub::default();
        let (_, mut player) = connect(&mut hub, "u", "player");
        let (_, mut remote) = connect(&mut hub, "u", "remote");
        hub.receive("u", "player", &json!({ "type": "claim" }));
        drain(&mut player);
        drain(&mut remote);
        hub.receive("u", "remote", &json!({ "type": "command", "command": { "kind": "next" } }));
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
        hub.receive("u", "player", &json!({ "type": "claim" }));
        hub.receive("u", "remote", &json!({ "type": "queue", "queue": ["stolen"] }));
        drain(&mut remote);
        let (_, mut late) = connect(&mut hub, "u", "late");
        assert_eq!(drain(&mut late)[0]["queue"], Value::Null);
    }

    #[test]
    fn transfer_asks_the_player_for_a_handoff_then_hands_state_over() {
        let mut hub = Hub::default();
        let (_, mut player) = connect(&mut hub, "u", "player");
        let (_, mut target) = connect(&mut hub, "u", "target");
        hub.receive("u", "player", &json!({ "type": "claim" }));
        drain(&mut player);
        drain(&mut target);
        hub.receive("u", "target", &json!({ "type": "transfer", "to": "target" }));
        let release = drain(&mut player);
        assert_eq!(release[0]["type"], "release");
        assert_eq!(release[0]["handoff"], true);
        hub.receive("u", "player", &json!({ "type": "handoff", "to": "target", "queue": ["q"], "playback": { "position": 42 } }));
        let received = drain(&mut target);
        assert_eq!(types(&received), ["takeover", "devices"]);
        assert_eq!(received[0]["playback"]["position"], 42);
        assert_eq!(received[1]["active"], "target");
    }

    #[test]
    fn an_offline_player_keeps_the_room_state_for_play_here() {
        let mut hub = Hub::default();
        let (player_connection, _player) = connect(&mut hub, "u", "player");
        hub.receive("u", "player", &json!({ "type": "claim" }));
        hub.receive("u", "player", &json!({ "type": "queue", "queue": ["q"] }));
        hub.leave("u", "player", player_connection);
        let (_, mut phone) = connect(&mut hub, "u", "phone");
        let welcome = drain(&mut phone);
        assert_eq!(welcome[0]["devices"].as_array().unwrap().len(), 2);
        assert_eq!(welcome[0]["devices"][0]["online"], false);
        hub.receive("u", "phone", &json!({ "type": "transfer", "to": "phone" }));
        let received = drain(&mut phone);
        assert_eq!(received[0]["type"], "takeover");
        assert_eq!(received[0]["queue"][0], "q");
    }

    #[test]
    fn claiming_releases_the_previous_player_without_a_handoff() {
        let mut hub = Hub::default();
        let (_, mut first) = connect(&mut hub, "u", "first");
        let (_, _second) = connect(&mut hub, "u", "second");
        hub.receive("u", "first", &json!({ "type": "claim" }));
        drain(&mut first);
        hub.receive("u", "second", &json!({ "type": "claim" }));
        let received = drain(&mut first);
        assert_eq!(received[0]["type"], "release");
        assert_eq!(received[0]["handoff"], false);
        assert_eq!(received[1]["active"], "second");
    }

    #[test]
    fn an_offline_player_leaves_the_list_once_playback_moves_on() {
        let mut hub = Hub::default();
        let (player_connection, _player) = connect(&mut hub, "u", "player");
        hub.receive("u", "player", &json!({ "type": "claim" }));
        hub.leave("u", "player", player_connection);
        let (_, mut phone) = connect(&mut hub, "u", "phone");
        hub.receive("u", "phone", &json!({ "type": "claim" }));
        let devices = drain(&mut phone).pop().unwrap();
        assert_eq!(devices["devices"].as_array().unwrap().len(), 1);
        assert_eq!(devices["active"], "phone");
    }

    #[test]
    fn a_reload_replaces_the_connection_and_the_old_close_is_ignored() {
        let mut hub = Hub::default();
        let (old_connection, _old) = connect(&mut hub, "u", "tab");
        hub.receive("u", "tab", &json!({ "type": "claim" }));
        let (_, mut fresh) = connect(&mut hub, "u", "tab");
        hub.leave("u", "tab", old_connection);
        hub.receive("u", "tab", &json!({ "type": "queue", "queue": ["q"] }));
        let welcome = drain(&mut fresh);
        assert_eq!(welcome[0]["active"], "tab");
        assert_eq!(welcome[0]["devices"][0]["online"], true);
    }
}
