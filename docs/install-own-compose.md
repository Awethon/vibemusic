# Add to your compose file

For when one `compose.yaml` runs all your services, Navidrome among them. You add two services,
and they reach Navidrome by name on the shared network.

[Back to the overview](../README.md)

## Get the source

There are no published images yet, so Docker builds them from a copy of this repository:

```bash
git clone <this repository> /srv/vibemusic
```

## Add the services

Next to your `navidrome` service:

```yaml
  vibemusic:
    build: /srv/vibemusic/app
    restart: unless-stopped
    ports:
      - 8080:80
    environment:
      - NAVIDROME_URL=http://navidrome:4533
      - RELAY_URL=http://vibemusic-relay:4600

  vibemusic-relay:
    build: /srv/vibemusic/relay
    restart: unless-stopped
    environment:
      - NAVIDROME_URL=http://navidrome:4533
    volumes:
      - ./vibemusic-relay:/data
```

- Use your Navidrome service's name in both `NAVIDROME_URL`s.
- Leave out `vibemusic-relay` if you don't want [the relay](relay.md); you go without the
  features listed there.
- If your reverse proxy runs in the same compose file, you can drop `ports` and point it at
  `vibemusic:80`. See [Behind your own domain](reverse-proxy.md).
- The relay runs as user `nobody`. With a folder instead of a named volume, make the folder
  writable for it, or run the relay as your own user with `user: 1000:1000`.

Start them:

```bash
docker compose up -d vibemusic vibemusic-relay
```

## Settings

Add any option from [Settings](configuration.md) under `environment`, for example:

```yaml
    environment:
      - NAVIDROME_URL=http://navidrome:4533
      - RELAY_URL=http://vibemusic-relay:4600
      - VIBEMUSIC_GENRE_HIDDEN=Christmas
      - VIBEMUSIC_DEFAULT_BACKGROUND=amber
```

Genre and visitor settings belong to the `vibemusic` service; relay settings, including the
account for "This is" playlists, belong to `vibemusic-relay`.

## "This is" playlists

Create a non-admin user in Navidrome's web UI (for example `vibemusic-relay`) and give the relay
its login:

```yaml
      - VIBEMUSIC_RELAY_NAVIDROME_USER=vibemusic-relay
      - VIBEMUSIC_RELAY_NAVIDROME_PASSWORD=${VIBEMUSIC_RELAY_PASSWORD}
```

with the password in the `.env` file next to your compose file.

## Updating

```bash
git -C /srv/vibemusic pull
docker compose up -d --build vibemusic vibemusic-relay
```
