# 0077. A theme is a document its skins read

Status: Accepted. Supersedes the line of [0073](./0073-motion-is-the-skins-and-the-puzzle-names-its-moment.md)
decision 10 that a theme stays a set of skins with no document of its own, and the words "the game's"
for the cues and motion a new skin copies in [0070](./0070-each-puzzle-has-its-own-copy-of-its-cues.md)
and 0073: they are the space theme's. Builds on [0061](./0061-the-game-looks-lo-fi-and-minimalist-by-a-brand-book.md),
whose brand book becomes the space theme's.

## Context

The puzzle domain guide (`docs/puzzles/DOMAIN.md`) defined a theme in one line, a set of skins that
dresses every puzzle in one look, and left what a theme holds uncovered. Skins already lean on things
no document in the domain holds: a drawing's tint and the beat's colour name palette colours (`sand`,
`amber`) whose values live only in the brand book and a token module in `boards`, and a new skin's cues
and motion are copied from "the game's", which is the space theme in all but name. The owner wants a
theme to be something that can be made, checked and changed, so a second look is possible.

## Decision

1. **A theme is a third document,** beside the puzzle and the skin.
2. **It holds five things:** its **palette** (every colour's name and value), its **type** (faces and
   sizes), its **sound frame** (the scale every cue's notes come from, and its limits: the longest cue
   and the highest cutoff), the **starting cues and motion** a new skin copies, and its **host texts**
   (the words the host says in this theme: tier names, start, countdown, end). Arrangement, the
   chrome's shapes and the game's three.js world stay the host's.
3. **Palette and type are read; cues and motion are copied.** A skin names a colour and the theme says
   what it is, so changing a theme's colour changes every board in it. Cues and motion stay copied
   into each skin when it is made, as ADR 0070 and 0073 decided, so each puzzle can revoice its own.
4. **A theme's starting cues and motion can be carried to its skins.** Changing one does not change
   any skin by itself. Whoever changes it can carry the change to every skin of the theme in one step,
   or to one skin at a time, and is shown which skins had changed their own copy before they are
   overwritten.
5. **Every theme fills seven fixed colours:** `ground`, `raised`, `line`, `text`, `dim`, `yours` and
   `danger`, so a host and any skin work under any theme. Its **piece colours** are a list it names
   freely, at least eight, because a family can deal eight kinds. The beat's colour names one of the
   theme's colours.
6. **Access and the painter's limits are the domain's; taste is the theme's.** One silhouette a kind,
   never colour alone, and a drawing on the 24-unit square hold in every theme. Flat fills, the key of
   the scale and how things move are a theme's: its sound frame is data the checks read, and the rest
   is prose in its own brand book.
7. **A skin names its one theme.** A theme is complete when it has a skin for every puzzle a host
   deals. A host runs one theme at a time and picks it; the player does not. A puzzle's default skin is
   its skin in the default theme.
8. **A new theme starts as a copy of another,** skins and all, so every board plays from the first
   minute. Its skins may then redraw any piece as a different subject, within decision 6.
9. **One palette a theme.** A light version of a theme is a theme of its own.
10. **A theme is ready when** every fixed colour is filled, it has at least eight piece colours, every
    skin's colours name its palette, every starting cue's notes are in its scale and within its limits,
    its type names its faces and sizes, it has a text for every host key, and it has a skin for every
    puzzle the host deals. A host checks this before it uses a theme.
11. **The studio edits a theme** (its palette, type, sound frame, starting cues and motion, and host
    texts) in a draft, as it edits skins. Building that is a change of its own.
12. **Space is the first theme.** Its document is made from the brand book's palette, type, motion and
    sound and from `boards/data/cues.json`. The brand book stays its prose; its sections on the world and
    the chrome stay the game's.

## Alternatives considered

- **No theme document; a new skin copies another skin.** What ADR 0073 left in place. It leaves the
  colours skins name with no home in the domain, and no way to make a second theme but by hand.
- **Palette and type copied into each skin, as cues are.** Every skin could then drift from its theme's
  colours, and recolouring a theme would mean editing every skin.
- **Cues and motion read from the theme, with a skin overriding.** It would undo ADR 0070's reason for
  copies: a puzzle revoicing its own without a change heard on other boards. Carrying a change on
  request (decision 4) gets the reach without the surprise.
- **A theme with a light and a dark palette.** It doubles every check, and a skin's colour would no
  longer name one value.

## Consequences

- The domain guide gains a Themes section and a third document, and loses "Themes" from "Not yet
  covered". The skin document gains `theme`.
- The glossary redefines theme and gains palette, fixed colour, piece colour, type, sound frame and
  host text.
- The brand book says it is the space theme's book, names its seven fixed colours, and drops "a second
  theme" from what it leaves out. Its `amber` fills the fixed colour `yours` and `cream` fills `text`.
- In the code, `boards` keeps the palette in a token module and the starting cues in
  `boards/data/cues.json`, which also holds the game's own cues played around the boards. Moving them
  into a space theme document, the host's check, carrying a change to skins, and the studio's theme
  editing are each a change of their own.
