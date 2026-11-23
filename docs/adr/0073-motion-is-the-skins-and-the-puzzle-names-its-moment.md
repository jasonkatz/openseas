# 0073. Motion is the skin's, and the puzzle names its moment

Status: Accepted. Supersedes decision 4 of [0071](./0071-the-beat-is-each-puzzles-own-too.md) (the
pulse is the same on every board), the line of `docs/BRAND.md` section 6 that says so, and the line of
the puzzle domain guide that the skin gives the beat to an event. Changes the `puzzles` skill's rule 1,
which said feedback never holds input back.

## Context

The puzzle domain guide (`docs/puzzles/DOMAIN.md`) left motion uncovered: how each event plays on the
board, and how the beat looks. In the code every board hand-codes its motion from a report its engine
leaves on the state, and the brand book holds one way of moving and one pulse for every board. The
owner wants motion to be part of how a puzzle is dressed, so a theme other than space could move its
own way, while what happens on the board stays a fact of the rules.

## Decision

1. **The puzzle says what changes; the skin says how it plays.** A puzzle's events carry its board
   changes. A skin's motion says how each one plays: its length and easing, the stagger along an
   event's places, the marks it draws, where points rise from, which callout shows, and the beat's
   pulse. Motion never reaches the rules, so it cannot touch determinism.
2. **Pieces keep an id.** Every piece has a number unique within the round from the moment it is
   dealt until it leaves, and events point at pieces by it.
3. **Four board changes.** A piece arrives (in place, from a zone spot, or from off the board in a
   direction), leaves (cleared, or taken to a zone), travels (from a cell to a cell, by a route when it
   passes through others), or changes (its state or kind where it stands). Terrain changes the same way.
4. **Events carry every change.** A board drawn from a round's start and its events alone matches the
   round. A board plays from events, never by comparing one state with the next.
5. **One entry's events play in order.** Everything in one cascade step plays together, and the next
   step starts once it is done. No length of motion is a setting or written in the puzzle.
6. **The board settles before it takes the next touch.** A touch made while what an entry set off is
   still playing is dropped; a gesture already under way waits to finish. Motion from ticks never holds
   input, and the host plays ticks as they fall due so their events reach the board as they happen.
   The clock and the ticks keep running while a board settles, so a skin's motion can never change a
   round. Settling is the board's rule: the rules and the server never depend on it, and accept any
   entry with a good time.
7. **The host holds a ceiling.** Whatever one entry sets off plays for at most about a second. Past
   that, the host snaps it to its end. The number is the host's and never a setting.
8. **The puzzle names its moment; the skin dresses the beat.** The puzzle names one event as its
   biggest moment, with an optional condition on it and the number field that says how big each one
   is. The skin plays the beat on it: one pulse over the whole board on top of every other motion,
   stronger for a bigger moment and never a second effect, with one cue of its own heard alone.
9. **Reduced motion is the skin's.** The host passes on the player's ask; each skin says what it does.
10. **Motion is copied, as cues are.** Each skin holds its whole motion. A new skin starts from a copy
    of the game's, which is the space theme's, as a new skin's cues do. A theme stays a set of skins
    with no document of its own: what a theme holds is left for its own decision. The brand book's
    numbers (a move of 120ms, a clear of 160ms, a pulse of 420ms in `amber`) are the game's motion.

## Alternatives considered

- **The host owns motion, one way for every puzzle.** It keeps the brand book's "one way of moving"
  by force, but ties every theme to one look in time, which is presentation as much as drawings are.
- **A new touch snaps what is playing.** How the boards behave today. The owner wants the player to
  see every move play out before making the next.
- **The clock pauses while a board settles.** A round's length would then depend on its skin, and the
  server cannot see motion.
- **The skin picks the beat's event.** Which moment is biggest follows from scoring, and every skin of a
  puzzle should agree on it.

## Consequences

- The domain guide gains a Motion section; the glossary gains board change, arrive, leave, travel,
  change, moment, motion, mark, reduced motion, settle and ceiling, and a sharper beat.
- The domain guide's "Not yet covered" gains what a theme holds.
- The puzzle document gains a `moment` and board changes on its events; the skin document gains
  `motion`, and loses `beat` from its events.
- Rule 1 of the `puzzles` skill says a move plays out before the next is taken, within the ceiling.
- The boards today snap what is playing when a new state arrives, read a move report rather than
  events, and pick their beats in code (Salvage beats on two things). Bringing each in line is a change
  of its own.
