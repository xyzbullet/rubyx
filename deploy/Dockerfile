# syntax=docker/dockerfile:1.7
# ============================================================
# Wraith — multi-stage production image
#   stage 1: rust wisp node  (server/)
#   stage 2: frontend bundle (vite build)
#   runtime: nginx (shell) + wraith-server (tunnel) + optional tor
# ============================================================

FROM rust:1.82-slim AS rust
WORKDIR /build
COPY server/Cargo.toml server/Cargo.toml
COPY server/src server/src
RUN cargo build --release --manifest-path server/Cargo.toml

FROM node:20-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
# tunnel binary
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
