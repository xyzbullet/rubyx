#!/usr/bin/env bash
# Wraith preflight — run before pushing so the CI/docker build can't surprise you.
#   bash deploy/preflight.sh            # manifest + compile checks
#   bash deploy/preflight.sh --docker   # also run the full docker build
set -euo pipefail
cd "$(dirname "$0")/.."

ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

echo "── manifest checks"
for f in server/Cargo.toml server/src/main.rs package.json index.html public/sw.js deploy/Dockerfile; do
  [ -f "$f" ] && ok "$f" || die "missing $f"
done

grep -q "CARGO_TARGET_DIR=/build/target" deploy/Dockerfile \
  && ok "target dir pinned in Dockerfile" || die "Dockerfile lost CARGO_TARGET_DIR pin"
grep -q "nginx:1.27-bookworm" deploy/Dockerfile \
  && ok "runtime base is glibc (bookworm)" || die "runtime base must stay glibc — alpine cannot exec the binary"
grep -q "rust:1.88" deploy/Dockerfile \
  && ok "rust builder >= 1.85 (edition2024 deps)" || die "rust builder stage too old for edition2024 deps"

echo "── frontend build"
npm run build >/dev/null && ok "vite build"

if command -v cargo >/dev/null 2>&1; then
  echo "── rust compile check"
  cargo check --manifest-path server/Cargo.toml --quiet && ok "cargo check (server)"
else
  echo "── cargo not installed locally; skipping server compile check"
fi

if [ "${1:-}" = "--docker" ]; then
  command -v docker >/dev/null 2>&1 || die "docker not found"
  echo "── full image build"
  docker build -f deploy/Dockerfile -t wraith:preflight . && ok "docker build"
fi

echo "preflight passed — safe to push."
