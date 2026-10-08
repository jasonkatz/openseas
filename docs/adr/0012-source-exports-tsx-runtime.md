# 0012. Workspace packages export TypeScript source; the server runs on tsx

Status: Accepted

## Context

`engine`, `protocol`, and `content` are consumed by both `server` and `client` (ADR 0002). The
usual choice is a build step per package producing `dist/` with declarations, which every consumer
and every test runner then has to be pointed at, and which goes stale between edits. Vite already
bundles TypeScript source for the client, and Vitest transforms it for tests.

## Decision

Each internal package's `exports` points at `src/index.ts`. The client bundles it with Vite. The
server runs with `tsx` in development and production (`pnpm --filter @openseas/server start`), so
there is no build artifact anywhere in the monorepo; `pnpm build` is typecheck plus the client's
Vite build. `tsc --noEmit` with `moduleResolution: Bundler` typechecks across package boundaries.

## Consequences

- No stale `dist/` folders, no project references, one source of truth for every type.
- Server cold start pays a one-time TypeScript transform, negligible at the design scale.
- If a package is ever published outside the monorepo, it needs a real build then. Nothing is.
- Node's own `--experimental-strip-types` could replace `tsx` later behind the same scripts.
