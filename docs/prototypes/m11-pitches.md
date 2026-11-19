# M11 pitches

Status: picked by the owner on 2026-11-19 (DESIGN.md 5.2, M11's third step); the picks are below. Nothing here
is built into the game or the studio. Each puzzle's layer, once picked, is its own pull request by
the `puzzles` skill's "Changing a puzzle", with its design file, guide and pictures in step.

Each pitch below was written against the bar (`.claude/skills/puzzles/SKILL.md`, rule 26 above all)
and checked with the bot runner (`packages/bots`, ADR 0067) on a prototype of the layer built in the
engine. "Plays it" and "ignores it" are the same bot with the layer seen or unseen, so the gap is the
layer's own. A bait is a play that looks right and loses to plain good play. All numbers are bot
means at the runner's pace for the puzzle (in `packages/bots/README.md`), over the seeds stated.
Gaps under about 10 percent at 32 seeds can be noise (two bots that play alike differed by 230 on
Reactor); the closest ones were run at 64 or 128 seeds.

## The picks

| Puzzle | Decision | Build order |
|---|---|---|
| Cutting | The order, its bonus tuned between 40 and 60 | First, side by side with Racks and Deflectors |
| Racks | The manifest as pitched: two kinds in order, +300 | First |
| Deflectors | Locks for one volley, one mirror a beam | First |
| Overload | The draw, tuned down in its pull request: a narrower band and a lower multiplier until blind bots' free gain shrinks and the draw stays under half a good score (rule 14) | Second |
| Reactor | Core pressure, its limit between 12 and 14 | Second |
| Tug | Pairs, with the runner letting a puzzle name the plain bot the careless check compares against (a two-flick bot for Tug) | Second |
| Scanner | The mark at 4× (below); the lead was dropped after its second look | Second |

## At a glance

| Puzzle | Pick | Plays it vs ignores it | Its bait loses by | Free to bots that ignore it | Main risk |
|---|---|---|---|---|---|
| Cutting | **The order**: a plate size per slab, pure plates of it pay a bonus | +10 to +18% | 16 to 21% | 1 to 3% | The plate sizes are a guess |
| Racks | **The manifest**: two kinds shipped in order, back to back | +14% | 14% | none for plain play | Close in spirit to Salvage's orders |
| Deflectors | **Locks**: the last mirror each beam turned at locks for the next volley | rollout +22% over one move (was +1.4%) | 18% | none (−1 to −4%) | The foresight may be a bot's, not a person's |
| Overload | **The draw**: a band of chain sizes; a chain inside it scores triple | +26 to +34% | 42 to 48% | large: blind bots +50% | Partly the contracts trap; may be half a good score |
| Scanner | **The lead**: the first find on the opening ping's ring pays four times | +5.4% at 400, +9.4% at 500 | 12 to 16% | the splitter gets 61% of leads | Thin gap; 43% of a good score at 400 |
| Reactor | **Core pressure**: a gauge that fills while hot rods are held | +6 to +8% | 4.5% | none | Close to a tax |
| Tug | **Pairs**: two clamps lit at once; deliver one to set up the other | rollout +72% | 37% | some | Does not fix the failed ladder check |

Cutting, Racks and Deflectors have the cleanest evidence. Overload has the largest gap and the
largest free gain. Scanner, Reactor and Tug are the weakest and want a play test or one more try
before they are built. The plan named Overload and Racks as the likely first; on this evidence
Cutting belongs with them.

Each section ends with the layers that were tried and failed. They are kept because each is a
measured negative, mostly the contracts trap: a layer every bot gets without trying.

---

## Cutting: the order

**Where it stands.** The skill ladder is already clean (16 seeds: careless 238, greedy 1,185, one
cut ahead 1,975, rollout 2,107, best plan 2,941). But each slab is a closed puzzle with one right
answer: nothing asks a player to want anything but the most area squared, and there is no bait.

**The rule.** Each slab is dealt an order, a plate size from 2 by 2 to 3 by 4, either way round.
Every pure piece of exactly that size banks `orderBonus` more. Off: `orderBonus: 0`, which deals no
order; slabs and hashes stay as they are today.

**The skill.** The fourth skill, after seeing the rectangle, the order of cuts and the budget: is
the plate worth carving out of a bigger block? Area squared punishes it hard (a 3 by 3 is 81; a 3 by
2 plate and a 3 by 1 are 36 + 9 + the bonus). Sometimes the plate sits inside a block for free,
sometimes it costs the block. It meets the compound move head on, because a big block freed whole is
exactly what the order tempts you to break.

**The bait.** The order chaser: cut the plate out whatever it costs.

| Bot (32 seeds, 30 cuts in 120 s) | No orders | Orders 40 | Orders 60 | Orders 80 |
|---|---|---|---|---|
| greedy | 1,203 | 1,241 | 1,245 | 1,259 |
| best plan, plays it | 2,912 | 2,950 | 2,954 | 3,135 |
| best plan, blind to it | | 2,661 (−10%) | 2,414 (−18%) | 2,280 (−27%) |
| order chaser (the bait) | | 2,342 (−21%) | 2,481 (−16%) | 2,804 (−11%) |

The right size is 40 to 60; at 150 chasing is nearly right and the bait dies. The order changes a
constant per rectangle in the solver's table, so `bestCut` stays exact at the same cost.

**A second bait already in the rules.** A bot that gives a slab up once its next cut is worth under
about 90 points of round time beats the best plan by 4 to 6 percent: following the hint to the last
cut loses. It belongs in the tuning notes whichever layer is picked.

**Stages.**

| Stage | Round | On | Off |
|---|---|---|---|
| blocks | 60 s | Pure blocks, grades | Flaws, the tight budget, the streak, orders |
| flaws | 90 s | Flaws, the budget at 85, the streak | Orders |
| full | 120 s | Orders at 60 | |

**Tried and failed: spare cuts** (unused cuts carry to the next slab, `spareMax`). No bot that keeps
cuts beat the one that ignores them, at any cap. The budget already reaches 85 percent of an
unlimited torch.

**Not checked:** the order's share of a good score (rule 14), other plate sets.

---

## Racks: the manifest

**Where it stands.** The hint's fixed rules (1,383) nearly match the rollout bot (1,400) and sit 16
percent under the best planner (1,636): a simple rule plays most of the game (rule 5). Nothing
reaches Masterful. Holding a rack for a chain gains 1 percent, and there is no bait.

**The rule.** Over the row hangs a manifest: two different kinds in order, say cone then tank. Ship
the first, then the second on the very next action (one chain), and the manifest pays
`manifestPoints` (300) on top; a new one is drawn. A crate that lands to complete its rack counts.
Off: `manifestLength: 0`.

**The skill.** A fifth skill, above the chain: the chain with a named order. Build two racks of the
named kinds each one move from full, keep the crate's mark off them, and ship them in order back to
back while the crate's count runs. It makes holding pay, which the design file's open question asks
for; the planner's chains of three or more rose from 12 to 18 rounds in 32.

**The bait.** Chasing the manifest: a planner that values every other shipment at nothing ships 9.3
racks a round instead of 12.6, smashes twice as often, and loses 14 percent. A milder lean toward it
was about right, so the judgement is real. The eager caller, already in the rules, is the puzzle's
bait too.

| Bot (32 seeds, 70 actions in 120 s) | Off | Two kinds, +200 | Two kinds, +300 | One kind, +100 |
|---|---|---|---|---|
| hint rules (blind) | 1,383 | 1,373 | 1,377 | 1,875 |
| planner, plays it | 1,636 | 1,948 | **2,070** | 2,161 |
| planner, blind to it | 1,584 | 1,773 | 1,814 | 2,108 |
| manifest chaser (the bait) | 1,294 | 1,639 | 1,783 | |
| eager caller (the bait) | 1,406 | 1,448 | 1,492 | |

At +300 the planner fills 0.94 manifests a round to the blind planner's 0.41, and the manifest is 14
percent of its score. **The one-kind column is the contracts trap, measured:** the hint rules gain
490 without trying. Two kinds in order in one chain is what makes it built rather than found.

**Stages.**

| Stage | Round | On | Off |
|---|---|---|---|
| sort | 60 s | Sorting, the crate on a safe rack, the call | The deadline (`markRoom: true`), the chain, the manifest |
| mark | 90 s | The deadline: any rack may be marked, so smashes happen | The chain, the manifest |
| chain | 120 s | The chain | The manifest |
| full | 120 s | The manifest | |

**Tried, not built: the long rack** (one rack two cells taller, ships only when full). Not cheap
(height is read everywhere), and likely the trap: it is also the overflow every bot uses.

**Risks.** A person may find two kinds in order too much to read on a phone. At under one a round it
may feel like a treat rather than a plan (three kinds, or +400, are cheap to try).

---

## Deflectors: locks

**Where it stands.** A round is one choice made again and again: see the best route for this
volley, then fire. The engine's search answers it, so planning gains nothing (32 seeds: rollout
3,948, one move 3,893, +1.4 percent). Nothing done with one volley changes the next.

**The rule.** When a volley fires, the last mirror each beam turned at locks for the next volley: it
cannot be flipped, and the deal and the volley's best treat it as set. Off: `hotVolleys: 0`
(`hotTurns: 1` is how many mirrors at the end of each route lock).

**The skill.** A fifth skill, above the long way round: leave the grid open for the next volley. The
long route is still the compound move, but the route you fire now decides which mirror you lose next
time.

**The bait.** The best route every volley: under locks the one-move bot is 18 percent under rollout.

| Bot (32 seeds, 0.8 s a flip, 6 s a beam) | Off | Locks, 1 volley | Locks, 2 volleys |
|---|---|---|---|
| one move | 3,893 | 3,862 | 3,881 |
| rollout | 3,948 | **4,702** (+21.7%) | 4,836 |
| longest (the search's best, greedy) | 3,463 | 3,320 | 3,383 |
| joiner | 1,282 | 1,940 | 3,520 |

Bots that ignore locks gain nothing from them; only planning does. It is the first gap between
planning and one-move play the puzzle has shown.

**Stages.**

| Stage | Round | On | Off |
|---|---|---|---|
| route | 60 s | One beam, joining, firing early | The second beam, streak, perfect, locks |
| pairs | 90 s | Two beams, the streak | Perfect, locks |
| long | 120 s | Perfect: the long way round | Locks |
| full | 120 s | Locks | |

On `route` careless (258) barely trails the joiner (318); it may want the streak left on.

**Tried and failed.** Splices (two beams turning at one mirror pay extra): long routes share mirrors
by accident on a 6 by 6 grid, so every bot rose 20 percent and playing for them gained 2 to 5. Locking
every mirror a beam turned at shrank the search so far that the joiner beat the longest route. A
timed cool-down only taxed pace.

**Risks.** Rollout sees a random next volley; a person may not see which mirrors to keep free, so the
+22 percent may be a bot's foresight. The joiner gains 51 percent: keep locks to one volley.

**The design file's tuning notes are stale** against the engine (no `minBest`, `bouncePoints` or
`bounceCap`; the joiner scored 750 there and 1,282 now).

---

## Overload: the draw

**Where it stands.** The streak counts chains, not their length, so steady fours win: charging to
four (5,462) beats also charging to join (5,100). The named compound move loses money. Planning
gains nothing (one move 3,511, rollout 3,571), and the long chains are found, not built.

**The rule.** The board shows the ship's draw, a band of chain sizes ("8 to 10"). A chain whose
bursts land in the band meets the draw and scores triple, and the next draw is asked for. Off:
`drawSizes: []` (with `drawSpan` and `drawPercent`).

**The skill.** Counting a chain before the tap, then charging to grow it into the band: the join
with a ceiling. It adds the sense of what is not worth chasing.

**The bait.** Chasing the biggest chain: one more charge that turns a 9 into a 14 looks right (n × n
is bigger), overshoots the band and loses the triple.

| Bot (a tap every 1.5 s) | No draw (32) | 8 to 11, ×3 (32) | 8 to 10, ×3 (16) | 8 to 11, ×2 (16) |
|---|---|---|---|---|
| one move | 3,511 | 5,287 | 4,770 | 4,236 |
| rollout | 3,571 | 6,031 | 5,570 | 4,321 |
| fours (blind) | 5,462 | 8,282 | 7,646 | 6,611 |
| one charge ahead (the bait) | 5,100 | 6,098 | 5,346 | 5,154 |
| **draw joiner**, plays it | 4,633 | **10,454** | **10,236** | 7,388 |

The bot that plays the draw beats the best one that ignores it by 26 to 34 percent at ×3; the bait
loses 42 to 48 percent to it; rollout now beats one move by 14 to 17 percent.

**Stages.**

| Stage | Round | On | Off |
|---|---|---|---|
| bursts | 60 s | Reading chains, n × n, refunds | Streak, boosters, the draw |
| streak | 90 s | The streak, boosters | The draw |
| full | 120 s | The draw | |

**Tried and failed.** Surge (a long chain moves the streak a step per four bursts): careless gained
55 percent and every bot alike. The load (one marked capacitor pays double when burst): sprawling
lucky chains hit it, so blind bots gained 27 percent and the bot that sought it scored less.

**Risks.** Blind bots gain a lot without trying (fours +52 percent): chains of 8 to 11 happen by
luck, so the gap sits on a free gain, partly the contracts trap. Narrow the band before ×3, check
the draw's share of a good score (it may be near half), and play-test whether counting 9 against 12
bursts with no preview is fair on a phone. Thresholds must rise.

---

## Scanner: the lead

**Where it stands.** The only skill is information, and the splitter (pings the safe cell that
splits the possible placements most evenly) plays it perfectly by one simple rule (rule 5): 2,306
against the plain player's 689. Nothing asks the player what to chase; the only bait is guessing.

**The rule.** The contact the opening ping hears is the lead. A sector's first find pays four times
if it lies on the opening ping's ring. Off: `leadPercent: 100`.

**The skill.** Choosing a target over pure information: aim pings at the opening ring, and hold back
contacts already proven until the lead is locked (the splitter locks at once, to let the numbers
update for free). The compound move: pin the lead with the fewest pings, lock it first, then the
held contacts in a row.

**The bait.** Locking the likeliest cell on the opening ring at even odds (12 to 16 percent under).
With the lead off, a hunter that chases it loses 11.5 percent, so the chase has a real cost.

| Bot (64 seeds, 2.6 s a ping, 1.4 s a lock) | Off | 300 | 400 | 500 |
|---|---|---|---|---|
| plain player | 674 | 920 | 1,043 | 1,166 |
| splitter (blind to it) | 2,314 | 2,778 | 3,010 | 3,242 |
| lead hunter, plays it | 2,047 | 2,797 | 3,172 | 3,547 |
| lead gambler (the bait) | 1,644 | 2,317 | 2,654 | 2,990 |

**Stages.**

| Stage | Round | On | Off |
|---|---|---|---|
| rings | 60 s | Ping, lock, both penalties, three contacts | Par, savings, streak, growth, the lead |
| par | 90 s | Par, savings, the streak, growth to four | The lead |
| full | 120 s | The lead at 400 | |

On `rings` guessing wins (489 against 469) because there is no streak to lose.

**Tried and failed.** The run (finds in a row with no ping between pay more): the splitter gained 46
percent without trying. The read (a find the plain arguments do not prove pays extra): it paid for
guessing.

**Risks.** The splitter takes 61 percent of leads without trying, so the gap is thin at 300 and clear
only from 400; at 400 the lead is 43 percent of a good score, at 500 about half. A wider opening ring
(`openingMin: 4`) may cut the free share and is untried. It adds no secret: the server still holds
the contacts (rule 21), and a missed lead only goes unpaid (rule 8).

**The second look, and the lead dropped** (64 seeds, the bots' pace). A wider opening ring made it
worse: the opening tells the splitter more, so its free share of leads rose from 60 to 68 percent and
the hunter fell behind it (−6 percent with the opening at least 4 out, −10 at 5), and the splitter
gained 14 to 17 percent even with the lead off. A narrower ring (2 out, the lead at 250) was the only
setting with a gap (+12 percent, the lead 38 percent of the hunter's score, the gambler 19 percent
under), but it weakened the base puzzle and let guessing beat careful play (1,909 to 1,875 with the
lead off); a wrong guess at 100 only brought them level. Paying the lead only within a few pings cut
the free share and kept the gap at 2 to 4 percent. Every deal still needed no guess at every setting.
The owner dropped the lead; Scanner gets a new pitch (carrying saved pings into the next sector's par
is the untried idea).

**The new pitch, picked: the mark** (64 seeds, the bots' pace). One contact a sector is marked. A
ping whose number hears the marked contact is drawn lit, and every ping is lit again when a number
sounds again. Locking the mark as the sector's first find pays `markPercent` of a bounty. Off:
`markPercent: 100`. The mark is drawn from a side stream, so deals are the same with it on or off.
The skill is choosing what to chase and when to give it up: hold proven contacts, aim pings at the
lit rings, and drop the chase once it would cost the clean sector (never giving up scores 2,717 at
400; giving up two pings short of par, 2,961). The bait is locking the likeliest cell for the mark
at even odds.

| Bot (64 seeds) | Off | 300 | 400 | 500 |
|---|---|---|---|---|
| plain player | 665 | 769 | 821 | 873 |
| splitter (blind to it) | 2,328 | 2,546 | 2,655 | 2,764 |
| thrifty hunter (plays it) | 2,312 | 2,663 | **2,961** | 3,258 |
| mark gambler (the bait) | 2,316 | 1,800 | 2,061 | 2,322 |
| gambler | 2,189 | 2,387 | 2,487 | 2,586 |

At 400 the hunter leads the splitter by 11.5 percent (9.9 at 128 seeds), the bait loses 30, guessing
still loses to careful play by about 6, and the mark is 30 percent of a good score. The splitter takes
30 percent of marks without trying (the lead gave it 61) and still gains 14 percent: the risk. The
lit flag must read without colour on a phone. **The bank** (saved pings carry into the next par) was
measured and failed: a careful player has nothing to spend it on, so it was a tax of 1.5 to 8
percent.

---

## Reactor: core pressure

**Where it stands.** Planning already pays (128 seeds: one move 2,248, rollout 3,560, stacker
3,797). The shallow spot is the hoard: only the count of hot rods limits it, so holding three costs
nothing until a fourth. The first table's claim that a planning hoarder beats the stacker did not
reproduce at 128 seeds (3,604 against 3,797).

**The rule.** A gauge beside the lamps. Each swipe that ends with two or more hot rods in the core
adds one pressure for each past the first; a swipe that ends with one or none lets one off. At
`pressureLimit` the core scrams. Off: `pressureLimit: 0`.

**The skill.** Timing the hoard: the lamps cap how many rods you hold, the gauge charges for how long.
The salvo stays the compound move but must be assembled fast: cook the second and third rods
elsewhere and bring them in together, rather than park one and wait.

**The bait.** Parking one rod at the port and waiting for a triple: the planning hoarder is 4.5
percent under the gauge-reading stacker at limit 14, and the blind hoarder falls further.

| Bot (128 seeds, 110 swipes in 120 s) | Off | Limit 10 | Limit 14 |
|---|---|---|---|
| one move | 2,248 | 2,008 | 2,170 |
| rollout | 3,560 | 3,525 | 3,529 |
| stacker, blind to pressure | | 3,400 | 3,498 |
| gauge stacker, plays it | 3,840 | 3,581 | 3,754 |
| planning hoarder (the bait) | 3,604 | 3,245 | 3,587 |

Reading the gauge is worth 5 to 8 percent; seeing it only through a three-swipe lookahead is worth
nothing.

**Stages.**

| Stage | Round | On | Off |
|---|---|---|---|
| core | 60 s | Fusing, discharge, the lamps | Salvo, pipeline, pressure |
| pipeline | 90 s | The pipeline | Salvo, pressure |
| salvo | 120 s | The salvo | Pressure |
| full | 120 s | Pressure | |

**Tried and failed.** Deep ports (an inner port pays double): every bot gained 30 to 45 percent, and
the bot that chased it scored less than one that ignored it. Port drift (an unused port moves): it fed
the hoard, and careless play doubled.

**Risks.** Close to a tax: everyone scores a little less and the gap is modest, about the size of
Salvage's orders. A second meter beside the lamps may be one too many to track. Rollout does not move,
so part of the gain may be the gauge-reader's weights rather than the rule.

---

## Tug: pairs

**Where it stands.** Nothing scores until a delivery, so the only thing that counts is seeing a
route. Tug is the one puzzle that breaks the ladder check: careless 2 and one move 36 are both Green.
A bot two flicks ahead scores 369, still Green; the solver scores 4,594, far past Legendary (3,298).

**The rule.** Two clamps are lit at once, each for a different pod. When one is delivered, the
other's par is measured again from the bay it leaves, but it keeps the worth it lit at; a new clamp
lights. Off: `clamps: 1`.

**The skill.** A fourth skill: pick which clamp to take and let the bay bring the other closer. The
compound move is the handoff: deliver one so the pod left behind is the other clamp's stop, and a
par-four clamp costs one flick yet pays as a par four.

**The bait.** Finishing what you started: playing out the clamp you began and ignoring the other.

| Bot (32 seeds, 60 flicks in 120 s) | Off | Pairs |
|---|---|---|
| careless | 2 | 8 |
| one move | 36 | 73 |
| rollout | 765 | **1,316** (+72%) |
| par route, ignores the second clamp (the bait) | 4,594 | 3,031 |
| nearest first, sees both | 4,594 | 4,829 |
| pair planner, plans the handoff | 4,594 | 4,945 |

**Stages.**

| Stage | Round | On | Off |
|---|---|---|---|
| glide | 60 s | Par one and two clamps, grades | Streak, pairs, par three and four |
| stops | 90 s | Par three, the streak | Pairs, par four |
| pairs | 120 s | Two clamps, par to three | Par four |
| full | 120 s | Everything, par to four | |

**Tried and failed: snug delivery** (a delivery stopped by another pod pays more): par routes stop
on a pod often enough that every bot got it without trying (+2 percent for the bot that sought it).

**Risks.** **Pairs do not fix the ladder check** (careless 8, one move 73, both Green). Most of the
gain is seeing both clamps and taking the easier, a real but simple skill; planning the handoff adds
only 2.4 percent. Two clamps, two pars and two worths must fit the strip on a phone. In Tug no single
flick pays, so the one-move bot is not plain thinking play: the runner could let a game name its own
plain bot (a two-flick bot here), and the check could be read on the first stage. The thresholds look
far off at the top: Legendary could sit near 4,000, or wait for testers.

---

## For the runner, from the pitches

- **Seeds.** Gaps under about 10 percent at 32 seeds can be noise; run 64 or 128 before trusting one.
- **A game's plain bot.** Let a game name the bot the careless check compares against (Tug).
- **Round length.** `--set` lays config over a stage but cannot change its round length.

## The prototypes

Each pitch was checked on a working prototype of its layer, off by default, in the engine and the
bot file (and for some the wire schema and content). They were built on scratch copies and are not
in this branch; each puzzle's pull request rebuilds its layer properly, with its board, studio
controls, tests, guide and design file.
