#!/usr/bin/env bash
# Builds one front end (APP: client, studio or docs) in CI against the PR server, deploys it as a
# preview of its own Vercel project (ADR 0016, ADR 0019, ADR 0038) and aliases it to the PR's
# stable host. Shared by the Preview workflow's three Vercel jobs. The guides talk to no server and
# are built without SERVER_URL.
# Needs: VERCEL_TOKEN (one that can see this app's project), VERCEL_ORG_ID, VERCEL_PROJECT_ID, SHA,
# BRANCH, PR, APP, HOST; SERVER_URL optional.
# Writes `url=https://<HOST>` to GITHUB_OUTPUT.
set -euo pipefail

: "${APP:?}" "${SHA:?}" "${BRANCH:?}" "${PR:?}" "${HOST:?}"

.github/scripts/vercel-pull.sh preview

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
  echo "::error::vercel build produced no .vercel/output for $APP. Check the project's Root Directory and the vercel.json it holds. See docs/DEPLOY.md, step 2."
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
# A project with a Root Directory (the studio's, the guides') is refused by `vercel deploy` unless
# that directory exists under the deploy cwd, even for a prebuilt deployment that uploads only
# .vercel/output. Recreate it, empty, in the copy.
root="$(jq -r '.settings.rootDirectory // empty' .vercel/project.json)"
if [ -n "$root" ]; then mkdir -p "$out/$root"; fi
vercel deploy --prebuilt --cwd "$out" --token "$VERCEL_TOKEN" \
  --meta commitSha="$SHA" \
  --meta commitRef="$BRANCH" \
  --meta repo="${GITHUB_REPOSITORY:-}" \
  --meta prNumber="$PR" \
  --meta app="$APP" \
  | tee deploy-url.txt
url="$(tail -n1 deploy-url.txt)"
echo "${APP^} preview: $url (commit $SHA)" >> "$GITHUB_STEP_SUMMARY"

URL="$url" .github/scripts/vercel-alias.sh
