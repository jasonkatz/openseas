The rungs are about reaching a round you can play, quickly. Everything that protects a player is asked later, in one place, when a puzzle is promoted into the game.

> [!PREVIEW]
> Valid and ready are settled. The command that promotes a puzzle is designed and not built yet.

## Three states

| State | What it takes | What it allows |
|---|---|---|
| Valid | A board, a piece, a move and an ending | Play in the studio. Rounds are scored and never judged. The game cannot deal it |
| Ready | Everything below | Promotion |
| Promoted | One command | The game may deal it to players |

The seven lines of the [quickstart](/api/quickstart) are valid.

## What ready asks

| It asks | Why |
|---|---|
| At least two stages | A new player meets a puzzle a few rules at a time. See [`ladder`](/api/puzzle#ladder) |
| Where its tiers start | A round that counts is judged on the scale every puzzle shares. See [`evaluation`](/api/puzzle#evaluation) |
| Its biggest moment, named | Every skin plays its beat on the same event. See [`moment`](/api/puzzle#moment) |
| A fallback for every check | When luck fails every try, the rules lay a board that is sure to pass. See [`onFallback`](/api/hooks#onfallback) |
| Every payout sized by a setting | So nothing a player earns is a number nobody can tune |
| A text for every key and a skin of its own | The stock skin and words made from ids are for building, not for players |
| Witness rounds, and a version | Recorded rounds that must keep replaying the same, so a change cannot quietly move an old score |

[A puzzle is ready when](/domain/documents#a-puzzle-is-ready-when) lists every condition.

## What promotion does

Before promotion, your code is the puzzle's source, written as briefly as its defaults allow. Promotion writes the whole document to a file, once. From then on that file is the only place the puzzle's numbers and declarations are, and the code shrinks to its parts and your own hooks.

```ts title=swap.rules.ts
// After promotion. Every number is now in swap.puzzle.json.
import { rules, swap, lines, refill } from "@openseas/puzzle";
import document from "./swap.puzzle.json";

export default rules(document, [swap(), lines(), refill()]);
```

So for every puzzle a player can meet, only the document holds a number. A tuning panel edits that one file, and there is never a second copy to disagree with it. After promotion, a number written in the code is refused when the puzzle is built.

## What stays the same

`expand` and `explain` work before and after. A promoted puzzle's document is what `expand` printed on the day it was promoted, and every [key of it](/api/puzzle) is the reference's.
