#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

make electron-all-64

mkdir -p bin
SUMS="bin/SHA256SUMS"
: > "$SUMS"

find ui/dist-electron -type f \( \
  -name '*.dmg' -o \
  -name '*.zip' -o \
  -name '*.exe' -o \
  -name '*.AppImage' -o \
  -name '*.deb' \
\) -print0 | sort -z | xargs -0 shasum -a 256 > "$SUMS"

VERSION="$(node -p "require('./ui/package.json').version")"

echo "Release artifacts are ready."
echo "Checksums: $SUMS"
echo
echo "Create the release manually with:"
echo "gh release create v${VERSION} --title \"${VERSION}\" --notes-file CHANGELOG.md --target master ui/dist-electron/* bin/SHA256SUMS"
