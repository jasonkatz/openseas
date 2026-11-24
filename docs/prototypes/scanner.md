# Scanner

Status: built, and deepened in M11 with the mark and a ladder of three stages (ADR 0066).
Prototype (ADR 0036), in the studio at `/scanner`. Untimed moves; a 120 second round.

## The puzzle

A fogged sector, six by six, hiding three contacts. Find them all and the next sector is dealt; a
sector gains a contact every two cleared, up to five (`startContacts`, `growEvery`, `maxContacts`).

A ping on a cell answers with one number: how many steps (up, down, left, right) the nearest hidden
contact is. The number says two things. Nothing hidden lies nearer, so every cell closer than the
number is empty, and the fog lifts from it. And one contact lies exactly that far, somewhere on the
diamond-shaped ring of cells at that distance. When the clear cells leave a ring one cell, the
contact is there.

A lock on a cell says "a contact is here". A right lock finds it for 40 (`contactPoints`).

Both verbs can go wrong, and either mistake costs 60 and the streak (`wrongPenalty`,
`spookPenalty`). A lock on empty space is a miss. A ping that lands on a contact spooks it: the
contact is given away for no bounty. So a ping belongs on a clear cell and a lock on a proven one.
A lock on a clear cell is refused, not punished.

The numbers are live. When a contact is found or spooked, every ping that was hearing it sounds
again and shows how far the nearest contact still hidden is. A number on the board is always true of
what is left to find.

Each sector opens with one ping already made, on empty space at least three steps from every
contact (`openingMin`). And a sector is only dealt if it can be cleared from that ping with no
guess: the engine plays it through with the two plainest arguments (a ring with one cell left; as
many fog cells as contacts) and deals again when they get stuck, up to twelve deals (`dealTries`).

A sector allows two pings a contact (`parBase`, `parPerContact`); each ping past that costs 10
(`overPenalty`). A sector cleared within par with no mistake is clean: every ping left over pays 20
(`savePoints`), and clean sectors in a row build a streak that multiplies bounties and savings: 100,
120, 140, 160, 180, then 200 percent (`streakPercent`). A sector that is not clean ends the streak.
The score never goes below zero.

One contact a sector is the **mark** (`markPercent`). Which one is never shown. A ping whose number
hears it, the mark being one of the contacts nearest it, is **lit**: it carries a solid tab in its
cell's top corner. When the numbers sound again every ping is lit afresh, so a tab is always true of
what is left, like the number under it. Locked as the sector's first find, with nothing found or
spooked before it, the mark pays four bounties, the streak included (`markPercent: 400`). Found
later it pays one bounty like any other contact. Off: `markPercent: 100`, which marks nothing,
lights nothing and draws nothing. The mark is drawn from a stream of its own, one draw a sector, so
a seed deals the same sectors with the mark on or off; only the mark and the tabs differ.

## Luck and skill

- **Luck:** where the contacts are, how much the opening ping gives away, and which contact is the
  mark: one in three, four or five, and the tabs tell more than the numbers about some than others.
- **First skill:** reading one ring. Ping where it is clear, watch the fog lift, and lock when a
  ring is down to one cell. This alone clears every sector, about one time in two within par.
- **Second skill:** crossing rings. Two rings that share one fog cell prove it without a third ping.
- **Third skill:** choosing the ping. A clear cell near a lot of fog, or one that tells two
  candidates apart, saves the pings that the streak is built from. Cells that sit diagonally from
  each other are the same distance from half the sector: only a ping to one side splits them.
- **Fourth skill:** the mark. Hold every contact the rings prove (it will wait), aim the pings at
  the tabbed rings, which the mark lies on, and away from the untabbed ones, which it does not, and
  lock the mark first, then the held contacts one after another.
- **Fifth skill:** knowing when to give the chase up. Pinning the mark costs pings, and a ping past
  par costs the clean sector and the streak, which are worth more than the mark. The thrifty hunter
  gives it up once a ping would leave fewer than two of par, and beats the hunter that never does.
- Nothing is left to a guess, so nothing is won by one: a mistake is always the player's. The
  mark does not change that: the deal is the same, and a mark missed is only a mark unpaid.

The compound move is the mark first: pin it with the fewest pings while every proven contact waits,
lock it, then the held contacts in a row, inside par.

## The ladder

A new player climbs three stages (ADR 0066). Only the whole puzzle counts. Every stage is the whole
puzzle with layers switched off in `stages` in the content file; the names and one-line cards are
`scanner.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Rings (`rings`) | 60s | Ping, lock, both penalties, three contacts | Par and savings (`savePoints: 0`, `overPenalty: 0`), the streak (`streakPercent: [100]`), growth (`maxContacts: 3`), the mark (`markPercent: 100`) |
| Par (`par`) | 90s | Par, savings, the streak, growth to five | The mark |
| Full scanner (`full`) | 120s | The mark | |

`par` is the puzzle as it was before M11, in a shorter round. The thresholds of all three are first
guesses from bots (see the tuning notes), and want setting by hand in the studio.

**Rings fails the ladder's own check** (rule 17): on it, guessing beats careful play. With no
streak to break and no par to keep, a lock at six chances in ten costs only time when it misses, and
the gambler outscores the splitter (504 against 471, 64 seeds). Leaving the streak on there does not
mend it (614 against 608), nor does leaving par, savings and the streak all on in a minute (887
against 822). In one short round of small sectors there is too little at stake for a guess to cost
what it saves. The stage is kept as pitched, for the owner to decide: it teaches reading a ring,
and a guess still costs a penalty a player can see.

## Input and feedback

- A tap on fog or on a clear cell pings or locks it, as the switch under the sector says. The
  switch is two halves the width of the sector, each with its own glyph, and the lock half shows
  what a lock pays now (`scannerLockValue`).
- A long press (420 ms) always locks; brackets close on the cell while it is held.
- A tap on a pinged cell lights its ring: the diamond, and marked on it the cells where the contact
  it hears can still be (`scannerPingCandidates`). It is never a move. (A ring lit by a tap is the
  player's pick; a ping lit by the mark carries a tab. The words keep them apart: the guide and the
  page call the second a tab.)
- Keyboard: arrows or WASD move the cursor, space pings, enter or L locks, X flips the switch,
  escape puts a lit ring out.
- The strip over the sector counts pings left of par, the sector, and contacts still hidden.
- When a sector is cleared the board holds taps for about a second, until the next sector is on
  screen: a second tap aimed at the old sector must not land on the new one.
- Unrated and lab rounds pulse a safe move after six seconds idle (`scannerHint`): brackets where a
  lock is proven, a diamond on a clear cell worth pinging.

The board is restyled to the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces
in code (`boards/src/scanner/pieces.ts`), loads no atlas and has no marks setting.

- **Fog** is a flat plate in `raised`, one a cell. The plates are the grid: there are no lines
  between them.
- **A clear cell** is the bare ground with a small dot, since an empty cell here matters: it is
  where a ping is safe.
- **A ping** is its number, mono and bold in cream, on bare ground. Every number is one colour:
  the digit is the signal.
- **A found contact** is a dot held in four brackets, in cream. **A spooked contact** is a disc
  struck through and **a miss** is a cross, both in danger. So the six things a cell can show are
  a plate, a dot, a digit, a bracketed dot, a struck disc and a cross, and each is told from the
  others with the colour taken away.
- **The board.** Bare ground under the strip, the sector and the switch, with one hairline round
  it. No frame and no grid.
- **The strip** over the sector is mono: pings left of par, the sector, contacts hidden. Pings past
  par are counted in danger.
- **The switch.** The live half is amber with ground text and a notch that points at the sector:
  it is the player's choice. The other half is a raised button with cream text. The ping half
  carries a hollow diamond and the lock half a bracketed dot.
- **A ping going out** is one plain diamond that grows from the cell to its distance, at a pace set
  by how far it goes (the reach is the rule), and fades where it stops. It is amber for the
  player's own ping and cream for the one a sector opens on. The number grows onto its cell at
  once, and each fog plate the ping proves empty shrinks to nothing as the diamond passes it.
- **A lock** being held closes amber brackets on the cell. A find grows onto the cell and its
  bounty rises in cream. A spook and a miss are called out in danger with their cost. Nothing
  shakes or flashes.
- **A number that sounds again** is set anew and grows back onto its cell, and the fog its new
  number proves empty lifts.
- **A lit ring** is the player's pick: an amber ring round the ping and its diamond in amber. Each
  fog plate on the diamond where the contact can be carries a cream pip, and the dot of each clear
  cell on it is lit. The keyboard's cell has the same amber ring.
- **A hint** is cream, never amber: bare brackets or a hollow diamond that fades in and out.
- **A cleared sector** is called out, and the pings it saved are paid in cream. The marks and the
  numbers shrink away, a fog plate grows back on every cell, and the next sector opens on its ping.
- **A lit ping** carries a tab: a small solid triangle in its cell's top corner, clear of the
  number (`boards/data/pieces/scanner.json`, `tab`). It is a shape of its own, so a lit ping is told
  from an unlit one with the colour taken away. The tab is cream while the mark can still be paid
  and `dim` once it cannot (another contact found or spooked first); the HUD says the same in words.
  A new ping's tab lands with its number, and a ping that sounds again takes its tab with its new
  number. When the mark is found the tabs go.
- **The mark found first** is called out ("Mark found", in cream), its bounty rises a size larger,
  and it plays the rising cue (`rise`, the one Salvage's order and Racks' manifest play) in place of
  the find's. It can never fall on a clean sector's beat: the mark is paid only as a sector's first
  find, and a sector whose first find is also its last had its other contacts spooked.
- **The HUD** beside the board says what the mark pays now, or that it is gone this sector
  (`scannerMarkValue`), and the result card counts the marks found first.
- **The beat**, one amber pulse of the whole board, is kept for one thing: a clean sector. It is
  stronger the longer the streak. A sector cleared that is not clean is said quietly, in dim.

## Engine

`packages/engine/src/scanner/`. Moves: `{ type: "ping", cell }`, `{ type: "lock", cell }` and
`{ type: "end" }`. A move's report says what a ping answered, whether the move found, missed or
spooked, which pings sounded again and what they say now, what it scored and cost, whether it paid
the mark and what the mark added (`markPaid`, `markPoints`), and the cleared sector's sum (its mark
included) when it cleared one. The board plays the report and ends on the engine's view.

The mark is `mark` in the state, with its own stream (`markRng`), seeded from the round's seed apart
from the deal's, and drawn from once a sector after the deal. Each ping holds `lit`, set by the
engine when it is made and whenever its number is worked out again. `scannerMarkOpen`,
`scannerMarkValue` and `scannerLitPings` are what the board and the bots read; the canvas publishes
the lit pings as `data-lit`. With the mark off the state hashes as it did before the mark, which a
test pins with hashes taken from the engine before it.

What the board draws is `scannerViewString`: fog, clear, a ping's number, found, spooked, missed.
It shows fog over every hidden contact, and `data-board` holds nothing else. Every argument the
engine makes for the board (`clearCells`, `pingCandidates`, `provenCells`, `hint`) is made from what
the player can see. `plainlySolvable` reads the hidden contacts and is for the dealer and the tests.

The contacts and the mark sit in the state, which the client holds: nothing here is hidden from a cheat. That is
accepted for a prototype (ADR 0036) and would need the server to answer pings before a Scanner
round counted for anything.

## Tuning notes

Set from bots, not people (ADR 0036). Scores are the mean of 24 rounds of 120 seconds unless said.
The bots: a sweeper that taps through the fog in reading order (0.4 s a tap); a random pinger; a
plain player that follows the idle hint and nothing else; a splitter that knows every placement the
numbers allow, locks only what holds in all of them and pings the clear cell that splits them most
evenly; a gambler that locks at six chances in ten.

- **A ping on a contact costs; it does not find.** The brief asked. Under its rules (a ping that
  lands on a contact finds it, no opening ping, par three a contact; 16 rounds) the sweeper scored 15,400 and
  the random pinger 3,800 against 2,200 for the splitter pinging anywhere: with contacts in one cell
  of nine, tapping the fog finds them faster than thinking does. So a ping on a contact is a
  mistake, and the sector opens on a ping to reason from.
- **Live numbers, not frozen ones.** With frozen numbers a found contact goes on answering for the
  pings near it, and what is behind it cannot be heard. Perfect logic then had to step into the fog
  in 30, 68 and 93 percent of sectors of three, four and five contacts. Giving each found contact an
  echo of its own cut that to 7, 13 and 47, still too many, and the plain arguments cleared only 96,
  81 and 57 percent of deals. With live numbers and no echo they clear 99, 98 and 92 percent, and a
  number means one thing all sector long. The echo then added one or two points and was dropped.
  There is no "explained" ping to dim any more: a ping that would have been explained sounds again.
- **Deal again until no guess is needed.** The few deals left over are thrown back, so both
  penalties can be whole: any spook or miss was avoidable. Twelve tries leave nothing to chance at
  five contacts. The lab preset "First deal stands" turns it off.
- **Only a clean sector is paid for pings left.** Paid always, the sweeper scored 2,200 (12 rounds,
  penalties at 50): a contact
  spooked early ends the sector early, and looked like pings saved. Paid for clean sectors only, it
  scores 340.
- **Penalties at 60, one and a half bounties.** The gambler scores 1,590 against the splitter's
  2,110 at the same pace, though its best round (3,000) beats the splitter's best (2,280). A random
  pinger that still spots every proven cell scores 590 at a pace a person could keep, about what the
  plain player does (620), and 1,020 if it never has to look.
- **Par two a contact.** The splitter spends 3.9, 4.9 and 5.4 pings on sectors of three, four and
  five; the plain player 7.0 and 8.7 on three and four, clean about half the time. Par of three plus
  one a contact moved the scores by a tenth and is harder to say.
- **Three to five contacts.** At 2.6 s a ping and 1.4 s a lock the splitter takes 14, 18 and 21
  seconds a sector and clears six in a round; the plain player takes 22 to 28. Starting at four
  takes 18 to 24 and clears five.
- **Thresholds.** A slow plain player (4 s a ping) scores 370, the plain player 620, the splitter
  2,110, and the splitter at 1.6 s a ping 3,780. The ladder ran 250, 500, 900, 1,500, 2,200, 3,200, until the mark moved it (below).

### M11: the mark and the ladder

Set from the bot runner (`packages/bots`, ADR 0067; `pnpm --filter @openseas/bots ladder scanner`),
64 seeds a cell (`ladder-0` to `ladder-63`), a person's pace modelled as 2.6 s a ping and 1.4 s a
lock. Each cell is the mean score and the tier it reads as against that stage's thresholds. The bots
decide only from what the board shows: the numbers, the tabs, what is known. Three are new: the mark
hunter (holds proven contacts, pings the safe cell that best splits where the mark can be, and locks
it once proven), the thrifty hunter (the same, but gives the mark up once a ping would leave fewer
than two of par) and the mark gambler (the hunter, locking the likeliest cell for the mark at even
odds: the bait).

| Bot | Rings (60 s) | Par (90 s) | Full (120 s) |
|---|---|---|---|
| careless | 24 Green | 11 Green | 16 Green |
| plain player | 263 Steady | 457 Steady | 850 Steady |
| sweeper | 0 Green | 0 Green | 0 Green |
| random pinger | 198 Green | 345 Steady | 562 Green |
| splitter | 471 Masterful | 1,512 Masterful | 2,622 Sharp |
| gambler | 504 Masterful | 1,455 Masterful | 2,268 Sharp |
| mark hunter | 471 Masterful | 1,540 Masterful | 2,699 Masterful |
| thrifty hunter | 466 Masterful | 1,520 Masterful | 2,811 Masterful |
| mark gambler | 469 Masterful | 1,523 Masterful | 2,160 Sharp |
| *Steady from* | *200* | *340* | *650* |
| *Sharp from* | *335* | *799* | *1,474* |
| *Masterful from* | *450* | *1,449* | *2,648* |
| *Legendary from* | *750* | *2,424* | *4,522* |

The runner's checks all met: careless play lands a tier below the plain player on every stage, the
gambler loses to the splitter on the whole puzzle by 13.5 percent, and the mark gambler to the
thrifty hunter by 23.2. With the mark off the mark bots play as the splitter, so on `rings` and
`par` they differ from it only by their random picks.

- **The layer pays for skill.** On the whole puzzle the thrifty hunter scores 2,811 against the
  splitter's 2,622, which is blind to the mark: 7.2 percent, and 9.3 at 128 seeds (2,900 against 2,653; the hunter 2,776, the mark gambler 2,255). It locks the mark first in
  0.83 sectors of every one it clears; the splitter, which never aims at it, in 0.29.
- **Giving up pays.** The mark hunter that never gives the chase up scores 2,699, 4 percent under the
  thrifty hunter: it finds more marks (1.03 a sector cleared, the last sector's included) but clears
  fewer sectors (5.45 a round to 5.72) and fewer of them clean.
- **The bait loses.** The mark gambler takes as many marks as the hunter but misses 1.5 locks a
  round, and each miss costs the clean sector and the streak: 2,160, 23 percent under. The old bait,
  the gambler, still loses to the splitter by 13.5 percent.
- **Rule 14: the mark is about 30 percent of a good score** (the thrifty hunter's mark extra, of its score).
- **Free to bots that ignore it.** With the mark off the splitter scores 2,314 and the plain player
  674 (64 seeds, 120 s); with it on, 2,622 and 850. The splitter gains 13 percent without trying,
  close to the pitch's 14, and the plain player 26: its first lock of a sector is the mark one time
  in three. That is the layer's risk, as the pitch said: luck pays a share of it. The gap to a
  player who plays it (7 to 10 percent) is smaller than the gift.
- **Careful play beats guessing** on `par` (splitter 1,512 against the gambler's 1,455) and on the
  whole puzzle, by score. On `par` the gambler still reads Masterful, a tier no lower than the
  splitter's, by 5 points. On `rings` guessing wins (see The ladder): broken, and the owner's call.
- **The thresholds.** The old ones (250, 500, 900, 1,500, 2,200 and 3,200 over 120 s) were set from
  the plain player and the splitter. Read against them, the two lower sat at 0.37 and 0.74 of the
  plain player's score, the two upper at 0.95 and 1.38 of the best careful bot's, and the middle two
  at 0.72 and 1.2 of the two scores' geometric mean. Each stage's thresholds are those ratios on its
  own two scores, rounded: `rings` 100, 200, 250, 420, 450, 650 (the plain player 263, the splitter
  471); `par` 170, 340, 600, 1,000, 1,450, 2,100 (457 and 1,512); the whole puzzle 300, 650, 1,100,
  1,850, 2,650, 3,900 (850, and the thrifty hunter's 2,811). The whole puzzle's moved up by about a
  fifth, so the play each tier names stays the same: Masterful still wants the best careful play,
  now with the mark. They are first guesses from bots, for the owner to set by hand.

## Open questions for play

- Can a person read the tabs on a phone, at a glance, beside the numbers? The tab is a sixth of a
  cell. Lit and unlit pings, cream and dim tabs, and the lit ring a tap draws are three things at
  once on a small board.
- The splitter gains 13 percent from the mark without trying, and the plain player 26: is a fourth
  of the mark's pay luck too much? A narrower mark (paid only once two rings are tabbed, or only
  within par) may cut the free share; it is untried.
- `rings` lets guessing beat careful play. Is that acceptable for a first minute that teaches the
  ring, or does it want its own fix (a stage the owner allows a rule of its own, or no `rings`)?

- Is a second of held taps at each new sector felt as a stall?
- Does the plain player's round (four sectors, half of them over par) feel like progress, or does
  par want to start looser and tighten?
- Would a person rather have the ring of the newest ping stay lit until the next move?
- Is 60 for a slip of the finger on fog too much on a phone?
