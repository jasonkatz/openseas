#!/usr/bin/env bash
# wait-for-commit.sh <url> <sha> <timeout-seconds>
# Polls a JSON endpoint until its "commit" field equals <sha>. The server exposes it at /health,
# the client at /version.json. Exits 0 when it matches, 1 on timeout.
set -euo pipefail

url="$1"
sha="$2"
timeout="${3:-900}"
interval=20
deadline=$((SECONDS + timeout))
last=""

while [ "$SECONDS" -lt "$deadline" ]; do
  # Cache-bust so a CDN never hands back the previous deployment's file. Follow redirects: the
  # game's apex domain answers with a 308 to www, and the redirect body has no commit in it.
  body="$(curl -fsSL --max-time 15 "${url}?t=$(date +%s)" 2>/dev/null || true)"
  live="$(printf '%s' "$body" | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')"
  if [ "$live" = "$sha" ]; then
    echo "$url serves $sha"
    exit 0
  fi
  if [ "$live" != "$last" ]; then
    echo "$url currently serves '${live:-nothing}'; waiting for $sha"
    last="$live"
  fi
  sleep "$interval"
done

echo "::error::$url did not serve $sha within ${timeout}s (last seen: '${last:-nothing}'). Check the Railway or Vercel deployment logs."
exit 1
