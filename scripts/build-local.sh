#!/usr/bin/env bash
# Build PhotoMap locally on the current OS.
#
# Usage:
#   ./scripts/build-local.sh
#
# Set TAURI_SIGNING_PRIVATE_KEY to the key content or a path to sign updater
# artifacts. If the default key at ~/.tauri/photomap.key exists it is used
# automatically. Without a key the build still succeeds, just without .sig
# files (the in-app updater needs them).
set -euo pipefail
cd "$(dirname "$0")/.."

KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.tauri/photomap.key}"
if [ -f "$KEY_PATH" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
  echo "Signing updater artifacts with $KEY_PATH"
else
  echo "No signing key found, building without updater signatures."
fi

npm install
npm run tauri build

echo
echo "Installers:"
find "src-tauri/target/release/bundle" -maxdepth 2 -type f \
  \( -name '*.dmg' -o -name '*.app.tar.gz' -o -name '*.msi' \
  -o -name '*-setup.exe' -o -name '*.deb' -o -name '*.rpm' \
  -o -name '*.AppImage' -o -name '*.sig' \) 2>/dev/null | sort
