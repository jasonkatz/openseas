#!/usr/bin/env bash
# Builds one front end (APP: client, studio or docs) in CI and deploys it to production on its own
# Vercel project (ADR 0014, ADR 0019, ADR 0038), then checks the live site. Shared by the Deploy
# workflow's three Vercel jobs. The project's Root Directory picks the vercel.json the build reads:
# the repository's for the game, packages/<app>/vercel.json for the studio and the guides.
# Needs: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, SHA, APP.
# Optional: URL (the production address; without it the post-deploy checks are skipped with a
# warning), DEEP_LINK (a path that must answer 200, proving the SPA rewrite is in effect).
set -euo pipefail

: "${APP:?}" "${SHA:?}"

.github/scripts/vercel-pull.sh production

COMMIT_SHA="$SHA" vercel build --prod --token "$VERCEL_TOKEN"
if [ ! -d .vercel/output ]; then
  echo "::error::vercel build produced no .vercel/output for $APP. Check the project's Root Directory and the vercel.json it holds. See docs/DEPLOY.md, step 2."
  exit 1
fi

vercel deploy --prebuilt --prod --token "$VERCEL_TOKEN" \
  --meta githubCommitSha="$SHA" \
  --meta githubCommitRef=main \
  --meta githubCommitOrg="${GITHUB_REPOSITORY_OWNER:-}" \
  --meta githubCommitRepo="${GITHUB_REPOSITORY#*/}" \
  | tee deploy-url.txt
echo "${APP^} deployed: $(tail -n1 deploy-url.txt) (commit $SHA)" >> "$GITHUB_STEP_SUMMARY"

if [ -z "${URL:-}" ]; then
  echo "::warning::No production URL is set for $APP; skipping the post-deploy checks. See docs/DEPLOY.md, step 3."
  exit 0
fi
.github/scripts/wait-for-commit.sh "$URL/version.json" "$SHA" 300

if [ -n "${DEEP_LINK:-}" ]; then
  status="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$URL$DEEP_LINK")"
  if [ "$status" != 200 ]; then
    echo "::error::$URL$DEEP_LINK returned HTTP $status; the SPA rewrite is not in effect. Check that the project's Root Directory is packages/$APP so its vercel.json is read. See docs/DEPLOY.md, step 2."
    exit 1
  fi
  echo "deep links open ($status)"
fi
