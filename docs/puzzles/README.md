# Puzzle specs

One file per puzzle. `docs/DESIGN.md` section 3.3 keeps a short summary of each puzzle and links
here; the spec holds the detail. When code and a spec disagree, fix one of them in the same PR,
the same rule as the design doc.

| Puzzle | Spec | Status |
|---|---|---|
| Bilging | [bilging.md](./bilging.md) | Shipped (M1). The reference spec: match its rigor. |
| Sailing | [sailing.md](./sailing.md) | Spec draft; rules to verify |
| Carpentry | [carpentry.md](./carpentry.md) | Spec draft; rules to verify |
| Gunnery | [gunnery.md](./gunnery.md) | Spec draft; rules to verify, redesign candidate |
| Navigation | [navigation.md](./navigation.md) | Spec draft; rules to verify |
| Sea Battle | [sea-battle.md](./sea-battle.md) | Spec draft |
| Swordfighting | [swordfighting.md](./swordfighting.md) | Spec draft; rules to verify |

Every puzzle keeps its own identity: its own board, motifs, sounds and the feeling it is going for.
What they share is the bar. The standard below is what Bilging had to learn across PRs #3, #9 and
#10, written down so the next puzzle starts there instead of rediscovering it.

## What Bilging taught us

Each lesson names the change that taught it.

1. **Pin the rules in writing before the engine, and check them against the original.** The first
   Bilging build had pieces falling instead of rising and a barnacle that climbed on its own. Both
   were wrong, and fixing them took a follow-up rules PR (`8dd975c`). Every spec now has a
   "Rules to verify" checklist that the owner, a regular of the original, signs off before the
   engine PR opens. Each item names our current belief and how sure we are.
2. **Every pressure needs a floor, a ceiling and a no-banking rule.** Bilging water first drained
   without limit, so a strong early burst could bank points against later rises. The fix was a
   floor of 3 rows, with pumping at the floor wasted (`6d781f3`). Every resource a puzzle tracks
   (water, damage, loads, tokens, garbage) states its units, its clamps, and why it cannot be
   banked or stalled. Use whole-number units so rises and drains are exact, and cover the clamps
   with a model-based property test.
3. **The practice page needs a pressure of its own until the ship exists.** Bilging's water rises
   with moves on the practice page, as a pure function of the move log; from M3 the ship injects
   water events into the log instead. Every duty spec names both its practice-page pressure and
   its ship coupling, and keeps the first replaceable by the second without touching scoring.
4. **The move report must carry everything the renderer shows.** Cascades only read as cascades
   once the engine reported each step's cleared ids and settled board (`478567a`). The renderer
   never re-derives a rule. A property test checks that the reported steps end at the final state.
5. **Animation never blocks input, except when blocking is the rule.** A move plays as a timeline;
   a new move fast-forwards it. The one exception, Bilging's slow underwater swap, is a cost the
   original also had. It lives in content (`underwaterSwapMs`), is client timing only, and no
   score depends on it. Every spec lists its client-only timing costs explicitly, or says there are
   none.
6. **What is drawn must be what the engine holds.** Piece ids restart in every game, and the
   renderer reused views across games, so a new round drew the previous board while the engine
   played a different one (`28c5814`). Every board puzzle writes the board it draws to the canvas
   (`data-view`) once it settles, and the smoke test compares it with the engine (`data-board`)
   after start and after moves.
7. **Measure the renderer on a slow phone before review.** A juicier board ran four times slower
   on software GL and timed out the phone smoke test in CI (`ffa168c`). The budget is p50 frame
   time on an emulated Pixel 7 under SwiftShader no worse than the previous `main`. Known traps:
   per-piece additive sprites (each one breaks the batch), stencil masks, and redrawing static
   layers every frame. Bake tiles and static art to textures once per layout.
8. **Readability is designed in, not added.** Tiles are colored squares, each kind with its own
   surface texture and an optional mark, all three unique and validated in content (`texture`,
   `mark`, `color`). Specials are dark tiles with an icon and a label. Tile art is painted once and
   shared by the board and the legend, so they can never disagree (#10).
9. **Phones first.** On phones the top bar is the whole HUD and the board takes every other
   pixel; secondary readouts open in a panel over the board. Desktop gets a sidebar. Check at
   iPhone SE, iPhone 14 and Pixel 7 sizes plus 1280×900.
10. **Feedback is a checklist, not a vibe.** Satisfaction came from specific beats: every step of a
    chain visible; callouts for multi-clears, chains and streak milestones; feedback both ways on
    the pressure plus a danger threshold; a quieter response to a move that does nothing; a little
    ambient life on the board; sound fired by on-screen events rather than state changes, so it
    lines up with what is seen; low-time ticks. All of it respects reduced motion (#9, #10).
11. **Help is for practice only.** Bilging's idle hint runs in unrated practice and never in a
    rated round. Preview affordances that the original also had (match preview on hover) are fine
    everywhere.
12. **The page shell is shared.** Each practice page ships with a preview board behind the start
    card, rated and unrated starts, offline unrated play, a result card with stats, a local personal
    best (display only), mute and the marks setting. A new puzzle reuses the shell instead of
    rebuilding it.
13. **Names and differences are recorded as they happen.** Anything the original coined gets an
    original name (ADR 0001). Each deliberate divergence goes into `DESIGN.md` section 6 in the
    same PR.

## The spec template

Every puzzle spec has these sections, in this order. "None" is an answer; a missing section is
not.

1. **Identity.** One paragraph: what playing it should feel like, and the motifs (look, sound,
   words) that make it unlike the other puzzles.
2. **Faithful core.** The original's rules as we intend to reproduce them.
3. **Rules to verify.** A checklist for the owner to confirm against the original before the
   engine PR. Each item: the question, our current belief, and confidence (high, medium, low).
4. **Board, pieces and specials.** Dimensions, coordinates (which way is up), every piece kind and
   every special with its exact behavior, and original names for anything coined.
5. **Input.** Touch, mouse and keyboard, and what each gesture means. Preview affordances.
6. **Scoring.** The formula, including multipliers, as integers.
7. **Pressure and output.** Practice-page pressure, ship output from M3, units, clamps, and the
   no-banking argument.
8. **Time.** Whether the puzzle is turn-based or has real-time elements (gravity, a clock per
   piece), and how time enters the move log so the engine stays pure.
9. **Client-only timing costs.** Each one with its content key, or "None".
10. **Moves and reports.** The move types in the log, and what a move report carries so the
    renderer can replay it step by step.
11. **Exploits.** Banking, stalling, degenerate loops, and what closes each.
12. **Feedback plan.** The beats from lesson 10, in this puzzle's own motifs.
13. **Layout.** Phone and desktop, what is in the top bar and what is in the panel.
14. **Content.** Every tunable, with its starting value, in `content/data/puzzles/<name>.json`.
15. **Tests.** Determinism properties, invariants, model-based tests for every pressure, report
    agreement, and the view-equals-engine smoke check.
16. **Open questions.** Anything not yet decided, with a recommended answer.

## Gates

A puzzle's work goes in this order, one PR each unless a step is trivially small:

1. **Spec PR.** The owner signs off the spec and the "Rules to verify" list.
2. **Engine PR.** Reducer, report, property-based determinism tests, the pressure model tests,
   and a purity lint pass. No renderer yet.
3. **Practice page PR.** Server wiring, renderer, page, smoke test with the view check, perf
   measured against `main`.
4. **Feel PR.** The feedback plan in full, textures, sounds, then a tester session.

The next puzzle starts after the tester session's retro (`DESIGN.md` 5.2).
