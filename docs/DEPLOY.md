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
4. **Client to Vercel.** The runner pulls the project's production settings and env, builds with
   `vercel build` (so the build runs in CI, not on Vercel), deploys the prebuilt output with
   `vercel deploy --prebuilt --prod`, and polls `/version.json` until it reports the commit.
5. Deploys queue behind each other and never cancel one in flight. Both jobs show up under the
   repo's **production** environment, so GitHub's Deployments view is the deploy history.

Manual runs: Actions → Deploy → **Run workflow**. Tick "server" or "client" to redeploy a side
even if nothing under it changed, for example after changing a Railway variable.

## Previews

Every pull request that touches the client or what it depends on gets a preview: the **Preview**
workflow (`.github/workflows/preview.yml`) builds the client in CI with `vercel build` against
the project's **Preview** env, deploys it with `vercel deploy --prebuilt` (no `--prod`) to the
same `openseas` project, and keeps one comment on the PR updated with the URL. Vercel's Git
integration is not connected (ADR 0016).

- It uses the same `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as the Deploy pipeline,
  but runs without the `production` environment, so they must be **repository**-scoped (step 3).
  Pull requests from forks get no secrets; their preview job skips with a warning.
- `VITE_SERVER_URL` must be set for Preview as well as Production (step 2).
- Previews point at the production server, which only accepts the origins in `CLIENT_ORIGINS`.
  Anything that needs the server fails from a preview URL. Use previews to look at UI.
- Deployment Protection's Standard Protection keeps previews behind a Vercel login.
- A pull request only gets a preview from a push made after its branch carries this workflow, and
  only a push starts it (retargeting or editing the PR does not). For a PR that missed it, run
  **Preview** by hand from the Actions tab with the PR number; it looks the head up and deploys it.
- The preview deploys from a copy of `.vercel` outside the git checkout, tagged with plain meta
  keys (`commitSha`, `commitRef`, `prNumber`). Inside a checkout the Vercel CLI reads the last
  commit and attaches it as `githubCommit*` metadata, which makes Vercel credit the deployment to
  the commit's author; on a Hobby team a commit authored outside the team (Claude's commits are)
  is **BLOCKED**. Outside a repo the deployment is credited to the owner of `VERCEL_TOKEN`. The
  deploy step times out after five minutes so a blocked deployment fails fast. Production deploys
  run inside the checkout: they ship merge commits, which the owner authors.

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
   | `CLIENT_ORIGINS` | the Vercel production URL, filled in at step 2.5 |
   | `CROSS_SITE_COOKIES` | `true` |
   | `ALPHA_INVITE_CODE` | an invite code, or leave unset to let anyone in |
   | `LOG_LEVEL` | `info` |

   Railway supplies `PORT` itself. The pipeline sets `GIT_COMMIT_SHA` on every deploy.
   `CLIENT_ORIGINS` must be the browser's exact origin: scheme and host, no path, no trailing
   slash. Railway stages variable edits; click **Deploy** on the staged change or the running
   server keeps the old value. The server logs the origins it loaded on boot
   (`openseas server listening`), and the Deploy pipeline fails with a pointer here if the
   server rejects a preflight from the client origin.
5. Project → **Settings → Tokens** → create a **project token** for the `production` environment.
   Copy it; it is `RAILWAY_TOKEN` in step 3.

### 2. Vercel: client

The Vercel project is not connected to GitHub. Create it from the CLI in a local checkout:

```sh
npm i -g vercel
vercel login
vercel link --yes --scope <team-slug> --project openseas   # creates the project, writes .vercel/project.json (gitignored)
vercel env add VITE_SERVER_URL production                    # paste https://<railway domain>
vercel env add VITE_SERVER_URL preview                       # same value; PR previews use it
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

### 3. GitHub: secrets and variables

Repo → **Settings → Secrets and variables → Actions**. Use repository scope for the Vercel
entries: the Preview workflow runs on pull requests outside the `production` environment and
cannot read environment-scoped values. The Railway entries can live on `production` if you want
required reviewers there later.

| Kind | Name | Value |
|---|---|---|
| Secret | `RAILWAY_TOKEN` | the Railway project token |
| Secret | `VERCEL_TOKEN` | the Vercel token |
| Variable | `RAILWAY_SERVICE` | `server` (the Railway service name) |
| Variable | `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` |
| Variable | `VERCEL_PROJECT_ID` | `projectId` from `.vercel/project.json` |
| Variable | `PRODUCTION_SERVER_URL` | `https://<railway domain>` |
| Variable | `PRODUCTION_CLIENT_URL` | `https://<vercel production domain>` |

The two URL variables are what let the pipeline wait for the server before deploying the client
and confirm each side serves the merged commit. Without them it deploys blind and warns.

Finally, **Settings → Branches** → protect `main` and require the CI checks before merging.

### 4. Check it

Actions → Deploy → Run workflow with both boxes ticked. When it is green:

```sh
curl https://<railway domain>/health          # {"ok":true,"contentVersion":...,"commit":"<sha>"}
curl https://<vercel domain>/version.json     # {"commit":"<sha>"}
```

Open the client, start a rated Bilging round, and confirm a result lands.

## Rolling back

- A `git revert` PR is the normal path; it goes out through the pipeline like any merge.
- Server, instant: Railway → service → Deployments → previous deployment → **Redeploy**.
  Migrations are forward-only, so a rollback across a schema change needs the revert PR.
- Client, instant: Vercel → project → Deployments → previous production deployment →
  **Promote to Production**.

## Changing deploy behaviour

- Which paths trigger which side, the order, and the timeouts all live in
  `.github/workflows/deploy.yml`.
- The server's build and start commands live in `railpack.json`; the client's in `vercel.json`.
  Both are read from the checkout at deploy time, so a change ships with the commit that makes it.
- The server's healthcheck and restart policy are Railway service settings (step 1.3).
