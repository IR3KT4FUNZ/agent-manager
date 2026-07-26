#!/usr/bin/env bash
# Bootstrap a fresh clone into a runnable app.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v bun >/dev/null || { echo "error: bun is required — https://bun.sh" >&2; exit 1; }

echo "==> Installing dependencies"
bun install

echo "==> Building web frontend"
bun run build

echo
echo "Done. Next steps:"
echo "  bun run dev    # server (port 3001) + web dev server (port 5173)"
echo "  bun run start  # production: Bun serves the built app at http://localhost:3001"
