# Scanner

Status: built. Prototype (ADR 0036), on the harness at `/scanner`. Untimed moves; a 120 second round.

## The puzzle

A fogged sector, six by six, hiding three contacts. Find them all and the next sector is dealt; a
sector gains a contact every two cleared, up to five (`startContacts`, `growEvery`, `maxContacts`).

A ping on a cell answers with one number: how many steps (up, down, left, right) the nearest hidden
contact is. The number says two things. Nothing hidden lies nearer, so every cell closer than the
number is empty, and the board shades it. And one contact lies exactly that far, somewhere on the
diamond-shaped ring of cells at that distance. When the shading leaves a ring one cell, the contact
is there.

A lock on a cell says "a contact is here". A right lock finds it for 40 (`contactPoints`).

Both verbs can go wrong, and either mistake costs 60 and the streak (`wrongPenalty`,
`spookPenalty`). A lock on empty space is a miss. A ping that lands on a contact spooks it: the
contact is given away for no bounty. So a ping belongs on a shaded cell and a lock on a proven one.
A lock on a shaded cell is refused, not punished.

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

## Luck and skill

- **Luck:** where the contacts are, and how much the opening ping gives away.
- **First skill:** reading one ring. Ping where it is shaded, watch the shading grow, and lock when a
  ring is down to one cell. This alone clears every sector, about one time in two within par.
- **Second skill:** crossing rings. Two rings that share one fog cell prove it without a third ping.
- **Third skill:** choosing the ping. A shaded cell near a lot of fog, or one that tells two
  candidates apart, saves the pings that the streak is built from. Cells that sit diagonally from
  each other are the same distance from half the sector: only a ping to one side splits them.
- Nothing is left to a guess, so nothing is won by one: a mistake is always the player's.

## Input

- A tap on fog or on a shaded cell pings or locks it, as the switch under the sector says. The
  switch is two halves the width of the sector: the live one is filled and carries a notch, each has
  its own glyph, and the lock half shows what a lock pays now (`scannerLockValue`).
- A long press (420 ms) always locks; brackets close on the cell while it is held.
- A tap on a pinged cell lights its ring: the diamond, and bright on it the cells where the contact
  it hears can still be (`scannerPingCandidates`). It is never a move.
- Keyboard: arrows or WASD move the cursor, space pings, enter or L locks, X flips the switch,
  escape puts a lit ring out.
- The strip over the sector counts pings left of par, the sector, and contacts still hidden.
- When a sector is cleared the board holds taps for about a second, until the next sector is on
  screen: a second tap aimed at the old sector must not land on the new one.
- Unrated and lab rounds pulse a safe move after six seconds idle (`scannerHint`): brackets where a
  lock is proven, a diamond on a shaded cell worth pinging.

## Engine

`packages/engine/src/scanner/`. Moves: `{ type: "ping", cell }`, `{ type: "lock", cell }` and
`{ type: "end" }`. A move's report says what a ping answered, whether the move found, missed or
spooked, which pings sounded again and what they say now, what it scored and cost, and the cleared
sector's sum when it cleared one. The board plays the report and ends on the engine's view.

What the board draws is `scannerViewString`: fog, shaded, a ping's number, found, spooked, missed.
It shows fog over every hidden contact, and `data-board` holds nothing else. Every argument the
engine makes for the board (`clearCells`, `pingCandidates`, `provenCells`, `hint`) is made from what
the player can see. `plainlySolvable` reads the hidden contacts and is for the dealer and the tests.

The contacts sit in the state, which the client holds: nothing here is hidden from a cheat. That is
accepted for a prototype (ADR 0036) and would need the server to answer pings before a Scanner
round counted for anything.

## Tuning notes

Set from bots, not people (ADR 0036). Scores are the mean of 24 rounds of 120 seconds unless said.
The bots: a sweeper that taps through the fog in reading order (0.4 s a tap); a random pinger; a
plain player that follows the idle hint and nothing else; a splitter that knows every placement the
numbers allow, locks only what holds in all of them and pings the shaded cell that splits them most
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
  2,110, and the splitter at 1.6 s a ping 3,780. The ladder runs 250, 500, 900, 1,500, 2,200, 3,200.

## Open questions for play

- Is a second of held taps at each new sector felt as a stall?
- Does the plain player's round (four sectors, half of them over par) feel like progress, or does
  par want to start looser and tighten?
- Would a person rather have the ring of the newest ping stay lit until the next move?
- Is 60 for a slip of the finger on fog too much on a phone?
