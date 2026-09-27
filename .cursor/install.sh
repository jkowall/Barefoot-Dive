#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Barefoot Dive.
# Selects the Node version pinned in .node-version (via nvm when available),
# installs the locked dependency tree, and provisions the Playwright browser
# used by the smoke and visual suites.
set -euo pipefail

cd "$(dirname "$0")/.."

NODE_VERSION="$(tr -d '[:space:]' < .node-version)"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install "$NODE_VERSION"
  nvm alias default "$NODE_VERSION" >/dev/null
  nvm use "$NODE_VERSION" >/dev/null
else
  echo "nvm not found; using the Node already on PATH." >&2
fi

echo "Using Node $(node --version) / npm $(npm --version)"

npm ci

# Chromium (with OS deps) backs `npm run test:ui` and `npm run test:visual`.
npx playwright install --with-deps chromium
