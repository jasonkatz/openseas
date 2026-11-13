# Swordfighting

Status: in the game. Built in M5, ADR 0022. On the harness at `/swordfight`.

## The puzzle

Puyo-style falling colored pairs on each pirate's board. Groups clear; cleared
groups send breaker blocks to opponents' boards. Team mode distributes each side's attacks. QoL:
incoming-attack preview, swipe controls. Ships after the duty puzzles; the first playable pillage
resolves boarding with a stub.

## Role

The boarding fight, dealt to every pirate aboard when a space battle ends in a boarding (ADR 0022). The side left standing takes the plunder, and each pirate's attack a minute against `parRatePerMinute` weighs their share (ADR 0030). It is rated by attack a minute with every win above every loss, scaled by the raider's tier.

## Luck and skill

- **Luck:** the stream of pairs, and the color scrap ripens into. Every board in a fight is dealt the same stream, so nobody is luckier than their crewmates.
- **First skill:** dropping fast, keeping each color together, and keeping the entry clear.
- **Second skill:** building slabs and feeding them to breakers, instead of breaking loose blocks.
- **Third skill:** planning with the next pair, breaking in chains, and using the scrap that is sent.
- **Fourth skill:** holding a break back to cancel an attack, and keeping the attack a minute high to the end.

## Rules and scoring

Every pirate in a fight has a 6 wide by 14 tall board. Pairs of blocks
in four colors (crimson, gold, cobalt, lime, each with its own surface and optional mark) slide in
from above the middle column, vertical; the player steers, turns (a turn that does not fit kicks
sideways, lifts a row, or, boxed into one column, turns twice so the halves swap ends) and hurries
them, and the move the
engine logs is the column and rotation the pair came to rest in, with the tick it happened at
(ADR 0015); the engine drops each half to the top of its column, so a sideways pair whose columns
differ lands at two heights. Blocks of one color that make a two-by-two fuse into a slab, and a
slab grows by a full strip along any side, loose blocks or a slab of the same span, so slabs can
hang over a hole. A breaker is a block of a color with a blade across it, dealt `breakerPermille`
of the time; when it comes to rest touching its color, everything of that color joined to it
shatters, slabs and all, and a breaker that touches nothing of its color waits where it lands
until its color falls against it. Each step of the cascade multiplies by its chain number, and
several breakers firing in one step multiply by their count, as in Cooling. A block scores
`cellPoints`; a slab of n blocks scores `cellPoints * n + slabBonus * n(n-1)/2`, so a big slab is
worth far more than its blocks. Points become scrap at `attackPoints` a block (the remainder
carries over); scrap first cancels scrap waiting to land on the sender's own board (`offset`,
which the lab can turn off), and the rest goes to the opposing board with the least on it. It
waits there, shown above the board as a count, and lands at that board's next drop or after
`landAfterTicks`, whichever comes first, at most `incomingCapRows` rows at a time, in the columns
of the sender's blade (content: each a list of columns taken in turn, every one weighted toward the
edges and away from the middle: the plasma cutlass the least, the vibro-dirk the most). Scrap is grey dead metal and unbreakable; each
block is dealt the color it will turn as it lands, and after `ripenMoves` of the board's drops it
turns into a block of that color (usually one seen around where it lands: the block under it counts
three times and each neighbour in its row once, `scrapMatchPermille` of the time in content, any
color otherwise, so an attack mostly turns into something the defender can clear), which fuses and shatters like any other. It carries no number:
it lands as solid scrap, and with one drop left (the second of two, in content) the scrap takes
on its color, so a player reads what is coming from the block itself. An upright pair whose column has one
free cell left rests its lower half there and the upper half falls away over the top. A board whose
entry (the top cell of the column pairs come in down) is covered is out; a side with no board
standing has lost. The score is the player's attack a minute: every point their board broke,
whether its scrap cancelled what was coming or went over, over the fight to its end (a board that
goes out early keeps its clock running), counted as at least `minRateSeconds`, and scaled by
`scorePercent` (the tier's, aboard). A win adds the band `winPoints` and any other end is kept
under it, so every win outranks every loss and the rate ranks fights within each. The board
shows attack a minute and blocks broken; a fight's result leads with won or lost. A pair may not come to rest sooner than `dropTicks` after it appeared; the fall
itself is client timing (`fallTicks` a row, `softDropMs` while hurried, a short lock on resting)
and never reaches the score. AI pirates (raiders in practice, allies in the lab's team fights)
play inside the reducer: each drops every `thinkTicks`, choosing from every drop it could make,
played out with the same rules, by what it broke, the slabs it left, blocks kept together and how
high it stands, taking the best `skill` percent of the time and one of the next best otherwise,
every roll from the fight's PRNG, so a practice fight replays from one log. Aboard a ship the
fight is a melee: each pirate's board is its own fight with the raider crew outside it, attacks
leave as events the server routes and arrive as `incoming` moves the server vouches for, the
raider crew's boards run on the server from the tier's `swordsmen`, and everyone sees every board.

## Input and feedback

The pair's landing shows as outlines (bold for a breaker), slabs are darker than loose
blocks with a heavy light border, and fuse with a flash and a callout for big ones, breaks burst
and tally, chains and big shatters call out, scrap flies to the board it is sent to, waits as a
flashing count above the board, and rains in from above, ripening flashes, the
entry is outlined, and the
other boards sit beside the player's as small live boards with their names, waiting scrap and a
cross when they are out. It sounds as it shows: a pair landing, a clash for a break and a heavier one
for a chain or a big shatter (a chain climbs in pitch), a swing as scrap is sent, a thud as it lands,
and the board going out, winning or losing (ADR 0041). Touch drags to steer, swipes down or up to turn and presses and holds (60 ms) to hurry the pair in hand; a mouse
clicks to turn and holds a downward drag to hurry;
the keyboard steers with the arrows, turns with up, down, X and Z and hurries with space. Up, X and a swipe up turn the pair
counter-clockwise; down, Z, a swipe down and a click turn it clockwise. The half at the bottom as the pair enters is the pivot: a turn
never moves it, it goes on falling as it was, and the other half swings around it. Only a turn that
does not fit moves the pivot (the kick, lift or double turn above). Numbers
live in `content/data/puzzles/swordfight.json`.

## Engine

`packages/engine/src/swordfight/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/swordfight.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Swordfight". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
