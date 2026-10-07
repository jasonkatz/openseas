# 0002. TypeScript end to end in a pnpm monorepo

Status: Accepted

## Context

The replay-verification model (ADR 0003) requires the exact same puzzle engine to run on client
and server. Message schemas must be shared too. The owner reviews rather than writes most code and
is fluent in TypeScript.

## Decision

One repository, pnpm workspaces, TypeScript everywhere. Packages: `engine`, `protocol`,
`content`, `server`, `client`. Node 22 LTS.

## Consequences

- One language, one toolchain, one CI pipeline.
- Package boundaries are enforced by dependency direction: `engine` and `protocol` depend on
  nothing internal; `server` and `client` depend on them; nothing depends on `server` or `client`.
- A non-TypeScript server (Go, Rust) is ruled out unless this ADR is superseded.
