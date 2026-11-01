# vibemusic

*Music streaming, rethought for the music you own.*

vibemusic is a player for your [Navidrome](docs/install-existing-navidrome.md#what-navidrome-is)
library that works the way a music app should today. It has the things people actually miss from
streaming services, and leaves out what only gets in the way.

### Calm, and in colour

Each album colours the whole interface while it plays, and the background drifts with the music.
Screens show what you came for, with no maze of options, columns or settings you'll never touch.

### Faster than you can type

Your whole library lives right in the browser, so search, filters and sorting answer with every
keystroke, whether you have five hundred songs or fifty thousand. Playback is gapless, and your
queue follows you between devices.

### Moves with your hands

Swipe on a trackpad to bring in the queue, resize the sidebar or flick a song out of the queue. On
a phone, pull down to close the player and press and hold for options. Keyboard shortcuts cover
the rest.

### Always something new to play

Fresh genre mixes every week, and a "This is" playlist for each artist built from their
best-known songs. The home page suggests what to play rather than listing everything you own.

### Genres that make sense

Messy tags become a clear genre tree, filled in with what's known about your artists, so a
"Post-Punk" mix is actually post-punk.

### Every screen is a remote

Start music on the living-room speakers and control it from your phone.

## How it fits together

```
browser ──► vibemusic ──► Navidrome (your music server)
                 │
                 └──────► relay (optional: remote control, genres and popularity,
                                  "This is" playlists, radio, share previews)
```

vibemusic is a static web app with a small built-in router, so the browser only ever talks to one
address. The relay is an optional companion service; without it the player works and those
features are missing.

## Install

Pick the page that matches what you have:

| You have | Start here |
|---|---|
| Nothing yet, or no Navidrome | [New setup with its own Navidrome](docs/install-new.md) |
| A Navidrome you already run | [Next to your Navidrome](docs/install-existing-navidrome.md) |
| One compose file for all your services | [Add to your compose file](docs/install-own-compose.md) |
| A domain or reverse proxy (Caddy, nginx, Cloudflare Tunnel) | [Behind your own domain](docs/reverse-proxy.md) |

All of them use Docker Compose, and most of the work is done by `./setup.sh`.

## More

- [Settings](docs/configuration.md): every option, from genre playlists to the defaults visitors
  see.
- [The relay](docs/relay.md): what it does, and which outside services it asks about your music.
- [Development](docs/development.md): running the app and relay from source.

## Built with AI

vibemusic was implemented entirely by AI. Claude, Anthropic's model, working in Claude Code, wrote
all of the code, the tests and these docs. The person behind the project decided what to build
and how it should look and feel, made the design calls, reviewed the results and uses it every
day on their own server, but didn't write the code by hand.

So read it as you would any young project: the tests and checks in [Development](docs/development.md)
cover a lot, not everything, and bug reports are welcome.

## License

vibemusic is free software under the [GNU Affero General Public License v3.0 or later](LICENSE).
If you run a modified version for other people, the license asks you to offer them its source.
The bundled fonts, Onest and Unbounded, are under the SIL Open Font License.
