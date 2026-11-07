# The relay

A small companion service next to vibemusic. The player works without it; the relay adds the
features that need something running all the time, or that need to talk to services outside your
network.

[Back to the overview](../README.md)

## What it adds

- **Remote control between devices.** Every vibemusic tab signed in to the same account sees the others:
  play on one and control it from another.
- **Genres and popularity.** It looks up your artists and albums on MusicBrainz, Deezer and
  Apple, for genre tags, artist countries and which tracks are popular. Genre playlists, "This is"
  playlists and the home page use this.
- **"This is" playlists.** With its own Navidrome account it keeps one playlist per artist with
  their most popular tracks that you own, with a generated cover, kept up to date as your
  library changes. They're ordinary Navidrome playlists, so other apps see them too.
- **Internet radio.** Stations configured in Navidrome play through the relay, so the background
  can move with them.
- **Shared links.** The public page a shared link opens gets its track list from the relay, and
  chat apps get a title and a cover for their previews. Without the relay, links can still be
  created but not opened. See [Shared links](features/shared-links.md).

## What it sends outside

To look up genres and popularity, the relay sends **artist names, album titles and a few track
titles** from your library to:

| Service | For |
|---|---|
| MusicBrainz | genre tags and countries of artists and albums |
| Deezer | genres, popularity and top tracks |
| Apple (iTunes Search) | top tracks, from the country catalogues you choose |

Nothing else leaves: no accounts, no listening history, no files. Answers are cached, so each
artist is looked up again only every couple of weeks.

To use fewer services, list the ones the relay may ask; empty means none:

```bash
# only MusicBrainz
ENRICHMENT_SOURCES=musicbrainz
# none
ENRICHMENT_SOURCES=
```

Without them, genres come from your files' tags and popularity from your own play counts.
Navidrome makes its own lookups for artist photos and biographies; those are set in Navidrome
(`ND_AGENTS`), not here.

## Settings

All relay settings are listed in [Settings](configuration.md#relay).
