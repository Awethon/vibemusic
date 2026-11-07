# Behind your own domain

vibemusic serves plain HTTP on one port. Your reverse proxy adds the domain and HTTPS, and sends
everything for that domain to that port. vibemusic does its own routing behind it (to Navidrome
and the relay), so the proxy needs no special paths.

[Back to the overview](../README.md)

## What to point where

| Address | Points to | Who should reach it |
|---|---|---|
| `music.example.com` | vibemusic's port (`8080`) | everyone you share music with |
| Navidrome's port (`4533`) | Navidrome's own web UI | your local network only |

Navidrome's API goes through vibemusic, so Subsonic apps on your phone can use
`https://music.example.com` as their server. Navidrome's web UI with its admin pages does not:
keep its port off the internet.

## Share links

Set Navidrome's `ND_SHAREURL` to your public address, for example `https://music.example.com`, so
share links point at vibemusic. With the bundled Navidrome that's in `navidrome.env`; `setup.sh`
sets it when you give it a public address.

## Caddy

```
music.example.com {
	reverse_proxy 192.168.1.10:8080
}
```

Caddy gets the certificate on its own and passes WebSockets and streams through as they are.

## nginx

```nginx
server {
    listen 443 ssl;
    server_name music.example.com;
    # ssl_certificate ... as for your other websites

    location / {
        proxy_pass http://192.168.1.10:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Remote control between devices uses a WebSocket.
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        # Music and radio stream; don't hold them back.
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}

# Once, in the http block:
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

## Cloudflare Tunnel

Add a public hostname for `music.example.com` with service `HTTP` and URL
`192.168.1.10:8080` (or `vibemusic:80` if `cloudflared` runs in the same compose file).

## Proxy in the same compose file

If your proxy is a container in the same compose file as vibemusic, it can reach vibemusic by
service name instead of the machine's address: `reverse_proxy vibemusic:80` in Caddy, or
`proxy_pass http://vibemusic:80` in nginx. Then vibemusic doesn't need a published port at all.
