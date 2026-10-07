# 0001. Spiritual successor, not a clone

Status: Accepted

## Context

Puzzle Pirates is a live, trademarked product. A faithful clone with the original names, art, and
text is a cease-and-desist risk the moment it has public players. A fully original game loses the
mechanics that make the source worth revisiting.

## Decision

Build a spiritual successor. Mechanics are faithful where they are good. The game name, art, text,
audio, and all coined terms are original. Generic nautical puzzle names are kept. Differences from
the original are documented deliberately in `docs/DESIGN.md`.

## Consequences

- No asset, string, or name may be copied from the original. Reviewers check for this.
- Special pieces and coined concepts need original names before they ship.
- Mechanics can be studied from play and public documentation, but the implementation is ours.
