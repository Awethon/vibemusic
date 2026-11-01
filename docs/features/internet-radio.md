# Internet radio

vibemusic plays the internet radio stations configured in your Navidrome. They have their own
**Radio** page, play in the same player as your music, and the background moves with them just
as it does with tracks. When a station announces what it's playing, vibemusic shows the track's
title and artist instead of only the station's name. Radio needs [the relay](../relay.md):
stations are streamed through it, and it's the relay that reads the current track name out of
the stream.

[All features](README.md)

## Adding stations

Stations live in Navidrome, so everyone on the server sees the same list. You can add them in
Navidrome's own web UI, or in vibemusic if your account is a Navidrome admin: the Radio page then
ends with an **Add station** card. It asks for:

- a **name**, for example "Night Drive FM";
- a **stream address**, the address of the audio stream itself, for example
  `https://radio.example.net/stream`;
- a **website**, optional, for example `https://radio.example.net`.

Both addresses must start with `http://` or `https://`. If Navidrome doesn't accept the station,
the card says "Navidrome didn't accept the station. Check the addresses and try again."

Admins can also right-click a station (or press and hold on a touchscreen) and pick **Edit
station** or **Remove station**. Removing asks first, because it removes the station for everyone
on the server.

## Where stations appear

**Radio** sits in the sidebar (on phones, in the tabs at the bottom) next to the other sections.
It shows when there is at least one station, or when you're an admin and could add one. You can
hide it in Settings with the **Radio** switch; the default for new browsers comes from
`VIBEMUSIC_DEFAULT_RADIO` (`on` or `off`, `on` unless you change it). See
[Settings](../configuration.md).

The Radio page lists the stations by name, each as a card with a radio icon. Under the name is
the station's website without the `www.`, for example `radio.example.net`, or "Internet radio"
when the station has no website.

## Playing a station

Click a station to play it; click it again to pause. Its right-click menu has **Play**, and where a
station shows up in a track list it also offers **Play next** and **Add to queue**. Stations have
no album or artist to go to, can't be liked, and can't be shared or added to playlists: they aren't
tracks in your library.

While a station plays:

- **Title.** The current track's title, when the station announces one; otherwise the station's
  name.
- **Artist line.** The track's artist followed by the station's name, for example
  "June Rivers · Night Drive FM". Without an announced track it shows the website (or "Internet
  radio") as on the Radio page. The full-screen view adds "Internet radio" underneath.
- **Radio page.** The playing station's card gets an extra line with the track name and artist and a
  small pulsing live mark.
- **Cover.** Stations have no artwork, so a radio icon takes the cover's place everywhere,
  including the background.
- **Progress.** A **Live** badge stands where the seek bar would be.

Because the track name is shown as the track's title, it also reaches the phone's lock screen and
the computer's media controls.

## What's different from tracks

- **No seeking.** A station is live, so there is no seek bar and no length.
- **Pause and play reconnects.** Pressing play after a pause starts the station again from what
  it's broadcasting now, not from where you paused.
- **No preloading.** vibemusic loads the next track ahead of time so tracks follow each other
  without a gap. A station is never loaded ahead, so it starts when its turn comes.
- **Not saved with your queue.** vibemusic saves your queue to Navidrome so you can continue
  later, but stations aren't Navidrome tracks: while one is playing the queue isn't saved, and
  stations are left out of the saved queue.
- **No scrobbling, no play counts.** Listening to a station isn't reported to Navidrome.
- **No lyrics, no sharing.**

## Stations on `.local` addresses

Some stations only exist on your home network under a `.local` name, for example
`http://hifi.local:8000/stream`. Those names are found by asking the other devices on the network,
which a relay running in a container usually can't do, so such a station won't connect.

Set `RADIO_LOCAL_PROXY` on the relay to the address of a proxy that runs on your machine's own
network and can reach `.local` names, for example `http://192.168.1.10:8081`. The relay then
sends requests for `.local` stations to that proxy, telling it which `.local` host it really
wants. Stations on any other address are fetched directly, as before. See
[Settings](../configuration.md#relay).

## Without the relay

Stations still appear on the Radio page, and admins can still add, edit and remove them, because
that's between vibemusic and Navidrome. But they don't play: vibemusic always streams stations
through the relay, and there is no fallback that plays them directly. There's also no current
track name to show.

## How it works

**Why stations go through the relay.** The moving background listens to the music: it analyses
the sound as it plays. Browsers only allow a page to analyse audio that comes from its own
address, or from a server that explicitly says other websites may analyse it. Most radio stations
don't say so. So instead of the browser fetching the station directly, it asks vibemusic's own
address, the container passes that on to the relay, and the relay fetches the station and passes
the sound back. To the browser the stream now comes from vibemusic itself, and the background
can follow it. The container passes the sound on as soon as it arrives instead of collecting it,
so the stream isn't delayed.

**Starting a station.** The browser only names the station, by its id in Navidrome, along with
your usual Navidrome sign-in details. The relay asks Navidrome for the list of stations with those
details and looks up the stream address there. This means only people Navidrome accepts can
stream, and nobody can use the relay to fetch some other address. If Navidrome refuses the sign-in
or doesn't know the station, the stream fails. Connecting to the station may take up to 10
seconds; once connected, there is no time limit, since a radio stream never ends.

**Asking for the track name.** When the relay connects, it tells the station that it would like
"now playing" information mixed into the stream. Stations that support this (a common convention
among radio servers) answer with how many bytes of sound come between two pieces of information.
The relay then counts: after that many bytes of sound comes one byte giving the length of a small
block of text, then the block itself. The relay cuts every block out before passing the sound on,
since the browser would otherwise play the text as short bursts of noise. An empty block means
"nothing new".

**Reading the track name from a block.** Inside a block the relay looks for the stream title. By
convention it's written as "Artist - Title", so the relay splits it at the first " - ": the part
before is the artist, the part after is the title. Without that separator the whole text is the
title and the artist stays empty. An empty title is ignored.

**Ogg streams.** Some stations send Ogg streams (Opus or Vorbis audio), which don't use those
blocks. Instead they carry tags in the stream itself, usually starting a fresh set of tags when
the track changes. When the station says its stream is Ogg and doesn't use the blocks, the relay
watches the stream for these tag sets and reads the `TITLE` and `ARTIST` tags from them, whatever
their case. Tags without a title are ignored. The sound itself is passed on unchanged. Tag sets
can carry cover pictures, but the relay doesn't read those, and it stops collecting oversized tag
sets after a few megabytes.

**When a station sends nothing.** A station that doesn't support the blocks and isn't Ogg is
passed through untouched, and there is simply no track name to show. vibemusic keeps showing the
station's name and website.

**Keeping the track name.** The relay remembers the last track name it read for each station. All
open streams of the same station share that one entry: if two people listen to the same station,
whichever stream announces a change updates it for both. Each listener still has their own
connection to the station. When the last stream of a station closes, the relay forgets its track
name. Nothing is saved to disk, and the relay only knows a station's track name while someone is
streaming it.

**How often the app asks.** While a station is playing, vibemusic asks the relay for that
station's track name: every 2 seconds until the first title arrives, then every 10 seconds. It stops
asking while paused, and never has more than one question open at a time. When an answer has a
title, vibemusic shows it as described above; when it's empty, the station's name comes back.
