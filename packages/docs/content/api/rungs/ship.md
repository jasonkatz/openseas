The rungs are about reaching a round you can play, quickly. Everything that protects a player is asked later, in one place, when a puzzle is promoted.

## Three states

| State | What it takes | What it allows |
|---|---|---|
| Valid | A board, a piece, a move and an ending | Play in the studio. Rounds are scored and never judged. The game cannot deal it |
| Ready | Everything below | Promotion |
| Promoted | One command | The game may deal it to players |

The seven lines of the [quickstart](/guides/quickstart) are valid.

## What ready asks

| It asks | Why |
|---|---|
| At least two stages | A new player meets a puzzle a few rules at a time. See [`ladder`](/reference/puzzle#ladder) |
| Where its tiers start | A round that counts is judged on the scale every puzzle shares. See [`evaluation`](/reference/puzzle#evaluation) |
| Its biggest moment, named | Every skin plays its beat on the same event. See [`moment`](/reference/puzzle#moment) |
| A fallback for every check | When luck fails every try, the rules lay a board that is sure to pass. See [`onFallback`](/reference/hooks#onfallback) |
| Every payout sized by a setting | So nothing a player earns is a number nobody can tune |
| A text for every key and a skin of its own | The stock skin and words made from ids are for building, not for players |
| Witness rounds, and a version | Recorded rounds that must keep replaying the same, so a change cannot quietly move an old score |

[A puzzle is ready when](/domain/documents#a-puzzle-is-ready-when) lists every condition.

## Ask what is missing

One command says what a puzzle still lacks, a line for each thing.

```sh
pnpm --filter @openseas/puzzle ready swap.puzzle.ts
```

```text
swap is not ready:
  - its ladder has one stage: a player meets a puzzle over two to four
  - it does not say where its tiers start, so its rounds cannot be judged
  - it names no moment, so no skin can play its beat
  - its payout clear is sized by no setting, so nobody can tune it
  - it keeps no witness rounds
```

The same answer is a function, `ready(puzzle, witnesses)`, for a host that wants it. It holds the puzzle and its rules. A skin and its words are the host's to check.

## Tiers and the moment

Both are data, written where the puzzle is.

```ts title=paths.puzzle.ts
export default puzzle("paths", {
  // ...
  evaluation: { tierStarts: { steady: 850, sharp: 2450, masterful: 4800, legendary: 8400 }, paceWindowSeconds: 10 },
  moment: { event: "loop", when: "prizes > 0", size: "prizes", most: "maxPrizes" },
});
```

With tier starts a round is judged: `read(round).tier` is the tier its score stands in, from `green` to `legendary`. Without them it is `null`.

## Witness rounds

A witness round is a recorded round: its seed, stage, settings and log, and the read it gave. Played again, it must give the same read. A puzzle keeps its witness rounds in a file beside its source.

```sh
pnpm --filter @openseas/puzzle witness paths.puzzle.ts
```

```text
paths: recorded 4 witness rounds in paths.witness.json
  paths: 79 moves, score 711, green
  streak: 79 moves, score 711, green
  loops: 79 moves, score 711, green
  full: 79 moves, score 1041, steady
```

The command plays one round at each stage with the puzzle's own hint. They are rounds to hold the puzzle to, not good ones, and rounds people played can be kept in the same file. A witness holds the settings it was played with, so tuning a number moves none. A change to a rule or to the scoring does, and `ready` names the round and what moved:

```text
  - the witness round on seed witness-paths at stage paths no longer gives the read recorded for it: score changed (the score was 711 and is 237)
```

## Promote

```sh
pnpm --filter @openseas/puzzle promote paths.puzzle.ts
```

Before promotion, your code is the puzzle's source, written as briefly as its defaults allow. Promotion writes the whole document to `paths.puzzle.json`, once, with the witness rounds beside it. It refuses a puzzle that is not ready, and one that is already promoted. From then on that file is the only place the puzzle's numbers and declarations are, and the code shrinks to its parts and your own hooks.

```ts title=swap.puzzle.ts
// After promotion. Every number is now in swap.puzzle.json.
import { rules, swap, lines, refill } from "@openseas/puzzle";
import document from "./swap.puzzle.json" with { type: "json" };

export default rules(document, [swap(), lines(), refill()]);
```

`rules` gives what `puzzle` gave, so `start`, `play` and `read` do not change. The parts are listed in the order they are asked in. Each must find in the document everything it works, and what a part would have declared for itself is not read.

So for every puzzle a player can meet, only the document holds a number. A tuning panel edits that one file, and there is never a second copy to disagree with it. A number written in the code is refused when the puzzle is built: `lines(3)` is an error here, and `lines()` reads the setting.

Promotion allows the game to deal a puzzle. Giving it a place in a world is the world's own step.

## What stays the same

`expand` and `explain` work before and after. A promoted puzzle's document is what `expand` printed on the day it was promoted, and every [key of it](/reference/puzzle) is the reference's.
