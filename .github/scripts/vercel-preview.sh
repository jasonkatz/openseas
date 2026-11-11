#!/usr/bin/env bash
# Builds one front end (APP: client, harness or docs) in CI against the PR server and deploys it as
# a preview of its own Vercel project (ADR 0016, ADR 0019, ADR 0038). Shared by the preview jobs.
# The guides (docs) talk to no server and are built without SERVER_URL.
# Needs: VERCEL_TOKEN (one that can see this app's project), VERCEL_ORG_ID, VERCEL_PROJECT_ID, SHA,
# BRANCH, PR, APP; SERVER_URL optional.
# Writes `url=<deployment url>` to GITHUB_OUTPUT.
set -euo pipefail

: "${APP:?}" "${VERCEL_TOKEN:?}" "${VERCEL_ORG_ID:?}" "${VERCEL_PROJECT_ID:?}" "${SHA:?}" "${BRANCH:?}" "${PR:?}"

set -o pipefail
if ! vercel pull --yes --environment=preview --token "$VERCEL_TOKEN" 2>&1 | tee pull.log; then
  if grep -q "Project not found" pull.log; then
    echo "::error::The Vercel token cannot see the $APP project ($VERCEL_PROJECT_ID). A token scoped to one project reports every other project as not found: add a secret scoped to that project (VERCEL_HARNESS_TOKEN for the harness, VERCEL_DOCS_TOKEN for the guides), or make VERCEL_TOKEN a team-scoped token. See docs/DEPLOY.md, step 2b.7."
  fi
  exit 1
fi

# `vercel build` reads the pulled env from this file. Replace the project's preview
# VITE_SERVER_URL (the production server) with the PR server, when there is one.
if [ -n "${SERVER_URL:-}" ]; then
  f=.vercel/.env.preview.local
  touch "$f"
  grep -v '^VITE_SERVER_URL=' "$f" > "$f.next" || true
  printf 'VITE_SERVER_URL="%s"\n' "$SERVER_URL" >> "$f.next"
  mv "$f.next" "$f"
  echo "$APP will talk to $SERVER_URL"
  export VITE_SERVER_URL="$SERVER_URL"
else
  unset VITE_SERVER_URL
fi

COMMIT_SHA="$SHA" vercel build --token "$VERCEL_TOKEN"
if [ ! -d .vercel/output ]; then
  echo "::error::vercel build produced no .vercel/output for $APP. For the harness or the guides, check that the project's Root Directory is packages/$APP. See docs/DEPLOY.md, steps 2b and 2c."
  exit 1
fi

# Deploy from a copy of .vercel outside the checkout. The CLI reads the last commit from the git
# repo it runs in and attaches it as githubCommit* metadata, which makes Vercel credit the
# deployment to the commit's author; on a Hobby team a commit authored outside the team (Claude's
# noreply address, say) leaves the deployment BLOCKED. Outside a repo there is no commit to read,
# and the deployment is credited to the token's owner. A blocked deployment never finishes, so the
# calling step carries a timeout.
out="$RUNNER_TEMP/preview-$APP"
rm -rf "$out"
mkdir -p "$out"
cp -R .vercel "$out/"
# A project with a Root Directory (the harness: packages/harness) is refused by `vercel deploy`
# unless that directory exists under the deploy cwd, even for a prebuilt deployment that uploads
# only .vercel/output. Recreate it, empty, in the copy.
root="$(jq -r '.settings.rootDirectory // empty' .vercel/project.json 2>/dev/null || true)"
if [ -n "$root" ]; then
  mkdir -p "$out/$root"
  echo "$APP has Root Directory $root"
fi
set -o pipefail
vercel deploy --prebuilt --cwd "$out" --token "$VERCEL_TOKEN" \
  --meta commitSha="$SHA" \
  --meta commitRef="$BRANCH" \
  --meta repo="${GITHUB_REPOSITORY:-}" \
  --meta prNumber="$PR" \
  --meta app="$APP" \
  | tee deploy-url.txt
url="$(tail -n1 deploy-url.txt)"
echo "url=$url" >> "$GITHUB_OUTPUT"
echo "${APP^} preview: $url (commit $SHA)" >> "$GITHUB_STEP_SUMMARY"
