# Remote play

Every open vibemusic signed in to the same Navidrome account knows about the others. Music plays
on one of them, and any other can control it: pause, skip, seek, change the volume, edit the
queue, or move playback over to itself with the position kept. It works between tabs on one
computer just as well as between a laptop and a phone.

[All features](README.md)

## What you need

- **The relay.** Remote play goes through the relay, the small companion service next to
  vibemusic (see [The relay](../relay.md)). It runs by default; it's the `relay` part of
  `COMPOSE_PROFILES` in [Settings](../configuration.md). Without it, every tab plays on its own
  and the devices button doesn't appear.
- **The same Navidrome account.** Devices are grouped per Navidrome user. Two people with their
  own accounts never see each other's devices; everyone who signs in with one shared account
  sees all of them.
- **WebSockets through your proxy.** Devices talk to the relay over a WebSocket at the same
  address as vibemusic. If you put vibemusic behind your own reverse proxy, it has to pass
  WebSockets through ([Behind your own domain](../reverse-proxy.md) shows how).

## Devices

A device is one open vibemusic tab. Two tabs in the same browser are two devices; a reloaded tab
stays the same device. A duplicated tab gets a device of its own.

Devices are named after the browser and the system they run on, for example "Chrome · Mac",
"Safari · iPhone" or "Firefox · Windows". When several devices share a name, the later ones get
a number: "Chrome · Mac (2)". Phones (iPhone and Android) get a phone icon, everything else a
laptop icon. Names can't be changed.

## Playing and controlling

At most one device is **playing**: it makes the sound and owns the queue. All the others are
**remotes**. A remote plays no audio. It shows what the playing device is doing (the track,
progress, play or pause, the volume, whether the track is liked, the whole queue) and sends
whatever you do to the playing device.

Everything you'd do on the playing device works from a remote: play, pause, next, previous,
seeking, volume and mute, playing an album or playlist, adding tracks to the queue, reordering
or removing queued tracks, and liking a track. The remote shows the result straight away; a
moment later the playing device's own update arrives and takes its place, so both always end up
showing the same thing.

While a tab is a remote, a banner at the top says "Playing on Chrome · Mac · this tab is a
remote", with a **Play here** button, and the devices button lights up with the playing device's
icon.

## The devices list

The devices button sits next to the player controls. It shows up once there's more than one
device, or while this tab is a remote. It opens a "Play on" list with this tab first:

- The playing device shows **Playing** or **Paused** (with "in this tab" if that's this one),
  with a small moving equalizer while it plays.
- Other devices show **Ready** and a **Play there** button; this tab shows **Play here**.

**Play there** moves playback to that device. The device that was playing pauses, sends its
queue and its exact position along, and becomes a remote, with a short note "Moved playback to
Phone". The new device picks up the same track at the same spot and says "Playing in this tab".
If the music was paused, it moves over paused.

**Play here** does the same, towards the tab you're in.

## Tap to start

Browsers don't let a page start sound on its own until someone has touched it. When playback
moves to a device nobody has touched yet, that device can't start right away. It shows "Tap
anywhere to start playing here", and the other devices show "Tap the screen on Phone to start
playing there". One tap on that device and the music starts.

## When two devices want to play

Pressing a play button on a remote controls the playing device; it doesn't start a second one.
So two devices only end up playing at once when they were both playing before they could see
each other, for example after the relay restarted or a network came back. Then the one that
reports last wins: the other pauses and becomes its remote. No position is handed over in this
case, since both already had their own music going.

## When a device goes away

When a remote closes or loses its connection, it simply leaves the list.

When the playing device closes or loses its connection, the relay keeps its last queue and
position, and the other devices don't lose anything. Each of them takes over that queue and
position on its own, paused: nobody asked them to play. The next device where you press play
becomes the playing one, and the rest become its remotes. **Play here** in the devices list does
the same in one step and starts playing right away.

When a device's connection drops, it keeps trying to reconnect, quickly at first and then less
often, up to every 30 seconds. Once back, it gets the current state and falls into place: as a
remote if another device is playing, or as the player if it was the playing one and nobody took
over in the meantime.

A tab you open later, even after every other one was closed while music was playing, also gets
that last queue and position, and can carry on from there.

## How it works

### Rooms

The relay keeps one room per Navidrome user, with that user's devices in it. It knows which
device is playing, and it remembers the last queue and playback state the playing device sent.
It keeps this in memory only: a restart of the relay starts every room empty, and the devices
fill it again as they reconnect.

The relay passes the queue, the playback state and the commands along without looking inside
them. Only the app understands them.

### Joining

When a tab opens, it connects to the relay and introduces itself with its device id, its name
and the user's Navidrome sign-in token. The relay asks Navidrome whether the token is valid, and
which user it belongs to; it never sees a password. A tab that doesn't introduce itself within
ten seconds, or whose token Navidrome rejects, is disconnected.

In reply the joining tab gets a welcome: the list of devices, which one is playing, the last
queue and playback state, and how old that state is. Everyone else in the room gets the updated
device list.

The device id lives in the tab's own session storage, so it survives a reload but not closing the
tab. A duplicated tab would copy it, so each tab holds a browser lock on its id for as long as it
is open, and a tab that finds its id already taken picks a new one. On plain-HTTP setups, where
browsers don't offer those locks, tabs ask each other over a browser channel instead.

### Who is in charge

Only the playing device may change the shared state. Queue and playback updates from any other
device are ignored by the relay, and commands from remotes go to the playing device only. The
playing device carries them out exactly as if they had been pressed there, then sends its new
state to everyone.

Becoming the playing device happens in two ways:

- **Taking over** ("Play there" or "Play here"). The relay asks the playing device to step down
  and hand over. It pauses, sends its final queue and position, and switches to being a remote.
  The relay stores that state and passes it to the new device, which becomes the playing one.
  If the playing device is offline and can't answer, the relay hands the new device the last
  state it stored.
- **Claiming.** A device that starts playing while no one else is playing tells the relay "I'm
  playing now". The relay makes it the playing device at once and tells the previous one, if
  any, to stop, without a handover.

### Keeping in step

The playing device sends:

- the **queue** whenever it changes, with a 50 ms pause so a single action that changes the
  queue several times sends it once;
- the **playback state** (track, playing or paused, position, length, volume, mute, liked, and
  whether it is waiting for a tap) whenever any of it changes, when the position jumps by more
  than one and a half seconds, and every ten seconds while playing.

The position isn't sent every second. Remotes move their progress bar forward on their own clock
and are corrected by the next update. Each update carries how long ago it was reported, and a
remote that just joined adds that time to the position, so it shows where the track really is.
The same applies on a handover: the new device starts from the stored position plus the time
that passed since.

### Staying connected

Both sides send a small keep-alive message every 25 seconds, so proxies along the way don't
close a quiet connection. When the connection does close, the tab reconnects after one second,
then waits twice as long after each failed try, up to 30 seconds.

When a playing tab reloads, its new connection may arrive before the old one has closed. The
relay goes by the newest connection, so the late close of the old one doesn't remove the device.

When the playing device's connection closes, it stays in the list as offline, and its last state
stays in the room. That's what lets the others take over its queue. Other offline devices are
dropped from the list right away, and so is the offline playing device once another device
becomes the playing one.

## Limits

- Remote play is between vibemusic tabs only. Other Subsonic apps signed in to the same account
  don't appear as devices.
- Only devices that are online can be chosen in the devices list.
- Device names come from the browser and can't be renamed; names longer than 60 characters are
  cut short.
- The relay keeps the room in memory, so restarting it forgets which device was playing until
  the devices reconnect.
