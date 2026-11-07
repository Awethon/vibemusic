# Tech stack

What vibemusic is built with, and what each piece is for. Versions are the ones in use when this
page was written.

[Back to the overview](../README.md)

## The pieces

| Piece | What it is | Built with |
|---|---|---|
| The app | A static web app; everything runs in the browser | Svelte, TypeScript, SQLite in WebAssembly |
| The app container | Serves the app and routes Navidrome's and the relay's paths | Caddy |
| The relay | An optional service for remote play, lookups, radio and shared links | Rust |
| Navidrome | Your music server, which vibemusic plays from | Not part of vibemusic |

## The app

**Framework and language.** Svelte 5 with its runes for state, SvelteKit 3 for routing, and
TypeScript 6 throughout. Vite 8 builds it into plain static files (SvelteKit's static adapter,
with one fallback page), so it needs no server code of its own.

**The library.** The whole library is a SQLite 3.54 database running in WebAssembly inside a Web
Worker, so queries never block the page. Search uses SQLite's full-text index with a trigram
tokenizer, which finds matches in the middle of words. The database is saved to IndexedDB in
1 MB chunks, each with a hash, so a save only rewrites the chunks that changed. See
[Your library in the browser](features/library-in-your-browser.md).

**Talking to Navidrome.** The Subsonic API for playback, playlists, likes and sharing, and
Navidrome's own REST API for the library sync, which supports paging and sorting. Navidrome's
server-sent events tell the app when the library changes. Responses are checked with zod 4.

**Graphics.** The drifting colour background is a shader written twice, in WGSL for WebGPU and
in GLSL for WebGL2, and uses whichever the browser has. The caustics background and liquid glass
are WebGL2. Cover colours are picked in the OKLab colour space (see
[Album colours](features/album-colours.md)); covers show a ThumbHash placeholder while they load.

**Audio.** Two `<audio>` elements take turns so the next track can load early, for gapless
playback. Both feed one Web Audio graph, where an analyser listens for the beat that moves the
background.

**Browser features.** Web Locks and BroadcastChannel coordinate several open tabs (with a
localStorage fallback on plain http), the Media Session API puts the track on the lock screen and
media keys, and a WebSocket connects to the relay for remote play.

**Fonts.** Onest for text and Unbounded for headings, both under the SIL Open Font License,
bundled through Fontsource.

## The relay

**Language.** Rust, 2024 edition, on the Tokio async runtime.

**Serving.** axum 0.8 for HTTP and the WebSocket that remote play uses.

**Outside requests.** reqwest with rustls for Navidrome, the lookup services and radio streams.
Lookup answers are cached as JSON with serde.

**Drawing covers.** "This is" covers are drawn with the image and imageproc crates, with text set
by ab_glyph in the bundled fonts, and saved as JPEG.

**Logs.** tracing, with the level set by `RELAY_LOG` (passed to the relay as `RUST_LOG`).

## Outside services

Used only by the relay, and each can be turned off (see [The relay](relay.md)):

| Service | Used for |
|---|---|
| MusicBrainz web service | Genre tags and countries of artists and albums |
| Deezer API | Genres, popularity and top tracks |
| iTunes Search API | Top tracks per artist, in the country catalogues you choose |

## Packaging

- **Docker**, with multi-stage builds: the app is built on Node 26 and served from a small Caddy
  2 image; the relay is built on the official Rust image and runs on Debian slim as an unprivileged
  user.
- **Docker Compose** runs the app, the relay and optionally Navidrome, with profiles for the
  optional parts.
- **A POSIX shell script**, `setup.sh`, writes the settings and creates the relay's account.

## Tools

| For | App | Relay |
|---|---|---|
| Packages | pnpm | Cargo |
| Tests | Vitest 5 | `cargo test` |
| Type checks | svelte-check | the Rust compiler |
| Linting | oxlint | Clippy |
| Formatting | Prettier | rustfmt |

## How it was written

All of it was written by Claude, Anthropic's model, working in Claude Code. See
[Built with AI](../README.md#built-with-ai).
