# Settings

Everything is set with environment variables. With the Compose setup they go in `.env` (and
Navidrome's own options in `navidrome.env`); `.env.example` lists them all with comments. After a
change, apply it with `docker compose up -d`. Lists are comma-separated.

[Back to the overview](../README.md)

## Setup

| Variable | Default | What it does |
|---|---|---|
| `COMPOSE_PROFILES` | `relay,navidrome` | Which optional parts run: `relay`, `navidrome` |
| `VIBEMUSIC_PORT` | `8080` | Port for vibemusic on this machine |
| `NAVIDROME_URL` | the bundled one | Navidrome as the containers reach it, e.g. `http://192.168.1.10:4533` |
| `MUSIC_FOLDER` | `./music` | Bundled Navidrome: your music folder, mounted read-only |
| `NAVIDROME_PORT` | `4533` | Bundled Navidrome: port for its own web UI, for your local network |

## Genre playlists

| Variable | Default | What it does |
|---|---|---|
| `VIBEMUSIC_GENRE_HIDDEN` | none | Genres that never get a playlist |
| `VIBEMUSIC_GENRE_PINNED` | none | Genres that always get one, however small |
| `VIBEMUSIC_GENRE_MAX_PLAYLISTS` | `24` | Most genre playlists |
| `VIBEMUSIC_GENRE_SONG_CAP` | `100` | Most tracks per playlist |
| `VIBEMUSIC_GENRE_MIN_SONGS` | `30`, sub-genres `50` | Tracks a genre needs |
| `VIBEMUSIC_GENRE_MIN_ARTISTS` | `2`, sub-genres `3` | Artists a genre needs |

Changes apply on each person's next visit, when their genre playlists are rebuilt.

## What visitors see first

Defaults for everyone who hasn't changed a setting themselves. Someone's own choice always wins.

| Variable | Values | Default |
|---|---|---|
| `VIBEMUSIC_DEFAULT_BACKGROUND` | `field`, `amber` (light through water) | `field` |
| `VIBEMUSIC_DEFAULT_RIPPLES` | `on`, `off` | `off` |
| `VIBEMUSIC_DEFAULT_FULL_SCREEN` | `minimal`, `classic` | `minimal` |
| `VIBEMUSIC_DEFAULT_SIDEBAR` | `open`, `mini` | `mini` |
| `VIBEMUSIC_DEFAULT_ARTIST_VIEW` | `list`, `grid` | `list` |
| `VIBEMUSIC_DEFAULT_TIMELINE` | `on`, `off` | `on` |
| `VIBEMUSIC_DEFAULT_RADIO` | `on`, `off` | `on` |
| `VIBEMUSIC_DEFAULT_GLASS` | `on`, `off` | `off` |
| `VIBEMUSIC_DEFAULT_GLASS_LOOK` | `default`, `clear`, `frosted`, `prism`, `pebble`, `bubble`, `slab`, or a look code | `default` |

A look code comes from Settings → Tune liquid glass → Look code: tune a look, copy its code, and
make it everyone's default.

## Relay

| Variable | Default | What it does |
|---|---|---|
| `ENRICHMENT_SOURCES` | `musicbrainz,deezer,apple` | Outside services it may ask; empty for none ([why](relay.md#what-it-sends-outside)) |
| `APPLE_STOREFRONTS` | `us` | Apple country catalogs to search, in order, e.g. `us,de` |
| `APPLE_PAUSE_MS` | `3200` | Pause between Apple requests (Apple allows about 20 a minute) |
| `VIBEMUSIC_RELAY_NAVIDROME_USER` | none | Navidrome account for "This is" playlists; unset turns them off |
| `VIBEMUSIC_RELAY_NAVIDROME_PASSWORD` | none | Its password |
| `THIS_IS_SKIP` | none | Artists that never get a "This is" playlist |
| `THIS_IS_MIN_TRACKS` | `13` | Tracks an artist needs for one |
| `THIS_IS_MAX_TRACKS` | `50` | Tracks per playlist |
| `THIS_IS_EVERY_HOURS` | `168` | Hours between full refreshes; changes are picked up hourly |
| `RADIO_LOCAL_PROXY` | none | Proxy for radio stations on `.local` addresses, which containers can't resolve |
| `RELAY_LOG` | `info` | Log level: `error`, `warn`, `info`, `debug` |

## Navidrome

With the bundled Navidrome, its own options go in `navidrome.env`; any `ND_*` option from
Navidrome's documentation works. `navidrome.env.example` has the useful ones: sharing and
`ND_SHAREURL`, scan schedule, where artist photos come from, and lyrics.

## Without Compose

The app container reads `NAVIDROME_URL`, `RELAY_URL` and the `VIBEMUSIC_*` variables above and
serves them to the app as `/config.json`. If you serve the built app some other way, write that
file yourself:

```json
{
  "genrePlaylists": { "hidden": ["Christmas"], "songCap": 60 },
  "settings": { "background": "amber", "glassLook": "frosted" }
}
```
