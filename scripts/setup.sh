#!/usr/bin/env bash
# Bootstrap a fresh clone into a runnable app.
#
#   scripts/setup.sh            install deps, generate icons, build the web frontend
#   scripts/setup.sh --desktop  all of the above, then build the macOS app bundle
set -euo pipefail
cd "$(dirname "$0")/.."

command -v bun >/dev/null || { echo "error: bun is required — https://bun.sh" >&2; exit 1; }

echo "==> Installing dependencies"
bun install

echo "==> Generating Tauri icons from apps/desktop/app-icon.png"
(cd apps/desktop && bunx tauri icon app-icon.png)

echo "==> Building web frontend"
bun run build

if [[ "${1:-}" == "--desktop" ]]; then
  command -v cargo >/dev/null || { echo "error: the Rust toolchain is required for the desktop build — https://rustup.rs" >&2; exit 1; }
  echo "==> Building macOS app bundle"
  bun run --cwd apps/desktop build
  echo
  echo "App bundle: apps/desktop/src-tauri/target/release/bundle/macos/Agent Manager.app"
else
  echo
  echo "Done. Next steps:"
  echo "  bun run dev                        # server + web dev servers (browser UI)"
  echo "  bun run --cwd apps/desktop dev     # the same, inside the native macOS window"
  echo "  scripts/setup.sh --desktop         # build the distributable .app bundle"
fi
