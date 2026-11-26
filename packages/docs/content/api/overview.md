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

Every table in the reference has the same three columns.

| Column | Says |
|---|---|
| Key | The key as it is written in the document |
| Type | What its value is |
| Holds | What the value means, and what leaving it out means |

A few types come up on every page.

| Type | Is |
|---|---|
| id | A short neutral word, lower case, such as `paths`, `loop` or `prize_floor`. It never carries a word from a theme: the skin names everything a player sees |
| line | One plain sentence. It is shown to whoever tunes or reads the puzzle, never to a player |
| setting | The id of one of the puzzle's [settings](/api/puzzle#settings) |
| number or setting | A number written in place, or the id of the setting that holds it. A board's size, a zone's capacity and a gauge's most are all written this way |
| typed fields | An object of names, each given a field type such as `place` or `number`. Moves, events and signals carry these |

A key the reference marks as absent in some case is left out of the document in that case. It is never written as `null`.

## Where to start

- New to all of this: read [What a puzzle is](/domain) first. It takes five minutes and gives every word used here.
- To see every part working together: follow [Write a puzzle](/api/write-a-puzzle), which builds a small one from an empty file.
- To look something up: go to the page for the file you are editing.
- To see a whole puzzle as shipped: [Paths, in full](/api/paths) shows both of its documents.

> [!PREVIEW]
> The engine that reads these files is being built to this design. The documents and the names of the hooks are settled. The exact TypeScript signatures on the rules pages may still move while it is built.
