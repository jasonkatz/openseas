# 0007. Better Auth with guest-first anonymous accounts

Status: Accepted

## Context

First-session friction should be zero: a visitor gets a pirate name and plays immediately. Later
they may link Discord or Google and keep everything. No email/password auth is wanted. A
hand-rolled OAuth flow was considered and rejected because the owner prefers a maintained library
and the `arctic` library suggested earlier is deprecated.

## Decision

Better Auth. Guests use its anonymous plugin. Account linking carries the pirate, ledger, ratings,
and ships across. Discord and Google are the only social providers. An invite code is required to
create a pirate while the alpha flag is on.

## Consequences

- No password storage.
- The linking hook is the single place where guest state is merged into a real account; it must be
  idempotent and tested.
- Guest identity lives in the browser; a cleared browser loses an unlinked guest. The UI nudges
  linking after the first voyage.
