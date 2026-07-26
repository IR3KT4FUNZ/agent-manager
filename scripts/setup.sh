#!/usr/bin/env bash
# Bootstrap a fresh clone and launch the app.
#
#   scripts/setup.sh            install deps, generate icons, build the web frontend, launch the native app
#   scripts/setup.sh --desktop  build the distributable macOS app bundle instead of launching
set -euo pipefail
cd "$(dirname "$0")/.."

command -v bun >/dev/null || { echo "error: bun is required — https://bun.sh" >&2; exit 1; }
command -v cargo >/dev/null || { echo "error: the Rust toolchain is required — https://rustup.rs" >&2; exit 1; }

echo "==> Installing dependencies"
bun install

echo "==> Generating Tauri icons from apps/desktop/app-icon.png"
(cd apps/desktop && bunx tauri icon app-icon.png)

echo "==> Building web frontend"
bun run build

if [[ "${1:-}" == "--desktop" ]]; then
  echo "==> Building macOS app bundle"
  bun run --cwd apps/desktop build
  echo
  echo "App bundle: apps/desktop/src-tauri/target/release/bundle/macos/Agent Manager.app"
else
  echo
  echo "==> Launching Agent Manager (first launch compiles the native shell and can take a few minutes)"
  exec bun run --cwd apps/desktop dev
fi
