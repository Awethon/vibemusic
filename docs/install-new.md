# New setup with its own Navidrome

For a machine with your music on it and no Navidrome yet. You end up with three containers:
vibemusic, its relay, and Navidrome, which reads your music folder without changing it.

[Back to the overview](../README.md)

## What you need

- A computer that stays on: a mini PC, a NAS, a spare laptop. Linux, macOS and Windows (with
  WSL) all work.
- Docker with Docker Compose 2.24 or newer (`docker compose version`).
- `git` and `curl`.
- Your music in one folder. If it's spread over several, use the folder that contains them all.

## Install

```bash
git clone <this repository> vibemusic
cd vibemusic
./setup.sh
```

`setup.sh` asks a few questions:

1. **Do you already run Navidrome?** Answer `n`.
2. **Your music folder**, as a path on this machine, for example `/srv/media/music`.
3. **Port** for vibemusic, `8080` by default.
4. **Public address**, only if you'll put vibemusic behind a domain (see
   [Behind your own domain](reverse-proxy.md)). Leave it empty otherwise.

It writes `.env` and `navidrome.env`, builds the images (a few minutes the first time) and starts
everything.

## First visit

Open `http://<this machine>:8080`. On a new install vibemusic asks you to **create the first
account**. That account is also Navidrome's admin. Navidrome then scans your music; big
libraries take a while, and vibemusic fills in as it goes.

Navidrome's own web UI, for adding users or changing its settings, is at
`http://<this machine>:4533`. Keep that port on your local network.

## "This is" playlists

These need a separate, non-admin Navidrome account for the relay. Run `./setup.sh` again: it asks
for your admin login once, creates the account, saves it in `.env` and restarts the relay. The
first playlists appear a few minutes later. See [The relay](relay.md) for what else it does.

## Updating

```bash
git pull
docker compose up -d --build
```

Your library, accounts and playlists live in Docker volumes, so rebuilding keeps them.

## Where things are

| What | Where |
|---|---|
| vibemusic settings | `.env` ([Settings](configuration.md)) |
| Navidrome's own settings | `navidrome.env` |
| Navidrome's database and the relay's cache | Docker volumes `navidrome-data` and `relay-data` |
| Your music | untouched, mounted read-only |
