# The app as one container: the static build served by Caddy, which also routes Navidrome's and
# the relay's paths so the browser sees a single origin. Settings come from the environment; see
# Caddyfile and the compose.yaml next to the repo root.
FROM node:26-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/build /srv/vibemusic
EXPOSE 80
