# 0034. The game moves to space: a reskin with the mechanics frozen

Status: Accepted. Supersedes the clause of [0001](./0001-spiritual-successor.md) that keeps generic
nautical puzzle names, and the deckhands' smock and kerchief in
[0033](./0033-pirate-look-and-earned-titles.md). Builds on [0003](./0003-pure-engine-replay-verification.md),
[0009](./0009-world-content-as-files.md), [0020](./0020-three-js-world-with-boards-over-it.md) and
[0031](./0031-shared-puzzle-sprite-atlases.md).

## Context

Every milestone from M1 to M6 is built, and the tester sessions are still to come. The owner wants
the game set in space instead of on the sea. The loop should stay as it is: crews work duty puzzles
aboard a shared ship, the puzzles are the skill and drive progress, and an economy along the lines
of the original's comes later. The economy is thin today and stays out of this change. The owner
will generate the puzzle sprites later, so this change does not touch them.

The nautical theme is not only in the art. It is in about 1,300 player-facing strings, in every
world content file, and throughout the code: thousands of identifiers, file names, content ids,
database tables and stored values, protocol messages and routes. It is also in DESIGN.md's
as-built prose and in the 33 ADRs before this one.

## Decision

- **Space pirates in one star system.** Players are still pirates, now in space, so the crew, the
  captain, the raiders, boarding and the plunder keep their meaning. The ocean becomes one star
  system, and its three islands become three asteroid outposts joined by lanes. The tone stays as
  it was: a whimsical, scrappy frontier of duct-taped ships and cozy outposts, in the voice the
  strings already have. `docs/GLOSSARY.md` holds every word.
- **The mechanics are frozen.** No engine rule, scoring formula or content number changes. Engine
  diffs are renames only, so determinism, replay and tuning carry over unchanged. Each mechanic
  keeps its rule under a new name: the bilge becomes the ship's heat, rising from the bottom as the
  water did. Winds become solar currents and eddies become gravity wells. If a mechanic reads
  wrong in space, it is logged and changed later in its own PR.
- **Three puzzles are renamed.** Bilging becomes Cooling, Sailing becomes Engines, Carpentry
  becomes Plating, and Sea Battle becomes Space Battle. Gunnery, Navigation and Swordfighting keep
  their names: they are generic, and Navigation was already about stars.
- **What is reskinned now:**
  - every word;
  - the three.js world (the void, the outposts, the skiff and her deck, the pirates and the bots),
    redrawn in the same low-poly primitives.
- **What waits for the owner's sprite pass:** on the puzzle boards only the words change. Sprites,
  the procedural fallback pieces, board backgrounds, the water body, effects and sounds stay as
  they are until then.
- **The outposts are open-air rocks with no dome,** using the heightfield island, walking grid and
  layout as built (ADR 0032). The beach becomes a crater rim that drops into the void, and each
  landmark keeps its motion: a beacon tower, a turning radar dish and an ice geyser.
- **The skiff keeps the sloop's deck.** It sits open under a clear canopy that is drawn only when
  zoomed out, so the walkable layout and station spots stay where they are. A tail fin replaces the
  mainsail and carries the crew emblem. The flag flies from an antenna mast, a boarding tube
  replaces the gangplank, and an engine glow replaces the wake.
- **The look and the bots:**
  - A look is a jacket color and headgear, still two content ids (ADR 0033). Every headgear has its
    own silhouette, a captain's crest takes the place of the plume, and players are humans only.
  - Deckhands become bots: small maintenance robots with names of their own, never mistaken for a
    player, which rule 6 needed. This replaces the smock and kerchief that ADR 0033 relied on.
    Their output, `minCrew` and station order are unchanged (ADR 0023).
- **The whole codebase is renamed, not just its surface.** That covers identifiers, file names,
  content ids and file names, message keys, protocol, routes, DB tables and columns. A word that
  still fits space (ship, crew, captain, voyage, deck, hull, dock, broadside, grapple) stays.
- **The database is wiped, sign-ins included.** One ordinary migration empties every table, so
  everyone returns as a new guest. No data is mapped from old ids to new ones, and old URLs do not
  redirect.
- **History stays in its own words.** ADRs 0001 to 0033, the git history and past PRs are not
  edited. `docs/GLOSSARY.md` keeps every former word beside its replacement permanently, so they
  stay readable.
- **The codename stays.** `openseas`, the repository, package scopes, domains and hosting projects
  keep their names until a real name is chosen, and are renamed then, once.
- **The economy is unchanged.** Coins become credits and booty becomes plunder. The ledger and the
  phase 3 plans stand as written.

## Consequences

- This is milestone M7 (DESIGN.md 5.2). It lands as a sequence of PRs: docs, rename and wipe,
  words, then the world in three parts. The tester sessions run after it.
- The rename PR has to be provably behavior-neutral. Every engine test, property test and smoke
  stays green, and only names change.
- Until the words PR lands, the code speaks space while the game still reads nautical. Until the
  sprite pass, the boards show nautical pieces under space names. Both are accepted.
- The Puzzle Pirates rule (rule 3) still holds and gets easier: no puzzle name is shared with the
  original any more. New words also avoid terms coined by other well-known games and shows.
- The deliberate-differences table (DESIGN.md 6) keeps the original's words in its "Original"
  column. Only the openseas column moves to space words.

## Alternatives considered

- **Rename only the surface** (strings, content names, art) and keep nautical identifiers. This was
  rejected: the code and DESIGN.md would describe a different game from the one players see,
  permanently.
- **Map the stored ids to new ones in a migration.** This was rejected because the owner does not
  need the alpha data, and a wipe is simpler.
- **Domed towns, or orbital stations with interiors to walk.** Rejected: a dome gets in the way of
  the camera when zoomed in, and interiors mean rewriting the island and its walking grid.
- **A cutaway ship interior with rooms and walls.** Rejected: walls get in the way of the deck's
  walking grid, and the open deck under a canopy keeps the layout as built.
