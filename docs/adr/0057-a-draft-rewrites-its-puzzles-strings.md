# 0057. The studio's Text mode: a draft rewrites its puzzle's strings, and a puzzle has a category

Status: Accepted. Builds on [0056](./0056-the-studio-is-laid-out-as-a-design-tool.md), on
[0045](./0045-drafts-are-kept-by-the-studio-service.md),
[0046](./0046-save-writes-a-drafts-numbers-to-a-pull-request.md),
[0050](./0050-a-frame-or-a-cue-can-be-swapped-on-a-running-board.md) and
[0052](./0052-a-pick-is-the-drafts-and-a-tester-link-carries-it.md). It supersedes nothing.

## Context

A puzzle is its numbers, its art, its sound and its words: its name, what its start card says,
what the board calls out ("Double!"), the names of its pieces and what each special does. The
studio tuned the first, and since ADR 0050 to 0054 picked the second and third. The words could
be changed only by asking the chat's agent to edit the message table.

The owner asked for a seventh mode on the rail for the puzzle's name, a category (prototype,
duty, crafting) and every string the puzzle says, and settled three things about it: an edit
goes all the way to Save, as a pick does; the category is a label and moves nothing; and every
string that is the puzzle's is offered, not a chosen few.

Two things about the code as it stood shape how that is done:

- Every string a puzzle says is already keyed to it in the message table (`cooling.title`,
  `cooling.multi_2`, `cooling.special.slag_help`), with its name and blurb on the grid under
  `home.practice_<id>`. Every reader goes through one function, `t`, in `boards`.
- What kind of puzzle one is lived in code: the engine's registry lists the core puzzles and the
  prototypes, and promoting a prototype is its own ADR and milestone (ADR 0036).

## Decision

1. **A draft has words.** `DraftNumbers` gains `words`: `texts`, a map from a key of the message
   table to the rewritten string, and `category`, set where the draft changes it. They travel
   exactly as picks do (ADR 0052): kept by the service beside the numbers, in the address when
   signed out (`text.<key>=`, `category=`), frozen in a tester link, cleared by Reset all. A
   service older than words says so (`words` on `/auth/me`), and the page then leaves them in the
   address, as it does picks for a service older than picks.

2. **A string is a puzzle's to rewrite when its key says so**: `<puzzle>.*`, and the puzzle's
   name and blurb on the grid. `isPuzzleText` in `protocol` is the one rule, asked by the page, by
   the frame before it lays a string over the table, and by Save. A link cannot rewrite another
   page's words.

3. **A rewritten string keeps the names the shipped one fills in.** `{count} in a row!` may
   become `{count} straight!` and may not become `Many straight!`: the board would print a brace
   or lose a number. The field refuses such an edit where it is typed and the draft keeps the
   last words that were sound; the frame lays no such string over the table; Save refuses one.
   An empty string and one past 600 characters are refused likewise.

4. **`boards` can lay strings over the message table**, as it can draw a frame from another
   image (ADR 0050): `overrideMessages`, and `t` reads what is laid first. Presentation only, and
   the game never sets one. A board bakes its words when it is made, so the page makes it again
   on the round as it stands, once the hand has rested. While the shipped numbers are held up for
   comparison, so are the shipped words.

5. **The Text mode** is the rail's seventh, in the cluster with Sprites and Sounds: what a
   player sees, hears and reads. Its panel has the category and a row a string, in five sections
   read from each key (identity, start card, in play, pieces, result card). A row is labelled
   with its key read as words, shows the names it must keep, and carries the dot and the button
   every changed control does. The search of the numbers modes covers it: one search finds a
   number or a word in whichever mode, and the top bar's list of changes counts and lists both.

6. **A puzzle has a category, and it is a label.** Each puzzle's content file gains `category`:
   `duty`, `fight`, `crafting` or `prototype`. The studio's grid shows it on each tile and its
   menu of puzzles groups by it. It decides nothing else. Whether a puzzle is dealt in the game is
   still the engine's registry and the server's, so a draft that relabels a prototype as a duty
   puzzle promotes nothing: promotion stays its own ADR and milestone (ADR 0036). The list is
   kept in `content` and repeated in `protocol`, which cannot depend on it; a test holds the two
   to each other.

7. **Save writes the words.** The category is a key of the puzzle's content file and is written
   with the numbers. The strings are written into `packages/content/data/messages/en.json`, each
   where it stands, so the commit's diff is those lines. A string the draft has let go since the
   last Save goes back to what the base branch holds, as a number does. A string that is not the
   puzzle's, that the table does not have, or that breaks decision 3 refuses the Save as
   `unknown_key`. The commit message and the pull request list each string with its shipped words
   and the draft's, and the pull request says that the puzzle's guide and design file may quote a
   string and are re-read: that stays a developer's to do (ADR 0049).

8. **The agent is told the draft's words** under each message, and to leave those keys be: Save
   writes them. It can still edit any other string in the table, as before.

## Alternatives considered

- **Leave words to the chat.** It worked, slowly, and gave no list of what a puzzle says.
- **Words on the page and in the play link only**, with Save to follow. Half of it: a tester
  could see the words and the pull request would not hold them.
- **A chosen few strings** (name, start card, call-outs). Every string is one rule and no list
  to keep; the sections keep the long tail out of the way.
- **A file a puzzle naming its strings and their sections**, as the tuning groups are. More
  exact, and one more thing a new string must be added to; the key already says enough.
- **The category deciding where a puzzle is dealt.** It would make a label in a draft able to
  put an unfinished puzzle in the game.
- **Written labels for the rows.** A string a string, for every puzzle: the key read as words
  costs nothing and is always there.

## Consequences

- `content`'s puzzle schemas require `category`; every content file has one.
- `Scenario`, `DraftNumbers` and the stored-draft code carry `words`; what was a flag for
  "the service keeps picks" is now what it keeps of picks and of words.
- The grid's "Prototype" line on a tile is now every tile's category, and the menu of puzzles
  has a heading a category.
- A string a puzzle newly says is offered in the Text mode with no further work, in the section
  its key reads as.
- The guides type no tuned number but do quote words; a pull request that rewrites a string says
  so, and nothing re-captures or re-reads by itself.
