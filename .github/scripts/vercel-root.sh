#!/usr/bin/env bash
# The repository, not the Vercel project, names a front end's Root Directory. Run after
# `vercel pull`: when ROOT is set and the pulled project settings name another directory, the
# pulled copy (.vercel/project.json) is corrected so `vercel build` runs in ROOT. That keeps a
# renamed package building before the project's own setting is changed (packages/harness became
# packages/studio in M9, ADR 0042), and on any pull request that still predates the change.
# Prints the directory the project itself names (empty if none): `vercel deploy` wants that one to
# exist under its cwd, so the caller creates it.
# Needs: jq. Reads: ROOT (optional).
set -euo pipefail

f=.vercel/project.json
project_root="$(jq -r '.settings.rootDirectory // empty' "$f" 2>/dev/null || true)"
if [ -n "${ROOT:-}" ] && [ "$project_root" != "$ROOT" ]; then
  jq --arg root "$ROOT" '.settings.rootDirectory = $root' "$f" > "$f.next"
  mv "$f.next" "$f"
  echo "::notice::The Vercel project names Root Directory '${project_root:-none}'; building in '$ROOT'. Set the project's Root Directory to '$ROOT' (docs/DEPLOY.md, step 2b.2)." >&2
fi
printf '%s\n' "$project_root"
