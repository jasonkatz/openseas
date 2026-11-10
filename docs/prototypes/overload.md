# Overload

Status: design brief, not built yet. Prototype (ADR 0036), on the harness at `/overload`. Ticked
(ADR 0015): taps come back on the engine's clock. A 120 second round.

## The puzzle

A bank of capacitors, six wide and seven tall. Each holds a charge of 0 to 3, shown as pips. A tap
adds one charge to a capacitor. A capacitor that reaches 4 bursts: it empties and passes one charge
to each neighbour above, below, left and right (charge passed off the edge is lost). A neighbour
that reaches 4 bursts in the next wave, and so on until nothing is at 4. Everything one tap sets off
is one chain, and a chain of n bursts scores n × n (up to a cap, linear past it), so one chain of
ten is worth far more than two of five.

Taps are scarce. The player holds up to five, and one comes back every two seconds or so. A tap
that sets nothing off is not wasted: it primes a capacitor, and the skill is spending one or two
taps to join clusters before the tap that sets them all off.

When a chain ends, every capacitor that burst is swapped for a fresh one with a random charge. The
board never drains and never floods.

Layers to add in this order, each only if the one before plays well:

1. **Streak.** Chains of four or more in a row build a multiplier; a smaller chain breaks it; a
   priming tap does not.
2. **Refund.** A chain of eight or more gives a tap back; a bigger one, two. Good play fuels itself.
3. **Booster.** A rare capacitor with a double ring that passes two charges to each neighbour when
   it bursts, so it carries a chain through capacitors at 2.

## Luck and skill

- **Luck:** the fresh charges after a chain.
- **Skill:** reading the chain before the tap. First, a 3 bursts. Then, touching 3s all go. Then, a
  2 between two bursting cells goes too. Then, priming: the one tap that joins two clusters.

## Input

- Tap a capacitor. Keyboard: arrows move a cursor, space or enter taps.
- The taps held show as lamps in the board's strip, with the next one filling.
- No preview of a chain in any round: reading it is the game. Unrated and lab rounds pulse the best
  single tap after a pause (an engine query).
- A chain plays wave by wave, each burst a pop a step higher, with the count climbing on screen.

## Engine sketch

Moves `{ type: "tap", cell, tick }`, `{ type: "wait", tick }`, `{ type: "end", tick }`. The state
holds the taps and the tick the next one is counted from; `advanceOverload(state, tick)` gives the
taps at a later tick for display. A tap's report lists the waves (cells that burst in each) and the
fresh charges, for the board to play. Guard the wave loop with a cap.

## To settle by simulation

- The fresh-charge weights, so the best single tap is usually a chain of 4 to 6 and two taps of
  set-up reach 10 to 15. A bot that taps at random, one that takes the best single tap, and one that
  looks one priming tap ahead should score clearly apart.
- The chain cap and the tap rate, so a round is neither starved nor spammed.
- Whether a burst capacitor should keep the charge it was passed instead of being swapped.
