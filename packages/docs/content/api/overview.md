A puzzle starts as a few lines of code and plays at once. From there it grows a rung at a time, and nothing already written changes on the way up. At the top it is documents and a little code: the documents say what exists, the code says what a move does, and the engine does the rest, the same way for every puzzle.

## Start small, and climb

```ts title=swap.puzzle.ts
import { puzzle, grid, swap, lines, refill, budget } from "@openseas/puzzle";

export default puzzle("swap", {
  board: grid(6, 7),
  pieces: 5,
  parts: [swap(), lines(3), refill()],
  ends: budget(20),
});
```

That is a whole puzzle. The [quickstart](/api/quickstart) plays it. Three rules make so little enough.

- **Everything has a default.** A board, pieces, something to do and an ending make a puzzle that plays.
- **A puzzle is built from parts.** A part is a mechanic with everything it needs: what it declares, and the code that works it. Stock parts, the rules a player unlocks and a rule of your own are all parts.
- **Nothing is hidden.** Whatever you write, the engine runs one whole document and one object of hooks, and you can print both.

| Rung | You write | New ideas |
|---|---|---|
| [Run and compose](/api/quickstart) | A board, pieces, stock parts and an ending | Round, move, board, pieces, part, ending |
| [Tune](/api/tune) | Numbers and what pays, as data | Setting, payout, multiplier, condition |
| [Write a rule](/api/own-rule) | A part of your own | Hook, event, draw, state |
| [Add depth](/api/depth) | Stages, tasks, gauges, ticks, a hint | Stage, task, gauge, tick |
| [Seat more players](/api/seats) | Sides, turns, phases and hidden hands | Seat, phase, sight, stand-in |
| [The whole thing](/api/write-a-puzzle) | Every key and every hook, by hand | What every rung expands to |

You can stop on any rung with a puzzle that plays. What the game asks before it deals a puzzle to players is on [Ship it](/api/ship).

<!-- figure: documents -->

## The four files

This is what a puzzle is made of once it is whole. A puzzle on a lower rung has all of it too: its parts and the defaults make the document and the rules, and a stock skin dresses it.

| File | What it is | What it holds |
|---|---|---|
| `<id>.puzzle.json` | The [puzzle document](/api/puzzle) | Everything the puzzle declares about itself: its round, board, pieces, deal, settings, moves, events, scoring, layers and ladder. Written out when a puzzle is [promoted](/api/ship), and printed by `expand` before then |
| `<id>.rules.ts` | The [rules](/api/rules) | The only code. A plain object of hooks that say what happens when a round starts, a move is made or a tick passes |
| `<id>.skin.json` | A [skin document](/api/skin) | How one puzzle looks and sounds in one theme: a drawing for every piece, its cues, its motion and its words |
| `<theme>.theme.json` | A [theme document](/api/theme) | What every skin of one look shares: a palette, type, a sound frame, and the cues and motion a new skin starts from |

A puzzle has one document and one rules file. It has one skin for each theme it is dressed in, and its default skin is the one in the default theme.

## Who owns what

The split between the files is strict, and it is what makes a puzzle safe to change.

- **Only the puzzle document holds numbers.** A skin never sets one, not even how many kinds of piece a board deals.
- **Only the rules decide what a move does.** They change a round in one way: by reporting events.
- **Only the skin and its theme say how anything looks, sounds or reads.** Nothing in them reaches the rules, so no look can change a round.
- **The engine keeps everything puzzles share.** The log, time, seats, turns, phases, points, the streak, endings and what each seat may see are never written by hand.

## How to read the reference

Each of the three documents is one JSON object, and the reference is laid out the way the object is. The [puzzle object](/api/puzzle), the [skin object](/api/skin) and the [theme object](/api/theme) each have one page, with everything in the object on it. Every object inside one is a section of that page, such as [`round`](/api/puzzle#round) in the puzzle, and whatever is nested deeper is defined inside its parent's section.

Every field says four things.

| Part | Says |
|---|---|
| Name | The key as it is written, with its path from its section's object, such as `tempo.kind` |
| Type | What its value is, down to a primitive value. A list always says what it is a list of. A named type links to [Types](/api/types) |
| Required, optional or conditional | Whether the key is always written, may be left out, or is written in one case and refused in every other |
| Description | What the value means. Then what leaving it out means, what it may only sit beside, what it may never sit beside, and what it must agree with |

Where a value is one of a fixed set, every possible value is listed and explained. Each section ends with what must hold across its fields: the combinations a host refuses.

A key that is left out is left out of the file. It is never written as `null`.

## Where to start

- To make something that plays: the [quickstart](/api/quickstart). It needs nothing read first.
- To know the words: [What a puzzle is](/domain) takes five minutes and gives every word used here.
- To see everything working together: [The whole thing](/api/write-a-puzzle) builds a small puzzle from an empty file with nothing left to a default.
- To look something up: go to the object you are editing, or search for a key by name.
- To see a whole puzzle as shipped: [Paths, in full](/api/paths) shows both of its documents.

> [!PREVIEW]
> The engine is being built to this design, a rung at a time from the bottom. The documents and the names of the hooks are settled. The exact TypeScript on the rung pages and the rules pages may still move while it is built, and each rung's page says whether it is built yet.
