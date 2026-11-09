#!/usr/bin/env bash
# Build the 720px JPEG thumbnails used by the /ixen/ and /iam/ list pages.
# Source: ixen/<slug>/hero.png and iam/<slug>/portrait.png -> <dir>/thumb.jpg
# Only rebuilds when the source is newer than the thumbnail. Requires macOS sips.
set -euo pipefail
cd "$(dirname "$0")/.."
for src in ixen/*/hero.png iam/*/portrait.png; do
  [ -f "$src" ] || continue
  out="$(dirname "$src")/thumb.jpg"
  [ "$out" -nt "$src" ] && continue
  sips -s format jpeg -s formatOptions 78 -Z 720 "$src" --out "$out" >/dev/null
  echo "built $out"
done
