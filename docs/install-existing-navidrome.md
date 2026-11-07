# Next to your Navidrome

For when Navidrome already runs, on the same machine or another one. vibemusic adds two containers
(the app and its relay) and doesn't change your Navidrome.

[Back to the overview](../README.md)

## What Navidrome is

Navidrome is the music server vibemusic plays from: it scans your music files, keeps accounts,
play counts and playlists, and streams the tracks. vibemusic is a different face for it, and
other Navidrome or Subsonic apps keep working alongside.

## What you need

- Navidrome, reachable from the machine that runs vibemusic. vibemusic is tested with Navidrome
  0.64.
- Docker with Docker Compose 2.24 or newer, `git` and `curl`.

## Install

```bash
git clone <this repository> vibemusic
cd vibemusic
./setup.sh
```

1. **Do you already run Navidrome?** Answer `y`.
2. **Navidrome's address as Docker containers reach it.** The simplest is the machine's local
   address and Navidrome's port, for example `http://192.168.1.10:4533`. Give that machine a
   fixed address in your router so it doesn't change. `localhost` doesn't work here: inside a
   container it means the container itself.
3. **Port** for vibemusic, `8080` by default.

Then open `http://<this machine>:8080` and sign in with your Navidrome account.

## Settings in your Navidrome

vibemusic works with Navidrome's defaults. Two options make sharing work:

- `ND_ENABLESHARING=true` turns share links on. Without it, vibemusic says sharing is off when
  you try.
- `ND_SHAREURL` set to vibemusic's public address, if you have one, so share links open in
  vibemusic.

Artist photos, biographies and similar artists come from Navidrome's agents (`ND_AGENTS`), so
what you've set up there shows in vibemusic too.

## "This is" playlists

At the end, `setup.sh` offers to create a separate, non-admin account for the relay: give your
Navidrome admin login when it asks, and it creates the account and restarts the relay. If you
skipped that step, run `./setup.sh` again. See [The relay](relay.md).

## Updating

```bash
git pull
docker compose pull
docker compose up -d
```

`VIBEMUSIC_VERSION` in `.env` pins a release (see [Settings](configuration.md)). To build from
this copy of the source instead, run `docker compose up -d --build`.

## Behind a domain

Point your domain or reverse proxy at vibemusic's port, not at Navidrome: vibemusic passes
Navidrome's API through, so phone apps that speak Subsonic can use the same address. See
[Behind your own domain](reverse-proxy.md).
