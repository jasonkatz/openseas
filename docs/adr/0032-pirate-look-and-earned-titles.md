# 0032. A pirate's look and titles: content ids on the pirate, titles earned once and kept

Status: Accepted. Builds on [0009](./0009-world-content-as-files.md) and
[0028](./0028-standing-is-earned-in-the-game.md).

## Context

The owner asked for a player menu: one place to manage your character, see your stats and build
an identity. Until now a pirate was a random name, a balance and hidden ratings. Others could see
your standing and voyages on your card, but you had nothing of your own to choose or work towards.
DESIGN.md 3.6 keeps inventory and clothing out of v1, and there is no economy to buy anything with.

Identity here needs two things. The first is something a pirate picks and others see, which costs
nothing and changes nothing about play. The second is something a pirate earns, which says what
they have done and gives them a reason to keep going. Both have to fit the existing rules:
- world content lives in files (ADR 0009);
- standing is earned in the game, never in the harness (ADR 0028);
- the server is the only authority;
- everything reads without color (rule 6).

## Decision

- **A look is two content ids.** `content/data/world/pirates.json` lists coats (an id, a hex and a
  name) and hats (an id and a name). The pirate row keeps the pair as `look`, or null until the
  pirate picks one. Until then a look is drawn from the pirate's id (`defaultLook`), so a deck of
  new pirates is a mixed crew, and every viewer draws the same one. The server checks each pick
  against content (`pirateLookProblem`) and refuses anything else with `look_bad`. Every hat has
  its own silhouette, and no look uses a deckhand's smock or kerchief, so pirates and deckhands
  still read apart without color (DESIGN.md 3.4). The look is not an item: it is not bought,
  owned or traded, and the economy (phase 3) can later put a price on some ids without moving
  this data.
- **The ship snapshot carries each pirate's look.** The ship service asks a `LookLookup` (the
  connection layer's in-memory `PirateLooks`, filled as pirates connect and pick), the same way
  it asks the crew service for crews. A new pick rebroadcasts the snapshot of every ship the
  pirate is aboard. Deckhands carry no look.
- **Titles are content with a requirement.** Each title in `pirates.json` names what it asks for.
  It is one of:
  - `start`: every pirate has it from the first day;
  - a count of voyages to port, voyages to port as captain, brigands beaten, or coins of booty;
  - standing at a puzzle at or above a rating tier.

  Startup checks reject a standing title that names an unknown puzzle or tier, and two titles
  that ask for the same thing.
- **The record is read from the tables that already exist.** Voyages come from `voyage_crew`
  joined to arrived voyages, captaincies from `voyage.captain_id`, and rated boards from
  `rating.rounds`. Brigands beaten and booty come from the ledger's `booty` entries: a win pays
  every pirate aboard a share (ADR 0030), so one share is one brigand beaten. Nothing new is
  counted as play happens, so the record cannot drift from the ledger.
- **An earned title is written down and kept.** `pirate_title (pirate_id, title_id, earned_at)`
  gets a row the first time the record meets a title. The row is never deleted. Counts only grow,
  but standing can fall, and a title earned at Sharp should not disappear after a bad week. The
  server checks for new titles at these points:
  - when the pirate connects;
  - when their summary changes on the ship's side (arriving in port, a share of a purse);
  - after a board that moved their standing;
  - when they open their sheet or pick a title.

  The insert is `on conflict do nothing`, so two checks at once still announce a title only
  once. Each new title is announced with `pirate.titles`. The client shows a toast with a button
  that opens the sheet.
- **A title is shown only once earned.** The pirate row keeps the one being worn as `title`. The
  server refuses a title that isn't earned with `title_locked`. A title that content later drops
  is shown as none. Since standing only moves in the game (ADR 0028), harness rounds earn no
  standing titles.
- **Raw ratings still never reach the client.** The sheet sends, for each standing title, the
  index of the pirate's tier and of the tier it asks for (DESIGN.md 3.6).

## Consequences

- One additive migration: two nullable columns on `pirate` and a new table. Linking a guest to an
  account moves the pirate row, and the look and titles come with it.
- Adding a coat, a hat or a title is a content PR. Taking one away is safe: a dropped look falls
  back to the default, and a dropped title shows as none.
- The record is a handful of indexed aggregate queries per check. That is cheap at the design
  point (DESIGN.md 1) and easy to cache on the pirate row later if it ever is not.
- Titles earned before this shipped are announced the first time a pirate connects afterwards, all
  at once.
