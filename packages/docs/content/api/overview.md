A puzzle is written as documents and a little code. The documents say what exists: the board, the pieces, the moves, the events, what each event pays. The code says what a move does. The engine does the rest, the same way for every puzzle.

<!-- figure: documents -->

## The four files

| File | What it is | What it holds |
|---|---|---|
| `<id>.puzzle.json` | The [puzzle document](/api/puzzle) | Everything the puzzle declares about itself: its round, board, pieces, deal, settings, moves, events, scoring, layers and ladder |
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

Each of the three documents is one JSON object, and the reference is laid out the way the object is. The [puzzle object](/api/puzzle), the [skin object](/api/skin) and the [theme object](/api/theme) each have a page that lists every key. Every object inside one has a page of its own under it, such as [`round`](/api/puzzle/round) under the puzzle. Whatever is nested deeper is defined on its parent's page.

Every field says four things.

| Part | Says |
|---|---|
| Name | The key as it is written, with its path from the page's object, such as `tempo.kind` |
| Type | What its value is, down to a primitive value. A list always says what it is a list of. A named type links to [Types](/api/types) |
| Required, optional or conditional | Whether the key is always written, may be left out, or is written in one case and refused in every other |
| Description | What the value means. Then what leaving it out means, what it may only sit beside, what it may never sit beside, and what it must agree with |

Where a value is one of a fixed set, every possible value is listed and explained. Each page ends with what must hold across its fields: the combinations a host refuses.

A key that is left out is left out of the file. It is never written as `null`.

## Where to start

- New to all of this: read [What a puzzle is](/domain) first. It takes five minutes and gives every word used here.
- To see every part working together: follow [Write a puzzle](/api/write-a-puzzle), which builds a small one from an empty file.
- To look something up: go to the object you are editing, or search for a key by name.
- To see a whole puzzle as shipped: [Paths, in full](/api/paths) shows both of its documents.

> [!PREVIEW]
> The engine that reads these files is being built to this design. The documents and the names of the hooks are settled. The exact TypeScript signatures on the rules pages may still move while it is built.
