# syntax=docker/dockerfile:1.7
# ============================================================
# Wraith — multi-stage production image
#   stage 1: rust wisp node (server/)   — Debian/glibc toolchain
#   stage 2: frontend bundle (vite build)
#   runtime: nginx + wraith-server tunnel
# ============================================================

# >= 1.85 required: transitive deps (url -> idna -> icu_properties_data 2.x)
# are published with edition2024, stabilized in Rust 1.85.0
FROM rust:1.88-slim-bookworm AS rust
WORKDIR /build
COPY server/Cargo.toml server/Cargo.toml
COPY server/src server/src
# Pin the target dir so COPY --from has a stable, predictable path
# regardless of where cargo would otherwise place it relative to the manifest.
ENV CARGO_TARGET_DIR=/build/target
RUN cargo build --release --manifest-path server/Cargo.toml \
  && test -x /build/target/release/wraith-server

FROM node:20-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# NOTE: glibc base (not alpine) — the wisp binary links against the Debian
# toolchain from stage 1 and cannot exec on musl.
FROM nginx:1.27-bookworm AS runtime

# tunnel binary (fail fast with a clear message if the path ever drifts)
COPY --from=rust /build/target/release/wraith-server /usr/local/bin/wraith-server
# frontend shell
COPY --from=web /app/dist /usr/share/nginx/html

# nginx routes /wisp -> tunnel node, everything else -> shell
RUN cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
  listen 8080;
  root /usr/share/nginx/html;
  index index.html;

  location /wisp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
  }

  location / {
    try_files $uri /index.html;
  }
}
EOF

RUN printf '#!/bin/sh\nset -e\nwraith-server --bind 0.0.0.0:3000 ${SOCKS5:+--socks5 "$SOCKS5"} ${TOR_SOCKS:+--tor-socks "$TOR_SOCKS"} &\nexec nginx -g "daemon off;"\n' > /entrypoint.sh \
  && chmod +x /entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
