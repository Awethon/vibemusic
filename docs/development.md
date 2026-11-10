# Development

[Back to the overview](../README.md)

## Layout

| Folder | What |
|---|---|
| `app/` | The web app: Svelte 5 with SvelteKit, TypeScript, SQLite (WebAssembly) in a worker |
| `relay/` | The relay: Rust, axum |
| `dev/` | A Navidrome with test music, for development |
| `compose.yaml`, `setup.sh` | The installed setup ([New setup](install-new.md)) |

## Run it

You need Node 26 with pnpm, Rust, and Docker.

1. **Navidrome with test music.** Put some music in `dev/music/`, copy `dev/.env.example` to
   `dev/.env`, then:

   ```bash
   docker compose -f dev/compose.yaml up -d
   ```

   It listens on `127.0.0.1:4534` and creates an `admin` account with the password from
   `dev/.env`.

2. **The relay** (optional), on port 4600:

   ```bash
   cd relay
   NAVIDROME_URL=http://127.0.0.1:4534 cargo run
   ```

3. **The app**, on `http://localhost:5190`:

   ```bash
   cd app
   pnpm install
   pnpm dev
   ```

   The dev server forwards Navidrome's and the relay's paths, like the installed setup does.
   `NAVIDROME_URL` and `RELAY_URL` point it elsewhere.

## Checks

```bash
cd app
pnpm test
pnpm check
pnpm lint
pnpm format:check
```

```bash
cd relay
cargo test
cargo clippy --all-targets
cargo fmt --check
```

## Building the images

```bash
docker compose build
```

builds `app/Dockerfile` (the app served by Caddy, with `app/Caddyfile` doing the routing) and
`relay/Dockerfile`.

## CI and releases

GitHub Actions runs the checks above on every push and pull request. Every push to main that
passes them also publishes both images for amd64 and arm64 to `ghcr.io/awethon/vibemusic` and
`ghcr.io/awethon/vibemusic-relay` as `edge`. Pushing a tag such as `v0.2.0` publishes them as
`0.2.0`, `0.2` and `latest` and creates a GitHub release with generated notes, again only if the
checks pass.
