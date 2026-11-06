# 0025. Linking a guest: a returning account keeps its own pirate, and we retire the guest

Status: Accepted. Builds on [0007](./0007-better-auth-guest-first.md).

## Context

ADR 0007 decided guest-first accounts with an in-place upgrade to Discord or Google, the linking
hook being the one place a guest's state moves onto an account. Building the upgrade (M6) raised
cases ADR 0007 left open:

- A returning player on a new device lands as a fresh guest (guest-first), then signs in with the
  account that already has their pirate. Both pirates exist; an account has one pirate.
- Better Auth's anonymous plugin deletes the guest's auth user after a link. A pirate still on
  that user (the case above) blocks the delete, because a pirate is never deleted with its user
  (ADR 0007, `onDelete: restrict`); the plugin logs and carries on, leaving a half-finished state.
- A linked pirate who signs out would be made a new guest on the next load, a stranger in their
  own browser.

## Decision

1. **The account's own pirate wins.** `mergeGuestIntoAccount` moves the guest's pirate onto the
   account only when the account has none, and reports what it did: `moved`, `kept` or `none`.
   With `kept`, the guest's pirate stays on its guest user; nothing is deleted or merged.
2. **We retire the guest ourselves.** The plugin's delete is switched off
   (`disableDeleteAnonymousUser`); after the merge, `retireGuest` deletes the guest's auth user
   only if no pirate is left on it, and only if it is anonymous. Sessions and accounts cascade.
3. **The client tells the player which happened** by comparing the pirate it had before leaving
   for the provider with the one it has on return: "Linked to Discord" or "Welcome back".
4. **A browser that has held a linked account offers sign-in after sign-out** rather than a fresh
   guest. The flag lives in local storage; the harness, which is not given the option, behaves as
   before.
5. **A linked pirate may add the other provider** (`accountLinking`, different emails allowed).
6. **Previews offer no social sign-in** (`DISABLE_SOCIAL_SIGN_IN`), since the OAuth apps redirect
   only to production.

## Consequences

- A guest left behind by `kept` holds its name and its starter sloop until a later clean-up
  decides what to do with untouched guests; none is built.
- The linking hook stays the single place guest state moves, and is idempotent: a second call
  finds nothing to move.
- `/api/me` reports the providers the server offers and those the account has linked, so the
  menu never shows a button that cannot work.
