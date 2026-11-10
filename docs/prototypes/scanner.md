# Scanner

Status: design brief, not built yet. Prototype (ADR 0036), on the harness at `/scanner`. Untimed
moves; a 120 second round.

## The puzzle

A fogged sector, six by six, hiding a handful of contacts. The player finds them all, and the next
sector is dealt.

A ping on a cell answers with one number: how far the nearest contact is, counting steps up, down,
left and right (0 means the ping landed on a contact and has found it). The number says two things.
Nothing lies nearer than that, so every cell closer than the number is clear, and the board shades
them. And at least one contact lies exactly that far away, on the diamond-shaped ring of cells at
that distance. Two or three pings whose rings cross pin a contact down.

A lock on a cell says "a contact is here". A right lock finds the contact. A wrong lock costs points
and breaks the streak.

Pings are the price. Each sector has a par (three pings a contact, to be tuned). A found contact
scores; clearing the sector pays a bonus for every ping under par; sectors cleared at or under par
with no wrong lock build a streak that multiplies both. Sectors grow as they are cleared: one more
contact every sector or two, up to a cap.

## Luck and skill

- **Luck:** where the contacts are.
- **Skill:** first, reading one ring. Then, crossing two. Then, choosing the ping that splits what
  is left most evenly. Then, the subtle part: a ping names its nearest contact only, so a contact
  already found explains a ring and says nothing lies nearer.

## Input

- Two ways to touch a cell: ping and lock. A switch in the board's strip picks which a tap means; a
  long press always locks. Keyboard: arrows move a cursor, space pings, enter or L locks.
- A pinged cell keeps its number. Tapping a pinged cell lights its ring.
- Cells proven clear are shaded. A ping whose ring is already explained by a found contact dims.
  Both come from engine queries: the board shows what follows from the pings, it does not solve.
- A ping plays a sonar tone, lower the farther the contact. Unrated and lab rounds may pulse a cell
  that the pings prove to hold a contact, after a pause.

## Engine sketch

Moves `{ type: "ping", cell }`, `{ type: "lock", cell }`, `{ type: "end" }`. The state holds the
contacts, the pings and their answers, the found contacts, and the sector's count of pings.
Queries: the cells a ping's ring covers, the cells proven clear, whether a ping is explained.

The contacts sit in the state, which the client holds: nothing here is hidden from a cheat. That is
accepted for a prototype (ADR 0036) and would need the server to answer pings before a Scanner
round counted for anything.

## To settle by simulation

- Par, by a bot that pings to split the remaining possibilities: par should be what a careful
  player manages, a little above the bot.
- Whether six by six with four to six contacts gives sectors of 15 to 20 seconds.
- Whether a ping on a contact should be free information, as here, or cost something.
