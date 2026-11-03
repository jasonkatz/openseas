#!/usr/bin/env bash
# Decides which sides the Deploy workflow deploys for the checked-out commit (HEAD).
#
# A side deploys when its live commit differs from HEAD under the paths it is built from. The
# live commit comes from the side itself: /health for the server, /version.json for the game and
# the harness. When it cannot be read, or is not in this history, the side deploys. Comparing with
# HEAD^ instead would miss every merge whose own deploy never ran (a CI run on main that never
# started or was cancelled, a failed deploy job): this way the next deploy catches up.
#
# Env: SHA; SERVER_URL, CLIENT_URL, HARNESS_URL (optional); FORCE_SERVER, FORCE_CLIENT,
# FORCE_HARNESS ("true" to deploy regardless). Writes server=, client=, harness= to GITHUB_OUTPUT.
set -euo pipefail

live() { curl -fsS --max-time 15 "$1?t=$(date +%s)" 2>/dev/null | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p' || true; }

# changed <name> <force> <live-sha> <paths...>: prints true or false, and the reason on stderr.
changed() {
  local name="$1" force="$2" base="$3"
  shift 3
  if [ "$force" = true ]; then
    echo "$name: forced" >&2
    echo true
  elif [ -z "$base" ]; then
    echo "$name: live commit unknown, deploying" >&2
    echo true
  elif ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "$name: live commit $base is not in this history, deploying" >&2
    echo true
  elif git diff --quiet "$base" HEAD -- "$@"; then
    echo "$name: nothing under its paths changed since live $base" >&2
    echo false
  else
    echo "$name: changed since live $base" >&2
    echo true
  fi
}

shared="packages/engine packages/protocol packages/content pnpm-lock.yaml pnpm-workspace.yaml package.json .github/workflows/deploy.yml .github/scripts/plan-deploy.sh"
server_live="$([ -n "${SERVER_URL:-}" ] && live "$SERVER_URL/health" || true)"
client_live="$([ -n "${CLIENT_URL:-}" ] && live "$CLIENT_URL/version.json" || true)"
harness_live="$([ -n "${HARNESS_URL:-}" ] && live "$HARNESS_URL/version.json" || true)"

# shellcheck disable=SC2086
server="$(changed server "${FORCE_SERVER:-false}" "$server_live" packages/server $shared railpack.json)"
# shellcheck disable=SC2086
client="$(changed client "${FORCE_CLIENT:-false}" "$client_live" packages/client packages/boards $shared vercel.json)"
# shellcheck disable=SC2086
harness="$(changed harness "${FORCE_HARNESS:-false}" "$harness_live" packages/harness packages/boards $shared)"

{
  echo "server=$server"
  echo "client=$client"
  echo "harness=$harness"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "commit ${SHA:-$(git rev-parse HEAD)}: server=$server client=$client harness=$harness"
