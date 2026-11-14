# 0044. The studio lives at studio.openseas.online

Status: Accepted. Supersedes the address in [0042](./0042-the-harness-becomes-the-puzzle-studio.md)
decision 1 ("stays at `test.openseas.online`") and in
[0019](./0019-boards-package-and-harness-bench.md) decision 6. Everything else in both stands.

## Context

The harness was put at `test.openseas.online` when it was a test bench (ADR 0019), and ADR 0042
kept the address when it became the studio. With the shell built, the owner moved the site to
`studio.openseas.online`, the name of what it now is, and set the studio's service
(`studio-api.openseas.online`, ADR 0043) to accept that origin.

## Decision

1. **The studio's address is `studio.openseas.online`.** Its service's `STUDIO_ORIGINS` names
   that origin, so sign-in, and making or withdrawing a tester link, work there and nowhere else.
2. **Tester links are addressed there:** `https://studio.openseas.online/play/<id>`.
3. **`test.openseas.online` is not the studio's address any more.** While it still serves the
   site it plays puzzles and opens tester links, since reading a link needs no origin, but its
   tuning panel cannot reach the service. The owner retires or redirects it when convenient.

## Consequences

- The Vercel project, the `VERCEL_HARNESS_*` variables and the workflow's job keep the name
  `harness`; `PRODUCTION_HARNESS_URL` should hold the new address so the deploy's checks look at
  the site people use.
- A link to `test.openseas.online` shared before the move keeps working only as long as that
  domain is kept or redirected.
