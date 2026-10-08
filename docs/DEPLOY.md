# Deploying openseas

Merging to `main` is the release. Nothing is deployed by hand.

## What happens on a merge

1. GitHub Actions runs **CI** (`.github/workflows/ci.yml`): engine purity lint, typecheck, unit and
   integration tests, migration drift check, client build and Playwright smoke.
2. **Railway** builds and deploys the server from `railway.json`. The service is set to wait for CI,
   so a red merge never reaches production. Only commits that touch the server or a package it
   depends on trigger a build (`watchPatterns`). A deployment replaces the old one only after
   `/health` answers.
3. **Vercel** builds and deploys the client from `vercel.json`. Commits that don't touch the client
   or its packages are skipped (`ignoreCommand`). A failed build leaves the previous deployment live.
4. **Deploy verify** (`.github/workflows/deploy-verify.yml`) runs once CI is green. It polls the
   server's `/health` and the client's `/version.json` until both report the merged commit, then
   goes green. If either target never serves the commit within twenty minutes it goes red, which
   is the signal to look at the Railway or Vercel build logs.

Pull requests get a Vercel preview of the client (unrated play works offline; rated play needs the
production server, whose CORS list does not include preview URLs). The server has no previews
(ADR 0008).

## One-time setup

Do these in order: the server's domain is needed before the client can be configured, and the
client's domain is needed to finish the server.

### 1. Railway: server and Postgres

1. railway.com → New Project → **Deploy from GitHub repo** → `jasonkatz/puzzle-rebuild`. Install
   the Railway GitHub app on the repo if asked. Railway picks up `railway.json` from the repo root.
2. In the project, **+ New → Database → PostgreSQL**.
3. Open the server service → **Settings**:
   - Source: branch `main`, and turn on **Wait for CI** so deploys start only after GitHub checks pass.
   - Networking → **Generate Domain**. Note it; it is the `SERVER_URL` below.
4. Server service → **Variables** (raw editor is quickest):

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference to the Postgres service) |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 48` |
   | `BETTER_AUTH_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
   | `CLIENT_ORIGINS` | the Vercel production URL, filled in at step 2.4 |
   | `CROSS_SITE_COOKIES` | `true` |
   | `ALPHA_INVITE_CODE` | an invite code, or leave unset to let anyone in |
   | `LOG_LEVEL` | `info` |

   Railway supplies `PORT` and `RAILWAY_GIT_COMMIT_SHA` itself; the server reads both.
   Migrations run on boot, so no migrate step is needed.

### 2. Vercel: client

1. vercel.com → Add New → **Project** → import `jasonkatz/puzzle-rebuild`. Keep the root directory
   at the repository root; `vercel.json` carries the install, build and output settings.
2. Settings → General → Node.js version **22.x** (the `engines` field also asks for it).
3. Settings → Environment Variables → `VITE_SERVER_URL` = `https://<railway domain>` for
   **Production**. Leave it unset for Preview so previews stay offline-only.
4. Note the production URL (`openseas.vercel.app` or similar). Back in Railway, set
   `CLIENT_ORIGINS` to it (comma-separate several origins) and let the server redeploy.
5. Settings → Deployment Protection: production must open without a Vercel login. The default
   (Standard Protection) protects previews and deployment URLs only, which is what we want.

### 3. GitHub: variables and branch rules

1. Repo → Settings → Secrets and variables → Actions → **Variables**:
   - `PRODUCTION_SERVER_URL` = `https://<railway domain>`
   - `PRODUCTION_CLIENT_URL` = `https://<vercel production domain>`
   Without these, Deploy verify prints a notice and passes.
2. Settings → Branches → protect `main`: require the CI checks before merging. This is what makes
   "merged" mean "green".

### 4. Check it

Merge a PR, then watch the **Deploy verify** run on `main`. When it is green:

```sh
curl https://<railway domain>/health          # {"ok":true,"contentVersion":...,"commit":"<sha>"}
curl https://<vercel domain>/version.json     # {"commit":"<sha>"}
```

Open the client, start a rated Bilging round, and confirm a result lands.

## Rolling back

- Server: Railway → service → Deployments → pick the previous one → **Redeploy**. Migrations are
  forward-only, so a rollback across a schema change needs a revert PR instead.
- Client: Vercel → project → Deployments → previous production deployment → **Promote to
  Production** (instant).
- Either way, a `git revert` PR is the durable fix and goes out through the normal path.

## Changing deploy behaviour

- Paths that trigger a server build: `railway.json` → `build.watchPatterns`.
- Paths that trigger a client build: `vercel.json` → `ignoreCommand`.
- Both lists are mirrored in `deploy-verify.yml`; change all three together.
