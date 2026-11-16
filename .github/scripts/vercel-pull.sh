#!/usr/bin/env bash
# vercel-pull.sh <environment>
# Pulls a Vercel project's settings and env (production or preview) into .vercel/, and explains
# the one failure that has a known cause: a token scoped to another project.
# Needs: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, APP (client, studio or docs).
set -euo pipefail

: "${APP:?}" "${VERCEL_TOKEN:?}" "${VERCEL_ORG_ID:?}" "${VERCEL_PROJECT_ID:?}"

if ! vercel pull --yes --environment="$1" --token "$VERCEL_TOKEN" 2>&1 | tee pull.log; then
  if grep -q "Project not found" pull.log; then
    echo "::error::The Vercel token cannot see the $APP project ($VERCEL_PROJECT_ID). A token scoped to one project reports every other project as not found: make VERCEL_TOKEN a team-scoped token, or add a secret scoped to that project (VERCEL_STUDIO_TOKEN for the studio, VERCEL_DOCS_TOKEN for the guides). See docs/DEPLOY.md, step 3."
  fi
  exit 1
fi
