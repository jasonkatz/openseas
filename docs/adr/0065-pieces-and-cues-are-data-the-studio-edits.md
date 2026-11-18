# 0065. Pieces and cues are data the studio edits: a Sprites editor, a Sounds editor, and Save writes both

Status: Accepted. Builds on [0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md),
and supersedes the parts of it that say how a piece or a cue is changed: decision 1's "a piece is
drawn in code", read as each piece written as Canvas calls in its puzzle's `pieces.ts`, and its
Consequences' "the owner no longer picks takes; the owner reviews pieces on the board in a pull
request". Nothing generated comes back: decisions 5 and 6 of 0062 stand, as do
[0063](./0063-stored-sprite-picks-and-takes-are-read-and-ignored.md) and
[0064](./0064-stored-sound-picks-and-takes-are-read-and-ignored-and-the-beats-sound-stands-alone.md).
It extends what a draft is, as [0057](./0057-a-draft-rewrites-its-puzzles-strings.md) did for words.

## Context

Since M10 every piece is a pictogram drawn in code and every cue is synthesized from a few voices
on one scale. Both are small and exact, which was the point. But the owner tunes everything else in
the studio, live, on the board: numbers in three modes, words in the Text mode. A piece or a cue
could only be changed by a developer, or by asking the chat's agent to edit `pieces.ts` or
`cues.ts`, and seen on a pull request's preview. The Sprites mode was gone and the Sounds mode was
a list to listen to.

Both were already nearly data. A cue was a function returning a list of voices, each a note, a
wave, a start, a rise, a fall and a level; what varied with the board's arguments was a handful of
patterns (climb the scale with a cascade, repeat a note a row, a voice only past a threshold). A
piece was a sequence of six helper calls (`rounded`, `disc`, `soft`, `bar`, `cut`, and a few
paths) on the 24 unit square. A survey of all fifteen puzzles found every fixed pictogram could be
written as layers of a few shapes; what could not was composition only code says (a plate's
footprint, a rod's numeral, a slab's size, pips by count, a clip).

## Decision

1. **Pieces are data.** Each puzzle's pictograms are named drawings in
   `packages/boards/data/pieces/<puzzle>.json`: a list of layers on the 24 unit square, each a
   rounded rectangle, a disc, a polygon rounded by a stroke of its own colour, a round-ended bar,
   a stroked arc or a path, filled or cut out, turned or repeated about the centre. One painter
   (`boards/src/kit/drawing.ts`) draws them. A puzzle's `pieces.ts` keeps what only code can say
   and composes the drawings: it picks one by state, stamps a cut-out drawing (`detail`) into a
   footprint, scales it, writes a numeral beside it. The conversion is pixel for pixel: 316 of 319
   renders of the old code are identical and the other three differ by a few antialiased pixels.
2. **Cues are data.** Every cue's voices are in `packages/boards/data/cues.json`, with the rules
   that vary them by what the board passes: `shift` (every tone not `fixed` up the scale by a
   parameter), `when` (a voice only while a parameter is in a range), `repeat` (a voice sounded a
   number of times, each a step on), `alt` (another level and low-pass while a parameter holds)
   and `swell` (the level scaled by a parameter). The 28 cues sound exactly as their functions
   did, at every row of their probes. Which cues exist, and what each is passed, stays code
   (`CUE_PARAMS`), since it is the board's call; a test holds the two files to each other.
3. **The schemas are the protocol's** (`protocol/src/look.ts`), so the page, the boards and the
   service read one shape. Their key order is the files' order: Save writes an entry as its
   schema gives it back, since the database keeps an object's keys in an order of its own.
4. **A draft has a look.** `DraftNumbers.look` holds the pieces it redraws, by name, and the cues
   it revoices, by name, defaulted for a draft or a link kept before. It is carried as words are:
   the board draws and plays it at once (the board is made again on a change, as for words), the
   address carries `piece.<name>=` and `cue.<name>=`, a tester link freezes it, Reset all puts it
   back, the top bar lists it. A service older than the look says so (`StudioMe.look`) and the page
   keeps the look itself.
5. **The Sprites mode** is an editor: the puzzle's drawings as tiles (in their colours, or all in
   one, as the brand book's silhouette check asks), and for one of them a stage with the grid and
   the 20 unit square, handles to drag, the layers as a list, every number in an inspector, undo,
   and previews at the sizes the board draws. Notes say where a drawing breaks a rule of
   `docs/BRAND.md` section 3: a part too thin, a corner too sharp, more than one kind of cut-out,
   reaching past the square, or a silhouette too like another of the puzzle's. They are notes: the
   owner decides, and a shipped piece may break one on purpose.
6. **The Sounds mode** is an editor: the cue list as before, and for one cue a roll of its voices on
   the scale's notes over time, dragged to move or lengthen, an inspector for each voice, the
   rules, a play button for every row a board may ask it with, and what that row sounds drawn
   faint behind. The rules of `docs/BRAND.md` section 8 are hard: a revoiced cue that breaks one
   (too long, too sharp a rise, too bright, a rule naming a parameter the board does not pass) is
   said to, plays as shipped, and holds Save until it is mended. The editor's fields are bounded
   by the same limits, so most cannot be broken at all.
7. **A cue is the game's.** A draft for one puzzle that revoices a cue revoices it on every board
   that plays it; the editor says how many, and the pull request says so.
8. **Save writes the look** into the two files, each entry where it stands and drawn as the one
   it replaces, an entry let go put back to the base branch's, and a name the file does not have
   refused, as Save does for words. Its pull request lists the pieces and cues and says what a
   developer finishes: a recapture of the guide's pictures for a redrawn piece.

## Consequences

The owner can redraw a piece or revoice a cue and play it at once, send it to a tester, and Save
it, without a developer. A board's look is still exact and still code-drawn: the data is what the
helper calls were, and one painter draws it. A piece that needs a new kind of shape (an `arcTo`
corner, a clip) needs the painter and the schema to grow, in a pull request. The puzzle's
`pieces.ts` files are shorter, and what is left in them is composition. The studio's sound and
look tests hold the shipped files, so a saved draft that breaks a rule fails CI on its pull
request. The chat's agent is told which entries the owner is editing and leaves them alone.

## Alternatives considered

- **A live preview that saves nothing.** It needs no format change, and every change still waits
  for someone to copy it into code.
- **The agent writes the code on Save.** Code stays the source, and every Save depends on a
  model turning numbers back into calls it could get wrong.
- **SVG files for pieces.** Rejected again for 0062's reason: a file cannot read a token. The
  layers here name no colour at all.
- **A free synthesizer.** Any wave, any pitch, any effect: it would break the one key and the
  soft voice the brand book holds every cue to.
- **Cue rules as expressions** (`note + chain - 1`). More general, and a small language to parse,
  check and explain; five named rules covered all 28 cues.
