# 0039. Content loads each puzzle's config through the protocol's wire schema

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md),
[0009](./0009-world-content-as-files.md) and [0019](./0019-boards-package-and-harness-bench.md).

## Context

A puzzle's config was declared three times: the engine's `validateConfig`, the protocol's
`<Id>ConfigSchema`, and the content schema its JSON file loads through. The three had drifted.
Content gave most fields a floor and no ceiling: Cooling's `width` was at least 3 in content and 3
to 16 on the wire, and Racks' `startCells` had no ceiling in content, 56 on the wire and
`racks * (height - 1)` in the engine. A content file past a wire bound but inside the engine's loaded,
passed the server's startup check (the engine's validator), and was refused only by the client's
parse of `puzzle.started`, which drops a message it cannot read: the round never opened.

The harness held a lab config to the wire schema and the engine's validator through a `configSchema`
field on every bench entry, and the voyage bench redid part of that check by hand.

## Decision

1. **A puzzle's config bounds are declared in two places.** The engine's `validateConfig`, for the
   pure engine, and the protocol's `<Id>ConfigSchema`, for the wire and for content. Content's
   puzzle schemas take `config` from `PUZZLE_CONFIG_SCHEMAS` and declare only what is content's own:
   the round's length, par, thresholds, piece styles, message keys and client timing. `content`
   depends on `protocol` for it.
2. **A rule every config the server deals must keep belongs to the wire.** The shape of a Gunnery
   deck and a battle board (rows the same width, one feeder, one start for each ship) moved from
   content to the protocol. A rule only the game's own content keeps stays in content, as a
   refinement on the wire schema: a game deck carries four turrets, which the engine does not need.
3. **The engine keeps its own validator.** It has no dependencies and must not gain one (ADR 0003),
   and the server runs it on content at startup and on the configs it builds aboard. Tests keep the
   two declarations in step: every content config and every harness preset passes both.
4. **The harness asks one question.** `serverAcceptsConfig(id, config)` holds a config to the wire
   schema, the engine's validator and the rule that the wire strips nothing from it. Lab rounds,
   logs opened for review and every battle and melee the voyage bench would deal go through it.

## Consequences

- A content file past a wire bound fails when content loads, with the field's path.
- The parsed content did not change. Cooling's wire schema now lists `shipHeat` where content did,
  so its keys come out in the same order as before.
- Changing a bound means changing the protocol schema, and the engine's validator when it checks the
  field. No content schema has a copy to forget.
- The engine's validators for the five duty puzzles are looser than the wire on several fields (no
  ceiling on points or move counts; Cooling does not check its special chances). Content can no
  longer reach those values and lab configs never could, so the gap is noted and left as it is.

## Alternatives considered

- **Generate one declaration from the other.** The engine cannot use Zod, and a generator from the
  engine's hand-written checks to schemas, or back, is a build step for fifteen small schemas.
- **Keep content's schemas and test that they match the wire.** Three declarations still drift
  wherever the test does not look, and a content file would still fail with the server's message
  instead of its own.
- **Protocol takes its config schemas from content.** Backwards: content is one source of configs.
  The server's aboard builders and the harness lab are others, and the wire is the contract all of
  them meet.
