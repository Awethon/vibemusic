FROM rust:1-slim AS build
WORKDIR /relay
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /relay/target/release/vibemusic-relay /usr/local/bin/vibemusic-relay
USER nobody
EXPOSE 4600
CMD ["vibemusic-relay"]
