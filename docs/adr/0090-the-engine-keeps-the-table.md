# 0090. The engine keeps the table

Status: Accepted. Builds on [0088](./0088-a-puzzles-rules-are-hooks-on-one-round-loop.md), whose loop,
hooks and three required hooks it keeps, and supersedes its decisions 3, 5, 8, 9 and 11. Changes
[0076](./0076-stand-ins-are-four-types-on-two-dials.md), where a stand-in has two dials and no more,
and [0075](./0075-a-puzzle-declares-its-deal.md), whose secrets become places a seat cannot see.
Changes the puzzle domain guide's sections on tempo, endings, the log, signals, points and score,
between sides, zones, pieces, secrets, versus, sides, stand-ins, the rules and the puzzle document, and
empties its Not yet covered.

## Context

ADR 0088 gave every round one loop and the rules named hooks on it. It was held against the
twenty-three engines and fits a solo puzzle whole. For a round with more than one seat it leaves five
things in the rules' own state, where the engine cannot see them: who is awaited, which stretch of the
round is open, whose points are whose and when they count, who may see what, and how the round ended
for each side.

The six puzzles between sides each keep those by hand, and the reducers show it:

- Pact and Showdown log a `next` move for every stand-in's turn, sent by the board on a timer, and
  keep `toAct` and a `phase` field of their own.
- Pact floors each hand for each side (`countSide`: `added = Math.max(0, raw)`), which the owner chose
  (`docs/prototypes/pact.md`). Space Battle nets a turn's hits and hits taken, then floors the total
  (`commit`). Neither is decision 8 of ADR 0088, which stops points at zero as each is paid.
- A hidden card sits in the same state as everything else. A hook that starts with `on` sees the whole
  round, so nothing stops one copying a card where a stand-in, a hint or another seat's board reads it.
- Showdown counts rivals with fewer chips, and a speed bonus, only when a round is played out. No hook
  asked at End can report an event, so those points belong to no payout. Its chips are not points, so
  no engine could place its sides from the points.
- All eleven prototype move types have an `end` move of their own. Freefall and Space Battle both have
  a `turnSeconds` the board keeps, though the guide says a turn's length is never a setting.
- A raider's numbers are two kinds: its turrets, tokens and starting damage belong to the ship whoever
  flies it, and its accuracy and aggression to the stand-in (`RaiderSpec`).
- The number of sides is a range: Pouring takes none to three rivals, Showdown one to five, and
  Freefall plays with or without one.

Because each puzzle answers these alone, each can get them wrong alone, and no tool can read the
answers. Three proposals and a review of their gaps all reached the same direction, and the owner
approved the one design made from them: whatever the engine promises, the engine must hold.

## Decision

1. **The engine keeps the table.** Beside what ADR 0088 gives it, the engine keeps who holds each
   seat, who is awaited, which phases are open, where every piece is and who sees it, every account
   and tally, and the placing. The document declares what exists, and the rules say what happens. A
   solo puzzle declares none of it and reads as it does on ADR 0088.
2. **Time and acting are two dials.** Tempo is still or ticking. **Acting** says who may move: anyone,
   the seats in turn, every seat together, or nobody. Acting belongs to a phase, or to the round where
   it has none. Turns leave tempo.
3. **Every seat has a holder,** a player, a stand-in or nobody, and the holder is the host's business,
   never the rules'. The log gains a third entry beside moves and signals: a **seat entry**, written by
   the host, says a seat is now held by this player or this stand-in, that its time for this wait has
   lapsed, or that its player has left. A move names its seat, and the engine refuses one for a seat no
   player held at that time. A stand-in's moves are still never logged.
4. **A puzzle between sides names its `absent` stand-in.** It plays a lapsed seat for that one wait,
   and the seat of a player who has left while others stay, through `canMove` as any seat does. The
   clock for a wait is the host's or a role's, never the puzzle's. When the last player leaves, the
   round ends with the stock reason `left`, the same for every puzzle, and no puzzle declares an `end`
   move.
5. **The engine works out the wait** after Start and after every Close: anyone, one seat, every seat,
   a control, or nobody. It refuses a move from a seat it is not waiting for before `canMove` is asked,
   and plays a stand-in at once when the awaited seat has no player. `whoseTurn` is asked for every
   seat, a player's included, and left out it answers the next seat clockwise that is not sitting out.
   `onTurn` is asked when a seat's turn comes, and may report an event and pass. A seat sits out of a
   phase or is out of the round when the rules say so on an event. A round that waits on nobody with no
   phase left to open and no ending met is stopped, with the seat and the phase named.
6. **A puzzle declares its phases as a tree.** A phase has an id, how its seats act, the moves it
   takes, how many times it repeats, the control that starts the next repeat, and whether it keeps a
   tally. The engine opens and closes phases in the declared order. A phase closes on an event the
   document names, when no seat is left to await, or when its repeats are used up. An event may close
   any open phase, and closing one closes those inside it. A phase where no seat can act runs straight
   through. A move the open phase does not list is refused before `canMove`. `onOpen` and `onClose`
   are asked at each end. The stock ending can count a phase.
7. **A card is a piece and a hand is a zone.** A zone says whose it is, the round's, each seat's or
   each side's, and who sees what it holds: everyone, its seat, its side or nobody. The engine builds
   each seat's view and cuts each seat's copy of every event, so a piece a seat may not see reaches it
   with an id and no kind. Every question is asked with a seat's view.
8. **The rules' own state is public,** with no exception. A hidden piece is dealt straight from its
   draw into its place with `deal`, so the hook that deals a hand never learns what is in it. A hook
   reads a hidden piece only with `peek`, and only while reporting an event the document says reveals
   that place. A round with a hidden place is run by its host.
9. **Points go to an account,** a seat's or a side's, and are banked by two dials. `banks` says when:
   as each event is paid, or when a named phase closes, until which they sit in that phase's tally.
   `floor` says what stops at zero: the total, or the tally alone. Left out, points are banked as paid and
   the total is floored, which is ADR 0088's decision 8. A tally not yet banked is dropped when a round
   ends by `left` or by its log cap. Chips, bags and tricks stay the rules' own public state.
10. **Every ending has an id, which is its reason.** At End the engine works out the **placing**:
    every side in order, ties sharing the better place, by points, by the last side standing, or by
    the rules' answer to `placing` where the puzzle says so. `onEnd` is asked once when an ending is
    met, is told which, and what it reports can pay. `score` is asked for each seat, with the reason,
    the placing, its own points, its side's and the time played. A move budget between sides counts
    turns for each seat, passed and lapsed turns included.
11. **A seat has settings of its own, and a stand-in its own dials.** Seat settings belong to the seat
    whoever holds it and are set by the host or a role. A puzzle's own stand-in declares its dials as
    settings are declared, with named presets. Delay is the engine's for every stand-in. Slip stays
    with the four types.
12. **`worth` says what a move is worth to a seat,** and left out it is the points the move pays that
    seat now. `try` is the one way to try a move on a copy of the round, which draws from a throwaway
    stream. Each stand-in seat has a stream of its own.
13. **A signal declares typed fields and may name a seat,** in or out. Every entry and every tick runs
    Cascade, Move end and Close, as a move does. An event says whether it is a cascade step.
14. **A drawn round is a shared place,** and judged by its outcome it moves a player neither up nor
    down. A round against several rivals is judged against each and averaged.
15. **The frame has twenty-two hooks.** `onTurn`, `onOpen`, `onClose`, `onEnd`, `worth` and `placing`
    are added, each with a default, and `whoseTurn` and `score` change as above. `onStart`, `canMove`
    and `onMove` stay the only required ones.
16. **Every puzzle is tested from its document,** with no test written by its author: Finish plays
    rounds with careless stand-ins in every seat, Sealed deals again what one seat cannot see and
    plays that seat's moves on, Hand-over changes holders and lapses seats at random entries, Leaving
    ends rounds at random entries, a board is drawn for each seat from that seat's own events, and
    every declared phase, zone, ending and dial is used.

## Consequences

- The guide's Tempo, Endings, The log, Signals in, Points and score, Between sides, Zones, Pieces,
  Secrets, Versus, Sides, Stand-ins and The rules say what is decided here, and it gains a section,
  Phases. Its Not yet covered empties. The puzzle document gains `acts`, `phases`, a reason on every
  ending, `absent`, `left`, `seatSettings`, dials and presets on a stand-in, `points`, `placing`,
  `each` and `seenBy` on a zone, `step`, `closes` and `reveals` on an event, fields on a signal and
  `each` on a gauge. `secrets` and a tempo of turns leave it. The glossary gains holder, seat entry,
  absent, seat setting, wait, acting, phase, account, tally, placing, reason, view and preset. bank and banked. Points
  are banked, and settle stays the board's word alone.
- This moves no puzzle and adds no code, as ADR 0088 did. Each engine in `engine` keeps its reducer
  until it is moved by a change of its own, held to ADR 0088's decision 12.
- In the game, a puzzle with a hidden place is played on the server and not simulated on the client.
  That is Pact and Showdown. In the studio the page is the host and nothing changes.
- A piece may now have more than one family, since a card is a rank and a suit and a drink is a glass
  and a brew.
- A turn's length is no longer the puzzle's. Freefall's and Space Battle's `turnSeconds` go when those
  puzzles move, and a board may still send what is in hand at its own deadline.
- Pact's and Showdown's `next` moves, every puzzle's `end` move, and Space Battle's `supply` as a
  vouched move go when each puzzle moves. Each changes how stored rounds replay, so each is a new
  major (ADR 0079).
- The order to build in, each step moving one puzzle and proving one part: the groundwork with Swap
  still passing, then Pouring for seats and the wait, Freefall for phases and tallies, Space Battle for
  acting together and banking by phase, Pact for places and sight, Showdown, which then needs nothing new,
  and Swordfighting for ticking between sides.
- Left to the building: jumping between sibling phases, whose place is reserved as a parent phase
  whose order is `rules`; dealing unseen pieces again inside `try`, so the four types can play where
  a seat cannot see everything; and what the domain board needs to draw zones and several boards.
- Known drift this does not fix: six engines take `tickMs` as config, which the guide says is never a
  setting, and each loses it when it moves.

## Alternatives considered

- **More hooks, with the table left in the rules' state.** It is the least change. The engine could
  then promise nothing about turns, phases, sight or totals, every puzzle would keep them by hand as
  the reducers do today, and no tool could read a round's shape.
- **The rules as a script,** which reads well for a hand of cards: deal, await a bid from each seat,
  then await four cards thirteen times. A script paused mid-hand cannot be copied, hashed or replayed
  from the middle, which trying a move, comparing two replays and resuming a round all need. It has no
  answer for a ticking board, where nothing waits.
- **A fallback named on each wait,** in place of one `absent` stand-in. It is one more thing to write
  at every wait, and a fallback that is not a stand-in does not pass through `canMove`.
- **A question that passes a turn,** such as `canAct`. Passing changes the seat, as Pouring's pirate
  wakes and the turn is counted, and a question changes nothing.
- **The rules setting the phase, or jumping between phases.** A board would then learn of a change
  only if the rules remembered an event. Closing on a declared event tells it every time.
- **Chips as an account.** Pots and side pots are rule code, and an account the rules must reach into
  is no longer the engine's.
- **Hidden state allowed in the rules where a puzzle asks for it.** An exception is where leaks come
  from, and the Sealed test could no longer be run from the document alone.
