# 0048. The services run under tini, and shut down within a deadline

Status: Accepted. Amends the start command named in
[0012](./0012-source-exports-tsx-runtime.md): the server still runs on `tsx` in production, but is
no longer started through `pnpm --filter @openseas/server start`. Everything else in ADR 0012
stands. It applies to the game's server and to the studio's service
([0043](./0043-the-studio-service-starts-with-tester-links.md)) alike.

## Context

Both services started in Railway as `pnpm --filter <package> start`, which runs `sh -c "tsx
src/index.ts"`, which runs the tsx CLI, which forks the node process that is the service: four
processes deep. Each service's `index.ts` handles SIGTERM by closing the app and exiting 0.

Railway runs its own init as the container's first process, with the start command's shell as its
child. It stops a deployment by sending SIGTERM, which that init passes to its child, and, after
the service's draining time, SIGKILL. The draining time is 0 seconds unless it is set. On SIGTERM pnpm
passes the signal to `sh`, which dies of it; pnpm logs `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ...
Command failed with signal "SIGTERM"` and exits at once, without waiting for the service. Every
redeploy of either service logged that failure and never logged the service's own `shutting down`:
the container was gone before the service could close. Railway mailed each one as a crashed
deploy, though the dashboard showed the deployment as removed. Worse than the noise, a chat turn
or a Save running at a redeploy was killed where it stood: the turn never wrote how it ended (the
next start marks it failed), and nothing closed the database's connections.

The studio's service also starts processes of its own (the agent's, `git`), so an orphan left by
one must be reaped by a process of ours: what Railway's init does with orphans is not ours to rely on.

## Decision

1. **Each service is started by `tini` as a subreaper, running node directly.** The Railpack start
   command is `cd packages/<package> && exec tini -s -- node --import tsx src/index.ts`; `tini` is
   in the deploy image's apt packages. Railway's shell `exec`s into tini, the direct child of
   Railway's init (tini is process 2, node process 3). tini passes SIGTERM to node and exits with
   node's exit status. `-s` registers it as a child subreaper, so orphans under it are reparented
   to it and reaped, though it is not process 1; without it tini warns that it cannot reap. `node --import
   tsx` is the tsx runtime without the CLI's extra process. The packages' `start` scripts run the
   same `node --import tsx`, so `pnpm start` locally is the same process tree minus tini.
2. **A service shuts down within a deadline, and says how it went.** On SIGTERM or SIGINT it logs
   `shutting down`, closes the app, logs `shut down` and exits 0. A second signal is ignored. If
   closing throws, or has not finished after 25 seconds, it logs the error and exits 1.
3. **The studio's service stops its chat turns at shutdown rather than waiting on them.** It
   stops taking requests, stops each running turn where it stands, as the owner's Stop does (its
   edits are committed and the turn is recorded as stopped), lets a Save that is already pushing
   finish, then closes the model proxy, the remaining connections and the database. A turn can
   run for many minutes; a redeploy cannot wait for it.
4. **Each Railway service sets `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` to 30**, above the 25-second
   deadline, so Railway's SIGKILL only ever comes after the service has given up on its own.

## Consequences

- A redeploy logs `shutting down` and `shut down` and ends with exit status 0: no crash mail, no
  pnpm failure line.
- A chat turn caught by a redeploy is recorded as stopped, with its edits committed, so it can be
  reverted or carried on with a new message.
- The old deployment lives up to 30 seconds longer after the new one is up. The healthcheck
  already sends traffic only to the new one.
- The start command no longer goes through `package.json`, so a change to a `start` script does
  not change production by itself. Both are named in `docs/DEPLOY.md`.

## Alternatives considered

- **`exec node` with no tini.** Node gets the signal as the init's child, and the game's server
  starts no children, but the studio's service does, and node does not reap orphans. One start
  command shape for both services is simpler to keep right.
- **Keep pnpm and the tsx CLI, and set only the draining time.** pnpm still exits as soon as its
  child dies of the signal, taking the container with it, whatever the draining time.
- **Wait for chat turns to end.** Unbounded, and Railway kills the container anyway.
