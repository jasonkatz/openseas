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
4. **Game and studio to Vercel**, in parallel, each to its own project (ADR 0019); the guides
   too, without waiting for the server. All three run `.github/scripts/vercel-deploy.sh`: pull the
   project's production settings and env, build with `vercel build` (so the build runs in CI, not
   on Vercel), deploy the prebuilt output with `vercel deploy --prebuilt --prod`, and poll
   `/version.json` until it reports the commit (following the apex domain's redirect to `www`).
   The studio and the guides then check that a deep link such as `/cooling` answers 200 (the SPA
   rewrite from their `vercel.json` is in effect), and the studio that the server allows its origin.
5. **The studio's service to Railway** (step 1b), on its own, when its package changed.
6. Deploys queue behind each other and never cancel one in flight. All jobs show up under the
   repo's **production** environment, so GitHub's Deployments view is the deploy history.

Manual runs: Actions → Deploy → **Run workflow**. Tick a side ("server", "client", "studio",
"studio_server", "docs") to redeploy it even if nothing under it changed, for example after
changing a Railway or Vercel variable.

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
2. **Game and studio on Vercel.** Each front end is built in CI with `vercel build` against its
   project's **Preview** env, with `VITE_SERVER_URL` replaced by the PR server, deployed with
   `vercel deploy --prebuilt` (no `--prod`) to its production project (ADR 0016), and aliased to a
   stable host: `<PREVIEW_ALIAS_PREFIX>-<number>.vercel.app` for the game (default
   `openseas-pr-<number>`) and `<PREVIEW_STUDIO_ALIAS_PREFIX>-<number>.vercel.app` for the
   studio (default `openseas-studio-pr-<number>`). The aliases are stable across pushes, which is
   what lets the server list both origins in `CLIENT_ORIGINS` before anything deploys. All three
   front ends run `.github/scripts/vercel-preview.sh`; one whose Vercel settings are missing skips
   with a warning and the others still preview.
3. **Guides on Vercel.** The puzzle guides (ADR 0038) are built and deployed the same way to
   their own project and aliased to `<PREVIEW_DOCS_ALIAS_PREFIX>-<number>.vercel.app` (default
   `openseas-docs-pr-<number>`). They talk to no server, so this job does not wait for Railway.
4. One comment on the PR carries the URLs and is updated on every push.

**Preview cleanup** (`.github/workflows/preview-cleanup.yml`) deletes the Railway environment,
its database and the aliases when the PR closes, and sweeps daily for `pr-*` environments whose PR
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
- Deployment Protection's Standard Protection keeps all three previews behind a Vercel login.
  The server's `/health` and API are public, as production's are.
- The preview database is empty: you arrive as a new guest. A preview environment copies
  production's `ALPHA_INVITE_CODE`, so the first visit asks for the invite code; both the game's
  and the studio's home pages take it, and the pirate it creates is shared by both front ends on
  that preview. Social sign-in does not work from a preview (the OAuth apps' redirect URIs are
  production's), so the workflow sets `DISABLE_SOCIAL_SIGN_IN=true` there and the game says
  linking is not set up instead of offering buttons that cannot work; guest accounts do work.
- A new production variable or setting is picked up by the next *new* preview environment, since
  it is a duplicate. An existing `pr-*` environment keeps what it copied; close and reopen the PR,
  or run **Preview cleanup** for it and push again, to recreate it.
- A pull request only gets a preview from a push made after its branch carries this workflow, and
  only a push starts it (retargeting or editing the PR does not). For a PR that missed it, run
  **Preview** by hand from the Actions tab with the PR number; it looks the head up and deploys it.
- Previews deploy from a copy of `.vercel` outside the git checkout, tagged with plain meta
  keys (`commitSha`, `commitRef`, `prNumber`). Inside a checkout the Vercel CLI reads the last
  commit and attaches it as `githubCommit*` metadata, which makes Vercel credit the deployment to
  the commit's author; on a Hobby team a commit authored outside the team (Claude's commits are)
  is **BLOCKED**. Outside a repo the deployment is credited to the owner of `VERCEL_TOKEN`. The
  deploy step times out after five minutes so a blocked deployment fails fast. Production deploys
  run inside the checkout: they ship merge commits, which the owner authors.
- If the alias step fails because the `vercel.app` name is taken, set the repository variable
  `PREVIEW_ALIAS_PREFIX` (or `PREVIEW_STUDIO_ALIAS_PREFIX`, `PREVIEW_DOCS_ALIAS_PREFIX`) to
  something unique and re-run.

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
   | `CLIENT_ORIGINS` | the game's and the studio's production URLs, comma-separated, filled in at steps 2.3 and 2b.6 |
   | `CROSS_SITE_COOKIES` | `true` |
   | `ALPHA_INVITE_CODE` | an invite code, or leave unset to let anyone in |
   | `LOG_LEVEL` | `info` |
   | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30`: how long a replaced deployment has after SIGTERM before Railway kills it; above the service's own 25-second shutdown deadline (ADR 0048) |

   | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | optional: the Discord OAuth app, see "Social sign-in" below |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional: the Google OAuth client, see "Social sign-in" below |

   Railway supplies `PORT` itself. The pipeline sets `GIT_COMMIT_SHA` on every deploy.
   `CLIENT_ORIGINS` must be the browsers' exact origins: scheme and host, no path, no trailing
   slash, comma-separated, e.g. `https://www.openseas.online,https://studio.openseas.online`. Better
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

### 1b. Railway: the studio's service

`packages/studio-server` (ADR 0043) holds the studio's tester links, signs the owner in and
keeps the owner's drafts (ADR 0045). It is optional: until `RAILWAY_STUDIO_SERVICE` is set in
step 3 the pipeline does not deploy it, and the studio works without it, only without links by
id and with each draft in its page's address. A new table arrives with a deploy: the service
migrates its own `studio` schema as it starts.

1. **A database of its own.** On the Postgres service → **Data** (or any `psql` session):
   `CREATE DATABASE openseas_studio;`
2. **A GitHub OAuth app** for sign-in. github.com → **Settings → Developer settings → OAuth Apps
   → New OAuth App**: Homepage URL `https://studio.openseas.online`, Authorization callback URL
   `https://<studio service domain>/auth/callback` (the domain from the next step). Note the
   client id and generate a client secret. The app asks for no scope.
3. In the same Railway project: **+ New → Empty Service**, named `studio`. **Settings**:
   Networking → **Generate Domain**, or better a custom domain under `openseas.online` such as
   `studio-api.openseas.online` (a CNAME at the registrar, as for `studio`): the studio site and
   the service are then one site, and the session cookie is not a third-party cookie. Deploy →
   **Healthcheck Path** `/health`, **Restart Policy** On Failure.
4. Service → **Variables**:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `RAILPACK_CONFIG_FILE` | `railpack.studio.json` (so the build and start commands are this package's, not the game server's) |
   | `DATABASE_URL` | the Postgres service's URL with the database name replaced by `openseas_studio` |
   | `STUDIO_SECRET` | output of `openssl rand -base64 48` |
   | `STUDIO_PUBLIC_URL` | `https://<studio service domain>`, exactly as in the OAuth app's callback |
   | `STUDIO_ORIGINS` | `https://studio.openseas.online` |
   | `STUDIO_OWNERS` | the GitHub logins that may sign in, comma-separated |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | from the OAuth app |
   | `CROSS_SITE_COOKIES` | `true` only if the service is not under `openseas.online` |
   | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30`, as for the server (ADR 0048) |

   Never set `STUDIO_DEV_LOGIN` here: the service refuses to start with it in production.
4b. **Save** (ADR 0046) is optional and needs four more things. Until all are in place the
   service keeps drafts and links, logs that Save is off, and the studio offers no Save button.

   1. **A GitHub App** that pushes the branches and opens the pull requests. github.com →
      **Settings → Developer settings → GitHub Apps → New GitHub App**:
      - Name: anything, such as `openseas studio`. Homepage URL `https://studio.openseas.online`.
      - **Webhook**: untick **Active**. The service asks GitHub; GitHub is never told to call it.
      - **Repository permissions**: **Contents: Read and write**, **Pull requests: Read and
        write**. Nothing else (Metadata: Read-only is added for you). No organization or account
        permissions.
      - **Where can this GitHub App be installed?** Only on this account.
      - Create it, note the **App ID**, and under **Private keys** generate one; a `.pem` file
        downloads. That file is the credential: keep it nowhere but the Railway variable below.
      - **Install App** → your account → **Only select repositories** → this repository alone.
   2. **A volume** on the `studio` service: service → **Settings → Volumes → Add Volume**, mount
      path `/data`, 1 GB. It holds the clone (about 60 MB) and a worktree a saved draft. The
      chat's part will ask for more.
   3. **Variables** on the `studio` service:

      | Variable | Value |
      |---|---|
      | `STUDIO_REPO_DIR` | `/data` |
      | `STUDIO_REPO` | `<owner>/<repository>`, the one the App is installed on |
      | `GITHUB_APP_ID` | the App ID |
      | `GITHUB_APP_PRIVATE_KEY` | the `.pem` file's contents. If the dashboard will not take the line breaks, the output of `base64 -w0 < key.pem` works as well |
      | `STUDIO_GIT_NAME`, `STUDIO_GIT_EMAIL` | optional: who Save's commits are by. To have GitHub show the App's avatar on them, use `<app-slug>[bot]` and `<bot user id>+<app-slug>[bot]@users.noreply.github.com` (the id is in `https://api.github.com/users/<app-slug>[bot]`) |
      | `STUDIO_BASE_BRANCH` | optional, `main` by default |

   4. Nothing to do for `git`: `railpack.studio.json` adds it to the service's image. If the log
      says there is no git on the machine, the image was built from another config; check
      `RAILPACK_CONFIG_FILE`.

   The service clones as it starts (a minute, the first time) and logs `save: true`. The App's key
   and the tokens made from it stay in the service process: nothing is written to the volume that
   can push. To try it, tune a number on a puzzle's studio page, press **Save**, and look for the
   draft pull request. Discarding the draft closes it and deletes its branch. The studio never
   marks a pull request ready: it holds the numbers and the chat agent's edits, and a developer
   finishes it (ADR 0049).
4c. **The chat** (ADR 0047) is optional and needs Save (4b) first. Until it is set up the service
   logs that the chat is off and the studio shows none.

   1. **Variables** on the `studio` service:

      | Variable | Value |
      |---|---|
      | `ANTHROPIC_API_KEY` | a key for the chat's turns. It stays in the service process: the agent reaches a model only through the service |
      | `STUDIO_SPEND_CAP_USD` | all the chat may spend, every draft together, in US dollars, such as `20`. A turn that reaches it is stopped where it stands, and no turn starts past it. To carry on, raise it; the meter is never reset |
      | `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` | optional: the keys the sprite and sound scripts' APIs are paid with (ADR 0040). They stay in the service process: the scripts reach the APIs through the service, which meters each picture and sound (ADR 0059) |
      | `ELEVENLABS_USD_PER_CREDIT` | optional: what one ElevenLabs credit costs on your plan, the plan's monthly price over its credits, such as `0.00022` for 100,000 credits at $22. Unset, a credit is counted at the overage rate, `0.0003` |
      | `STUDIO_AGENT_USER` | optional: the unix user the agent runs as, `studio-agent` by default |

   2. **Grow the volume to 5 GB.** The agent installs a worktree's dependencies when it runs a
      puzzle's tests, and its session transcripts live in its home on the volume.
   3. **Give the service room.** A turn runs the Claude Code executable and whatever it starts:
      an install, a test run, a capture. 4 GB of memory and 2 vCPU is a floor for those; the
      default limits of a small plan are not enough for a test run.
   4. Nothing to do for the agent's user: the service makes it as it starts, which takes root
      (Railway's default) and `useradd` (in the image). If the log says the chat is off because
      the service cannot run the agent as a user of its own, the service is not starting as
      root, or the volume is mounted somewhere that user cannot walk into.
4d. **Takes** (ADR 0051) are optional and need the chat (4c) first: the agent makes them, and
   the service keeps them in a bucket. Until it is set up the service logs that takes are not
   kept, the agent's takes stay in the draft's worktree, and the sprite and sound panels list
   none.

   1. **A bucket.** In the same Railway project: **+ New → Bucket**, named such as
      `studio-takes`, in the service's region. Railway's buckets are private; the service reads
      and writes it, and serves a take to a browser itself.
   2. **Variables** on the `studio` service, as references to the bucket's own (its
      **Credentials** tab lists them):

      | Variable | Value |
      |---|---|
      | `STUDIO_BUCKET_ENDPOINT` | the bucket's endpoint, such as `https://t3.storageapi.dev` |
      | `STUDIO_BUCKET_NAME` | the bucket's name as its credentials give it (not the name typed above) |
      | `STUDIO_BUCKET_ACCESS_KEY_ID`, `STUDIO_BUCKET_SECRET_ACCESS_KEY` | its two keys. They stay in the service process: nothing of the bucket is in the agent's shell |
      | `STUDIO_BUCKET_REGION` | optional, `auto` by default |

   3. Nothing to do for the scripts: `railpack.studio.json` adds `python3`, `python3-pil` and
      `ffmpeg` to the image. The two script keys of 4c must be set for takes to be made at all.

   The service logs `takes: true`. To try it, ask the chat for new takes of a frame, wait for the
   turn to end, and look at that frame's row in the Sprites panel. Tap one to pick it, then Save:
   the pull request holds it as the frame's own file, which the build packs into the atlas
   (ADR 0053, ADR 0054). Nothing to set up for that; a Save that cannot read a picked take from the bucket
   fails as "couldn't read the picked takes or place them", and the log says why. Each picture and sound is counted
   against `STUDIO_SPEND_CAP_USD` from what its response says was billed: OpenAI's image tokens at
   its published rates, ElevenLabs's credits at `ELEVENLABS_USD_PER_CREDIT` (ADR 0059).

   The image grows by the Claude Code executable the SDK ships, a few hundred megabytes. The log
   says `chat: true` when all of it is in place.

   **What bounds the agent, and what does not.** It runs as its own user with an environment
   built from nothing: it cannot read this service's variables or memory, and nothing that can
   push to GitHub is in its reach. It may write the open puzzle's own files; anything else is
   refused until allowed in the chat, and a command's writes elsewhere are put back when the turn
   ends. It is not kept off the network, it holds the two script keys above if they are set, and
   a command it starts can do what an unprivileged user on that machine can do.
5. On the **studio's Vercel project** (step 2b): `VITE_STUDIO_SERVICE_URL` =
   `https://<studio service domain>` for **Production** and **Preview**, then redeploy the site
   (Deploy workflow → Run workflow → studio). A preview of the studio reads tester links from
   the one production service; it cannot sign in, since its origin is not in `STUDIO_ORIGINS`.
6. In step 3 below, set `RAILWAY_STUDIO_SERVICE` to `studio` and `PRODUCTION_STUDIO_SERVICE_URL`
   to its URL. The next merge that touches the service, or a manual run of the Deploy workflow
   with "studio_server" ticked, uploads it.

Pull request previews duplicate the production environment (ADR 0017), so each gets a copy of
this service with nothing uploaded to it. It never runs: there is one studio service, in
production (ADR 0042 decision 4). If a preview environment's copy of the service is given a volume by that
duplication, it stays empty.

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

### 2b. Vercel: the studio

The studio (ADR 0042) is a second Vercel project on the same team, rooted in `packages/studio` so
it reads `packages/studio/vercel.json` (build command, output directory, SPA rewrite) instead of
the repository's `vercel.json`, which is the game's. Like the game's project it is not connected to
GitHub; the pipeline deploys it.

1. Create the project. Either dashboard → **Add New → Project → no repository**, name
   `openseas-studio`, or from a local checkout:

   ```sh
   vercel project add openseas-studio --scope <team-slug>
   ```

2. Project → **Settings → General**: Root Directory **`packages/studio`**, Framework Preset
   **Vite**, Node.js version **22.x**. Leave the build and output settings as detected; the
   `vercel.json` in that directory sets them.
3. **Settings → Environment Variables**: `VITE_SERVER_URL` = `https://<railway domain>` for
   **Production** and **Preview**, the same value as on the game's project (a PR preview replaces
   it with its own server).
4. **Settings → Domains**: add `studio.openseas.online`. `openseas.online` is already verified on
   the team, so no ownership challenge follows, but its DNS is hosted at the registrar (Hover),
   not Vercel: add a record there for `studio`, either a **CNAME** to the target Vercel shows next
   to the domain (normally `cname.vercel-dns.com`) or an **A** record to Vercel's IP as the apex
   has. The domain turns valid once the record propagates; Vercel's domain page says when it does.
5. **Settings → Deployment Protection**: Standard Protection, as for the game, so previews and
   deployment URLs need a Vercel login and `studio.openseas.online` opens without one. Testers are
   not team members.
6. Note the project id (**Settings → General**, or `vercel project inspect openseas-studio`);
   it is `VERCEL_STUDIO_PROJECT_ID` in step 3. Back in Railway, add `https://studio.openseas.online`
   to `CLIENT_ORIGINS` on the server service (comma after the game's origin) and deploy the staged
   change; until then the studio deploys but cannot sign in, and the Deploy workflow's studio
   job fails on its origin check with a pointer here.

### 2c. Vercel: puzzle guides

The guides (ADR 0038) are a third Vercel project on the same team, rooted in `packages/docs`. The
site is static: it has no environment variables, talks to no server, and needs no entry in
`CLIENT_ORIGINS`.

1. Create the project: dashboard → **Add New → Project → no repository**, name `openseas-docs`,
   or `vercel project add openseas-docs --scope <team-slug>`.
2. Project → **Settings → General**: Root Directory **`packages/docs`**, Framework Preset
   **Vite**, Node.js version **22.x**. `packages/docs/vercel.json` sets the build command, the
   output directory and the SPA rewrite.
3. **Settings → Domains**: add `docs.openseas.online`, with a record at the registrar as for the studio (step 2b.4).
4. **Settings → Deployment Protection**: Standard Protection, so the production domain opens
   without a Vercel login.
5. Note the project id; it is `VERCEL_DOCS_PROJECT_ID` in step 3. Set `PRODUCTION_DOCS_URL` to
   the domain from step 3 so the pipeline can check the deploy.

Pull requests get a preview of the guides at `openseas-docs-pr-<number>.vercel.app` (see
"Previews"), behind a Vercel login like the others.

### 3. GitHub: secrets and variables

Repo → **Settings → Secrets and variables → Actions**. Use repository scope for the Vercel and
preview entries: the Preview workflows run on pull requests outside the `production` environment
and cannot read environment-scoped values. `RAILWAY_TOKEN` can live on `production` if you want
required reviewers there later.

| Kind | Name | Value |
|---|---|---|
| Secret | `RAILWAY_TOKEN` | the Railway project token (production deploys) |
| Secret | `RAILWAY_API_TOKEN` | the Railway workspace token (previews) |
| Secret | `VERCEL_TOKEN` | the Vercel token (step 2.4). Team-scoped, it covers all three projects |
| Secret | `VERCEL_STUDIO_TOKEN` | optional; only when `VERCEL_TOKEN` is scoped to the game's project alone: a token scoped to the studio's. A project-scoped token reports every other project as `Project not found` |
| Secret | `VERCEL_DOCS_TOKEN` | optional; the same for the guides' project |
| Variable | `RAILWAY_SERVICE` | `server` (the Railway service name; previews assume `server` if unset) |
| Variable | `RAILWAY_PROJECT_ID` | the Railway project ID (previews) |
| Variable | `RAILWAY_DATABASE_SERVICE` | optional; the Postgres service name if not `Postgres` |
| Variable | `PREVIEW_ALIAS_PREFIX` | optional; game previews live at `<prefix>-<pr>.vercel.app`, default `openseas-pr` |
| Variable | `PREVIEW_STUDIO_ALIAS_PREFIX` | optional; studio previews live at `<prefix>-<pr>.vercel.app`, default `openseas-studio-pr` |
| Variable | `PREVIEW_DOCS_ALIAS_PREFIX` | optional; guides previews live at `<prefix>-<pr>.vercel.app`, default `openseas-docs-pr` |
| Variable | `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` |
| Variable | `VERCEL_PROJECT_ID` | `projectId` from `.vercel/project.json` (the game) |
| Variable | `VERCEL_STUDIO_PROJECT_ID` | the studio project's id (step 2b.6) |
| Variable | `RAILWAY_STUDIO_SERVICE` | optional; `studio`, the studio service's name in Railway (step 1b). Unset means it is not deployed |
| Variable | `PRODUCTION_STUDIO_SERVICE_URL` | optional; the studio service's URL, so the pipeline can wait for it |
| Variable | `PRODUCTION_SERVER_URL` | `https://<railway domain>` |
| Variable | `PRODUCTION_CLIENT_URL` | `https://<vercel production domain>` of the game |
| Variable | `PRODUCTION_STUDIO_URL` | `https://studio.openseas.online` |
| Variable | `VERCEL_DOCS_PROJECT_ID` | the guides project's id (step 2c.5) |
| Variable | `PRODUCTION_DOCS_URL` | `https://docs.openseas.online` |

The URL variables are what let the pipeline wait for the server before deploying the front ends
and confirm each side serves the merged commit. Without them it deploys blind and warns.

Finally, **Settings → Branches** → protect `main` and require the CI checks before merging. The
checks are `Typecheck, unit, integration` and `Build and Playwright smoke` for `client`, `studio`
and `docs`.

### 4. Check it

Actions → Deploy → Run workflow with every box ticked. When it is green:

```sh
curl https://<railway domain>/health          # {"ok":true,"contentVersion":...,"commit":"<sha>"}
curl https://<vercel domain>/version.json     # {"commit":"<sha>"}
curl https://studio.openseas.online/version.json
curl -o /dev/null -w '%{http_code}\n' https://studio.openseas.online/cooling   # 200: deep links work
```

Open the studio at `/play/cooling`, play a round, and confirm a result lands. Open the game and
confirm a pirate is signed in.

## Rolling back

- A `git revert` PR is the normal path; it goes out through the pipeline like any merge.
- Server, instant: Railway → service → Deployments → previous deployment → **Redeploy**.
  Migrations are forward-only, so a rollback across a schema change needs the revert PR.
- Game, studio or guides, instant: Vercel → that project → Deployments → previous production
  deployment → **Promote to Production**.

## Changing deploy behaviour

- Which paths trigger which side, the order, and the timeouts all live in
  `.github/workflows/deploy.yml`. How a front end is built, deployed and checked lives in
  `.github/scripts/vercel-deploy.sh` (production) and `vercel-preview.sh` (previews), shared by
  all three.
- The server's build and start commands live in `railpack.json`, the studio service's in
  `railpack.studio.json`. Both start node under `tini`, not through pnpm, so the service itself gets
  Railway's SIGTERM and can close before the container stops (ADR 0048). The game's are in the repository's
  `vercel.json`; the studio's and the guides' in `packages/studio/vercel.json` and
  `packages/docs/vercel.json` (each project's Root Directory).
  All are read from the checkout at deploy time, so a change ships with the commit that makes it.
- The server's healthcheck and restart policy are Railway service settings (step 1.3).
- Which paths get a preview, the environment naming and the alias scheme live in
  `.github/workflows/preview.yml`; teardown and the sweep schedule in
  `.github/workflows/preview-cleanup.yml`.

## Social sign-in (Discord and Google)

Guests upgrade in place to a Discord or Google account (DESIGN.md 3.8, ADR 0007). A provider is
offered only when both its variables are set on the server; with neither, the game's menu says
linking is not set up and everyone plays as a guest. The server reports what it offers in
`/api/me` (`providers`).

1. **Discord**: <https://discord.com/developers/applications> → New Application → **OAuth2**.
   Add the redirect `https://<server host>/api/auth/callback/discord` (the server's public URL,
   the same as `BETTER_AUTH_URL`). Copy the client ID and secret into `DISCORD_CLIENT_ID` and
   `DISCORD_CLIENT_SECRET`.
2. **Google**: Google Cloud console → **APIs & Services → Credentials** → Create OAuth client ID,
   type Web application. Authorized redirect URI `https://<server host>/api/auth/callback/google`;
   authorized JavaScript origin the game's URL. Copy the ID and secret into `GOOGLE_CLIENT_ID`
   and `GOOGLE_CLIENT_SECRET`. The consent screen needs only the default scopes (email, profile).
3. Deploy the staged variables. Sign in as a guest on the game, open the menu, and link: you come
   back to the same place with a "Linked to …" toast and the menu shows the account.

What linking does: a guest who signs in with a provider for the first time keeps their pirate,
ledger, ratings, ships and crew on the new account, and the guest's auth user is retired. If the
provider account already has a pirate (a returning player on a new device), that pirate wins and
the guest's stays behind on its own guest user; nothing is deleted. A browser that has held a
linked account offers sign-in rather than a fresh guest after signing out.
