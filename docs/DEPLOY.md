# Deploying openseas

Merging to `main` is the release. Nothing is deployed by hand. One GitHub Actions pipeline does
every production deploy, in order (ADR 0014). Vercel's Git integration is connected only for
pull request previews; `vercel.json` turns it off for `main` (ADR 0016).

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

Every push to a branch other than `main` gets a Vercel preview on the same `openseas` project
that serves production, and Vercel comments the URL on the PR. Previews use the project's
**Preview** env, so `VITE_SERVER_URL` must be set for Preview too (step 2). Previews point at the
production server: the server only accepts the origins in `CLIENT_ORIGINS`, so calls that need
CORS or auth fail from a preview URL unless its origin is listed there. Treat previews as a look at
the UI, not a place to play rated rounds.

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

Create the project from the CLI in a local checkout:

```sh
npm i -g vercel
vercel login
vercel link --yes --scope <team-slug> --project openseas   # creates the project, writes .vercel/project.json (gitignored)
vercel env add VITE_SERVER_URL production                    # paste https://<railway domain>
vercel env add VITE_SERVER_URL preview                       # same value; previews use it
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
5. Git → **Connect Git Repository** → `jasonkatz/openseas`. This is for previews only:
   `vercel.json` sets `git.deploymentEnabled.main` to `false`, so pushes to `main` never deploy
   from Vercel's side and production still goes through the pipeline. Leave Production Branch as
   `main`.

### 3. GitHub: secrets and variables

Repo → **Settings → Secrets and variables → Actions**. Repository scope is fine; the
`production` environment scope also works and lets you add required reviewers later.

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
