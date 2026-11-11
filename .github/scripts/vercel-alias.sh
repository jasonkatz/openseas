#!/usr/bin/env bash
# Aliases a preview deployment (URL) to the PR's stable host (HOST). The PR server only accepts
# requests from that origin, so the alias is not optional. Through the REST API rather than
# `vercel alias set`: the CLI loads the token's user first, and a team-scoped token has none
# ("User not found"). Writes `url=https://<host>` to GITHUB_OUTPUT.
set -euo pipefail

: "${URL:?}" "${HOST:?}" "${VERCEL_TOKEN:?}" "${VERCEL_ORG_ID:?}"

deployment="${URL#https://}"
body="$(curl -sS --max-time 30 -o /dev/stdout -w '\n%{http_code}' -X POST \
  "https://api.vercel.com/v2/deployments/$deployment/aliases?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d "{\"alias\":\"$HOST\"}")"
status="${body##*$'\n'}"
if [ "$status" = 200 ] || [ "$status" = 201 ]; then
  echo "aliased $deployment to https://$HOST"
  echo "url=https://$HOST" >> "$GITHUB_OUTPUT"
  echo "${APP:-preview} alias: https://$HOST" >> "$GITHUB_STEP_SUMMARY"
else
  echo "::error::Could not alias $deployment to $HOST (HTTP $status): ${body%$'\n'*}. If that name is taken on vercel.app, set the repository variable PREVIEW_ALIAS_PREFIX (or PREVIEW_HARNESS_ALIAS_PREFIX, or PREVIEW_DOCS_ALIAS_PREFIX) to something unique and re-run. See docs/DEPLOY.md, \"Previews\"."
  exit 1
fi
