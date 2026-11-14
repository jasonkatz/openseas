# 0043. The studio's service starts with tester links: a signed cookie, a schema of its own, and no agent yet

Status: Accepted. Builds on [0042](./0042-the-harness-becomes-the-puzzle-studio.md), whose
decision 4 names the service and whose decision 11 names the link. It supersedes nothing: it says
how the first cut of that service is built and what of decision 4 is left for the steps after.

## Context

ADR 0042 gives the studio a service, `packages/studio-server`, that will hold a clone of the
repository, a worktree a draft, the drafts and their chat, and the tester links. The shell (M9's
first step) needs only the last of those: a tuned round shared by an id that never expires. The
owner chose to build that alone first.

Until now a tuned round was shared as the draft itself in a `/play/<puzzle>` query string. That
still works and needs no service. A link by id adds three things the query string cannot: it is
short, it can be withdrawn, and it says whose draft it is.

The service is also the first thing in the project the owner signs in to that is not the game.
ADR 0042 says how: GitHub, against an allowlist of logins in the service's environment, and the
game's accounts are not involved.

## Decision

1. **`packages/studio-server` is a small HTTP service of its own.** Node's `http`, Drizzle and
   Postgres, as the game's server is built, and nothing shared with it but `protocol`. It deals
   no round and imports no engine. Its whole surface is `/health`, `/auth/*` and `/links`.
2. **A tester link is a row: an id, a puzzle, a name, who made it, and the frozen draft.** The
   draft is what the studio's address bar holds: config overrides by path, `roundSeconds`,
   `paceSeconds`, `thresholds`, and the seed if one is pinned. The id is ten characters with
   nothing that reads as something else, and is never a puzzle's id, because both follow
   `/play/`. Picks (a sprite or sound take) join the row when the asset step lands.
3. **The service checks a draft's shape, not whether it plays.** Whether a build accepts a
   draft's numbers is that build's question (ADR 0042 decision 11): the page asks it when the link
   is opened, with the same checks the studio page applies, and deals nothing on a refusal. The
   studio does not offer to freeze a draft it refuses.
4. **Anyone may read a link, from any origin, with no cookie.** That is what lets a pull
   request's preview of the studio site play one. A withdrawn link answers that it was withdrawn;
   its row is kept so its address can say so.
5. **Only the owner makes, lists or withdraws links.** The owner is a GitHub login on
   `STUDIO_OWNERS`. Sign-in is GitHub's web flow with no scope: the service asks GitHub once who
   the code belongs to and keeps no token. It does nothing in the owner's name on GitHub. (The
   pull requests of ADR 0042 decision 9 will come from a GitHub App, which is a separate
   credential and a later step.)
6. **The session is a signed cookie, with no session table.** The cookie holds the login and an
   expiry, signed with `STUDIO_SECRET`. Every request reads the allowlist again, so taking a login
   off the list ends its access at once. A request that changes anything must also carry the
   `Origin` of the studio site (`STUDIO_ORIGINS`): the cookie alone is not enough.
7. **Its tables live in a Postgres schema of their own, `studio`, journal included.** In
   production the service has its own database on the game's Postgres, as ADR 0042 says. The
   schema is what lets it also share a database, which is what a developer's machine and the CI
   run do, without its migrations and the game's meeting.
8. **The studio works without it.** The site is told where the service is at build time
   (`VITE_STUDIO_SERVICE_URL`). With none set, or with the service down, tuning, play, the replay
   check and `/play/<puzzle>` links are untouched; only links by id are missing, and the panel
   says so. `/play` pages still ask nothing of the game's server.
9. **Off production there is a sign-in with no GitHub.** `STUDIO_DEV_LOGIN` names a login that
   `/auth/dev` signs in, for local work. The service refuses to start with it set in production.

## Consequences

- There is a second Railway service to deploy, with five variables and a GitHub OAuth app
  (`docs/DEPLOY.md`, step 1b). The deploy pipeline uploads it only once a variable names it, so
  merging this changes nothing until the owner sets it up.
- The studio's home grid has no mark for an open draft yet: a draft still lives in an address
  bar, not in the service. Drafts, their worktrees, the chat and Save are the next step of M9
  and extend this service; nothing here has to be undone for them.
- A link frozen today may be refused by a later build whose bounds moved. That is decision 11 of
  ADR 0042 working as meant: the page says so and deals nothing.
- The stateless cookie cannot be revoked one session at a time. With one owner and an allowlist
  read on every request, removing the login, or changing `STUDIO_SECRET`, is the revocation.
- The front end's smoke answers for the service itself; the service's own tests run against a
  real Postgres in CI, in the `studio` schema of the test database.

## Alternatives considered

- **Better Auth, as the game's server uses.** It brings user, session and account tables and a
  guest flow the studio has no use for, to sign in one person with one provider.
- **Links in the game's server.** One service fewer, and the game's server would then hold
  something that is not the game's, reachable by a tool that is never linked from the game. ADR
  0042 already keeps the two apart.
- **Validate a draft on the service with the engines.** It would refuse a bad draft earlier, and
  pin the answer to the service's build instead of the build that plays the link, which is the
  one that matters.
- **Put the draft in the id** (a compressed query string). No service at all, and no withdrawing,
  no name, no author, and an address that grows with the draft.
