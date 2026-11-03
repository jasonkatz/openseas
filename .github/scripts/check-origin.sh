#!/usr/bin/env bash
# check-origin.sh <server-url> <origin-url> <what>
# Preflights the server's API from a browser origin and fails unless the server allows exactly
# that origin. The browser preflights every API call, so a front end whose origin is missing from
# CLIENT_ORIGINS on the Railway service is unusable even though every deploy is green.
set -euo pipefail

server="$1"
origin="${2%/}"
what="${3:-the client}"

allowed="$(curl -sS --max-time 15 -o /dev/null -D - -X OPTIONS \
  -H "Origin: $origin" -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: content-type" \
  "$server/api/me" | tr -d '\r' | awk 'tolower($1)=="access-control-allow-origin:" {print $2}')"
if [ "$allowed" = "$origin" ]; then
  echo "server allows $origin ($what)"
  exit 0
fi
echo "::error::The server does not allow the origin of $what. Preflight from $origin returned Access-Control-Allow-Origin='${allowed:-<none>}'. Add exactly $origin to CLIENT_ORIGINS on the Railway service (comma-separate several) and deploy the change. See docs/DEPLOY.md step 1.4."
exit 1
