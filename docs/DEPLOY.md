# Deploying openseas

Merging to `main` is the release. Nothing is deployed by hand, and neither host watches the repo:
one GitHub Actions pipeline does the deploying, in order (ADR 0014).

## What happens on a merge

1. **CI** (`.github/workflows/ci.yml`) runs on the merge commit: engine purity lint, typecheck,
   unit and integration tests, migration drift check, client build and Playwright smoke.
2. When CI is green, **Deploy** (`.github/workflows/deploy.yml`) starts. It first works out what
   the commit touched; a docs-only merge deploys nothing.
3. **Server to Railway.** The runner records the commit on the service as `GIT_COMMIT_SHA`,
   uploads the checkout with `railway up`, and streams the Railpack build (`railpack.json`:
   install the workspace, typecheck the server, start it). Railway starts the new container,
   runs migrations on boot, and only swaps traffic once `/health` answers. The job then polls `/health` until it reports the new commit. If the
   server never comes up, the job fails and **the client is not deployed**.
4. **Game and harness to Vercel**, in parallel, each to its own project (ADR 0019). For each,
   the runner pulls the project's production settings and env, builds with `vercel build` (so the
   build runs in CI, not on Vercel), deploys the prebuilt output with `vercel deploy --prebuilt
   --prod`, and polls `/version.json` until it reports the commit. The harness job then checks
   that a deep link such as `/bilging` answers 200 (the SPA rewrite from
   `packages/harness/vercel.json` is in effect) and that the server allows the harness origin.
5. Deploys queue behind each other and never cancel one in flight. All jobs show up under the
   repo's **production** environment, so GitHub's Deployments view is the deploy history.

Manual runs: Actions → Deploy → **Run workflow**. Tick "server", "client" or "harness" to redeploy
a side even if nothing under it changed, for example after changing a Railway variable.

## Previews

Every pull request that touches a package or the build configuration gets its own full stack
(ADR 0017), built by the **Preview** workflow (`.github/workflows/preview.yml`):

1. **Server and database on Railway.** A Railway environment `pr-<number>` is created the first
   time by duplicating `production`: same services, same variables and settings, fresh volumes,
   so it has its own server and its own **empty** Postgres (the server's migrations build the
   schema on first boot). It gets its own `BETTER_AUTH_SECRET`. The job waits for Postgres,
   generates a Railway domain for the server, sets `CLIENT_ORIGINS` to the client address below
   and `GIT_COMMIT_SHA`, uploads the PR's commit with `railway up`, and polls `/health` until it
   reports the commit. Later pushes reuse the environment and just upload again.
2. **Game and harness on Vercel.** Each front end is built in CI with `vercel build` against its
   project's **Preview** env, with `VITE_SERVER_URL` replaced by the PR server, deployed with
   `vercel deploy --prebuilt` (no `--prod`) to its production project (ADR 0016), and aliased to a
   stable host: `<PREVIEW_ALIAS_PREFIX>-<number>.vercel.app` for the game (default
   `openseas-pr-<number>`) and `<PREVIEW_HARNESS_ALIAS_PREFIX>-<number>.vercel.app` for the
   harness (default `openseas-harness-pr-<number>`). The aliases are stable across pushes, which is
   what lets the server list both origins in `CLIENT_ORIGINS` before anything deploys. Without
   `VERCEL_HARNESS_PROJECT_ID` the harness preview skips with a warning and the game still previews.
3. One comment on the PR carries the URLs and is updated on every push.

**Preview cleanup** (`.github/workflows/preview-cleanup.yml`) deletes the Railway environment,
its database and the alias when the PR closes, and sweeps daily for `pr-*` environments whose PR
is already closed. Vercel keeps the preview deployments; they cost nothing idle.

- The Railway side needs `RAILWAY_API_TOKEN` and `RAILWAY_PROJECT_ID` (step 1.6), **repository**-
  scoped like the Vercel entries: preview runs happen outside the `production` environment. The
  token is a **workspace** token (an account token also works), not the project token the Deploy
  pipeline uses; project tokens are scoped to one environment and cannot create others. The
  workflows never run `railway link`, which needs a user: the CLI picks the project up from the
  `RAILWAY_PROJECT_ID` variable and every command names its environment and service. If the Railway entries are missing the
  server job skips with a warning and the client preview talks to the production server, which
  rejects its origin: UI only, as before ADR 0017.
- Pull requests from forks get no secrets; both jobs skip with a warning.
- Each open code PR runs a server and a Postgres on Railway until it closes. Close PRs you are
  done with. To tear one down by hand, run **Preview cleanup** with the PR number; run it with no
  number to sweep.
- Deployment Protection's Standard Protection keeps both previews behind a Vercel login.
  The server's `/health` and API are public, as production's are.
- The preview database is empty: you arrive as a new guest. Social sign-in does not work from a
  preview (the OAuth apps' redirect URIs are production's); guest accounts do.
- A new production variable or setting is picked up by the next *new* preview environment, since
  it is a duplicate. An existing `pr-*` environment keeps what it copied; close and reopen the PR,
  or run **Preview cleanup** for it and push again, to recreate it.
- A pull request only gets a preview from a push made after its branch carries this workflow, and
  only a push starts it (retargeting or editing the PR does not). For a PR that missed it, run
  **Preview** by hand from the Actions tab with the PR number; it looks the head up and deploys it.
- The client deploys from a copy of `.vercel` outside the git checkout, tagged with plain meta
  keys (`commitSha`, `commitRef`, `prNumber`). Inside a checkout the Vercel CLI reads the last
  commit and attaches it as `githubCommit*` metadata, which makes Vercel credit the deployment to
  the commit's author; on a Hobby team a commit authored outside the team (Claude's commits are)
  is **BLOCKED**. Outside a repo the deployment is credited to the owner of `VERCEL_TOKEN`. The
  deploy step times out after five minutes so a blocked deployment fails fast. Production deploys
  run inside the checkout: they ship merge commits, which the owner authors.
- If the alias step fails because the `vercel.app` name is taken, set the repository variable
  `PREVIEW_ALIAS_PREFIX` (or `PREVIEW_HARNESS_ALIAS_PREFIX`) to something unique and re-run.

## One-time setup

Order matters: the server's domain feeds the client's env, and the client's domain feeds the
server's CORS list.

### 1. Railway: server and Postgres

1. railway.com → **New Project** → **Empty project**. Do not connect the GitHub repo; the pipeline
   uploads the code.
2. **+ New → Database → PostgreSQL**.
3. **+ New → Empty Service**. Name it `server`. Open it → **Settings**:
   - Networking → **Generate Domain**. Note it; it is `https://<railway domain>` below.
   - Build → Builder **Railpack** (the default). Leave Root Directory empty: `railpack.json` is
     read from the uploaded repo root and scopes the build and start commands to the server
     package.
   - Deploy → **Healthcheck Path** `/health`, **Healthcheck Timeout** `120`,
     **Restart Policy** On Failure with `5` retries. These are service settings, not build
     config, so they live in the dashboard. (Railway's `railway.json` format that used to carry
     them is deprecated and ignored by Railpack builds; its successor is `railway config` IaC,
     which we have not adopted yet.)
4. Server service → **Variables** (raw editor):

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference to the Postgres service) |
   | `BETTER_AUTH_SECRET` | output of `openssl rand -base64 48` |
   | `BETTER_AUTH_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
   | `CLIENT_ORIGINS` | the game's and the harness's production URLs, comma-separated, filled in at steps 2.3 and 2b.5 |
   | `CROSS_SITE_COOKIES` | `true` |
   | `ALPHA_INVITE_CODE` | an invite code, or leave unset to let anyone in |
   | `LOG_LEVEL` | `info` |

   Railway supplies `PORT` itself. The pipeline sets `GIT_COMMIT_SHA` on every deploy.
   `CLIENT_ORIGINS` must be the browsers' exact origins: scheme and host, no path, no trailing
   slash, comma-separated, e.g. `https://www.openseas.online,https://test.openseas.online`. Better
   Auth trusts exactly these origins too, so a front end missing from the list cannot sign in. Railway stages variable edits; click **Deploy** on the staged change or the running
   server keeps the old value. The server logs the origins it loaded on boot
   (`openseas server listening`), and the Deploy pipeline fails with a pointer here if the
   server rejects a preflight from the client origin.
5. Project → **Settings → Tokens** → create a **project token** for the `production` environment.
   Copy it; it is `RAILWAY_TOKEN` in step 3.
6. For previews (ADR 0017): workspace → **Settings → Tokens** → create a **workspace token**.
   It is `RAILWAY_API_TOKEN` in step 3. Note the project ID (Project → **Settings → General**, or
   the UUID in the dashboard URL); it is `RAILWAY_PROJECT_ID`. The Postgres service must be named
   `Postgres` (the default) or set `RAILWAY_DATABASE_SERVICE` in step 3. The server's restart
   policy and healthcheck from step 3 are copied into every preview environment.

### 2. Vercel: client

The Vercel project is not connected to GitHub. Create it from the CLI in a local checkout:

```sh
npm i -g vercel
vercel login
vercel link --yes --scope <team-slug> --project openseas   # creates the project, writes .vercel/project.json (gitignored)
vercel env add VITE_SERVER_URL production                    # paste https://<railway domain>
vercel env add VITE_SERVER_URL preview                       # same value; a PR preview replaces it with its own server
cat .vercel/project.json                                     # orgId and projectId for step 3
```

Then in the dashboard, project → **Settings**:

1. General → Node.js version **22.x**.
2. Deployment Protection → production must open without a Vercel login. Standard Protection
   (previews and deployment URLs only) is fine.
3. Note the production domain (`openseas.vercel.app` or similar). Back in Railway, set
   `CLIENT_ORIGINS` to `https://<that domain>`; comma-separate several origins.
4. Account → **Settings → Tokens** → create a token scoped to the team. It is `VERCEL_TOKEN` in
   step 3.

### 2b. Vercel: harness

The harness is a second Vercel project on the same team, rooted in `packages/harness` so it reads
`packages/harness/vercel.json` (build command, output directory, SPA rewrite) instead of the
repository's `vercel.json`, which is the game's. Like the game's project it is not connected to
GitHub; the pipeline deploys it.

1. Create the project. Either dashboard → **Add New → Project → no repository**, name
   `openseas-harness`, or from a local checkout:

   ```sh
   vercel project add openseas-harness --scope <team-slug>
   ```

2. Project → **Settings → General**: Root Directory **`packages/harness`**, Framework Preset
   **Vite**, Node.js version **22.x**. Leave the build and output settings as detected; the
   `vercel.json` in that directory sets them. The same through the API, with the token from
   step 2.4 and the team id from `.vercel/project.json`:

   ```sh
   curl -X PATCH "https://api.vercel.com/v9/projects/openseas-harness?teamId=$VERCEL_ORG_ID" \
     -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
     -d '{"rootDirectory":"packages/harness","framework":"vite","nodeVersion":"22.x"}'
   ```

3. **Settings → Environment Variables**: `VITE_SERVER_URL` = `https://<railway domain>` for
   **Production** and **Preview**, the same value as on the game's project (a PR preview replaces
   it with its own server).
4. **Settings → Domains**: add `test.openseas.online`. `openseas.online` is already verified on
   the team, so no ownership challenge follows, but its DNS is hosted at the registrar (Hover),
   not Vercel: add a record there for `test`, either a **CNAME** to the target Vercel shows next
   to the domain (normally `cname.vercel-dns.com`) or an **A** record to Vercel's IP as the apex
   has. The domain turns valid once the record propagates; Vercel's domain page says when it does.
5. **Settings → Deployment Protection**: Standard Protection, as for the game, so previews and
   deployment URLs need a Vercel login and `test.openseas.online` opens without one. Testers are
   not team members.
6. Note the project id (**Settings → General**, or `vercel project inspect openseas-harness`);
   it is `VERCEL_HARNESS_PROJECT_ID` in step 3. Back in Railway, add `https://test.openseas.online`
   to `CLIENT_ORIGINS` on the server service (comma after the game's origin) and deploy the staged
   change; until then the harness deploys but cannot sign in, and the Deploy workflow's harness
   job fails on its origin check with a pointer here.
7. **A token that can see the project.** Vercel tokens can be scoped to the whole account, to a
   team, or to a single project, and a project-scoped token reports every other project as
   `Project not found`. Either `VERCEL_TOKEN` is scoped to the **team** (it then covers both
   projects), or add a second secret `VERCEL_HARNESS_TOKEN` scoped to `openseas-harness`
   (Account → **Settings → Tokens**, scope: that project; or `vercel tokens create "openseas
   harness CI" --project <harness project id>`). The harness jobs use `VERCEL_HARNESS_TOKEN` when
   it is set and `VERCEL_TOKEN` otherwise, and say so when the token cannot see the project.

### 3. GitHub: secrets and variables

Repo → **Settings → Secrets and variables → Actions**. Use repository scope for the Vercel and
preview entries: the Preview workflows run on pull requests outside the `production` environment
and cannot read environment-scoped values. `RAILWAY_TOKEN` can live on `production` if you want
required reviewers there later.

| Kind | Name | Value |
|---|---|---|
| Secret | `RAILWAY_TOKEN` | the Railway project token (production deploys) |
| Secret | `RAILWAY_API_TOKEN` | the Railway workspace token (previews) |
| Secret | `VERCEL_TOKEN` | the Vercel token: team-scoped, or scoped to the game's project |
| Secret | `VERCEL_HARNESS_TOKEN` | optional; a token scoped to the harness project, when `VERCEL_TOKEN` is not team-scoped (step 2b.7) |
| Variable | `RAILWAY_SERVICE` | `server` (the Railway service name; previews assume `server` if unset) |
| Variable | `RAILWAY_PROJECT_ID` | the Railway project ID (previews) |
| Variable | `RAILWAY_DATABASE_SERVICE` | optional; the Postgres service name if not `Postgres` |
| Variable | `PREVIEW_ALIAS_PREFIX` | optional; game previews live at `<prefix>-<pr>.vercel.app`, default `openseas-pr` |
| Variable | `PREVIEW_HARNESS_ALIAS_PREFIX` | optional; harness previews live at `<prefix>-<pr>.vercel.app`, default `openseas-harness-pr` |
| Variable | `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` |
| Variable | `VERCEL_PROJECT_ID` | `projectId` from `.vercel/project.json` (the game) |
| Variable | `VERCEL_HARNESS_PROJECT_ID` | the harness project's id (step 2b.6) |
| Variable | `PRODUCTION_SERVER_URL` | `https://<railway domain>` |
| Variable | `PRODUCTION_CLIENT_URL` | `https://<vercel production domain>` of the game |
| Variable | `PRODUCTION_HARNESS_URL` | `https://test.openseas.online` |

The URL variables are what let the pipeline wait for the server before deploying the front ends
and confirm each side serves the merged commit. Without them it deploys blind and warns.

Finally, **Settings → Branches** → protect `main` and require the CI checks before merging. The
checks are `Typecheck, unit, integration`, `Build and Playwright smoke (client)` and
`Build and Playwright smoke (harness)`.

### 4. Check it

Actions → Deploy → Run workflow with both boxes ticked. When it is green:

```sh
curl https://<railway domain>/health          # {"ok":true,"contentVersion":...,"commit":"<sha>"}
curl https://<vercel domain>/version.json     # {"commit":"<sha>"}
curl https://test.openseas.online/version.json
curl -o /dev/null -w '%{http_code}\n' https://test.openseas.online/bilging   # 200: deep links work
```

Open the harness, start a rated Bilging round, and confirm a result lands and the bench's checks
read "the same as this board". Open the game and confirm the same pirate is signed in.

## Rolling back

- A `git revert` PR is the normal path; it goes out through the pipeline like any merge.
- Server, instant: Railway → service → Deployments → previous deployment → **Redeploy**.
  Migrations are forward-only, so a rollback across a schema change needs the revert PR.
- Game or harness, instant: Vercel → that project → Deployments → previous production
  deployment → **Promote to Production**.

## Changing deploy behaviour

- Which paths trigger which side, the order, and the timeouts all live in
  `.github/workflows/deploy.yml`.
- The server's build and start commands live in `railpack.json`; the game's in the repository's
  `vercel.json`; the harness's in `packages/harness/vercel.json` (its project's Root Directory).
  All are read from the checkout at deploy time, so a change ships with the commit that makes it.
- The server's healthcheck and restart policy are Railway service settings (step 1.3).
- Which paths get a preview, the environment naming and the alias scheme live in
  `.github/workflows/preview.yml`; teardown and the sweep schedule in
  `.github/workflows/preview-cleanup.yml`.
