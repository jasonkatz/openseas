import { must, never, only, type Member, type Param, type SdkRoot } from "./types.js";

/** The hooks a rules file may hold: each with its signature, when the loop asks it and what it is asked for. */

const ctx: Param = {
  name: "ctx",
  type: "Ctx<P, S>",
  description: "The [context](/api/context): the whole table, the puzzle's draws, and `emit`, which reports an event.",
};

const view = (whose: string): Param => ({
  name: "view",
  type: "View<P, S>",
  description: `The [view](/api/view) of ${whose}. It holds only what that seat may see.`,
});

const NEXT_STATE = {
  type: "S | void",
  description: "The rules' next state, or nothing.",
  values: [
    { value: "S", description: "The state from now on. Return a new value: never change the one in `ctx.state`." },
    { value: "void", description: "Nothing is returned, and the state stays as it is. A hook that only reports events returns nothing." },
  ],
} as const;

const PURE = never("Read a clock, ask for a random number, or reach anything outside its arguments. The same seed, settings and log must always make the same round.");
const ASK_ONLY = never("Change anything. A view has no `emit` and no `draw`, so a question has no way to.");
const SAME_ANSWER = must("Give the same answer for the same view and arguments, however often it is asked.");

const onStart: Member = {
  name: "onStart",
  kind: "hook",
  page: true,
  signature: "onStart(ctx: Ctx<P, S>): S",
  description: "Deals the board and gives the rules' first state.",
  about: [
    "It is the first hook of every round. The board and every zone are empty when it is asked, so whatever a round starts with arrives here, on events.",
    "It deals and does nothing else. Where the puzzle declares a [check](/api/puzzle#deal-checks), the loop holds the deal to it: it asks `onStart` on a copy for each try, and shows the player only the deal that passed. So `onStart` never tests its own deal, and never loops until it finds a good one.",
  ],
  need: "required",
  given: "context",
  stages: ["Start"],
  asked: "At the start of a round, before anything else. Where the puzzle has a check it is asked once for every try, and again when a board is dealt again during play.",
  before: ["The round is made from its seed and its settings.", "`checkSettings` has passed these settings.", "No phase is open yet: `ctx.phase` is `null`."],
  after: ["The puzzle's first phase opens, and `onOpen` is asked for it.", "The loop works out who is awaited."],
  params: [ctx],
  returns: { type: "S", description: "The rules' first state. A puzzle that remembers nothing the engine does not already keep returns `{}`." },
  rules: [
    must("Put every piece the round starts with on the table by reporting events. Nothing reaches a board any other way."),
    must("Return a state. `onStart` is the one `on` hook that may not return nothing."),
    never("Deal a hand that belongs to a phase. That is the phase's `onOpen`."),
    PURE,
  ],
  refused: ["An event, a draw, a zone or a piece the puzzle does not declare is named.", "A piece is put on a cell that already holds one."],
  examples: [
    {
      title: "Fill a grid",
      puzzle: "swap",
      wrap: "rules",
      code: `onStart(ctx) {
  ctx.emit("fill", {}, (e) => {
    for (const place of ctx.board.places()) {
      const kind = 1 + ctx.draw("fill").even(ctx.settings.kinds);
      e.arrive(place, { piece: "kind", kind }, "above");
    }
  });
  return {};
}`,
    },
    {
      title: "Start with a state",
      note: "A card game remembers its dealer. The cards are dealt when the `hand` phase opens, not here.",
      puzzle: "tricks",
      wrap: "rules",
      state: "{ dealer: Seat; bids: (number | null)[] }",
      code: `onStart(ctx) {
  return { dealer: ctx.seats[0]!, bids: ctx.seats.map(() => null) };
}`,
    },
  ],
};

const onFallback: Member = {
  name: "onFallback",
  kind: "hook",
  page: true,
  signature: "onFallback(ctx: Ctx<P, S>): S | void",
  description: "Deals a board that passes, when every try of a check has failed.",
  about: [
    "The loop holds a deal to the puzzle's [checks](/api/puzzle#deal-checks). It asks `onStart` to deal on a copy, runs the cascade there unseen and unpaid, and tries every move `listMoves` gives. A deal with no move worth making is dealt again, up to the check's `tries`.",
    "When every try fails, this hook deals instead. What it deals is taken as it is and shown to the player, so it must pass by the way it is built, whatever the settings.",
  ],
  need: { when: "the puzzle declares a check and is ready" },
  absent: "A round whose every try fails refuses to start, or stops, with an error that names the check. A puzzle that is valid and not yet ready may leave it out.",
  given: "context",
  stages: ["Start", "Close"],
  asked: "At the start, or at a close where a check holds during play, when the last try of the check has failed.",
  before: ["Every try has failed, and each used its luck.", "The board is empty, as it is for `onStart`."],
  after: ["What it dealt is the deal. It is not tried.", "During play, the check's `during` event tells the player the board was dealt again."],
  params: [ctx],
  returns: NEXT_STATE,
  rules: [must("Deal a board that passes the check for every value its settings may take."), never("Lean on luck to pass. A fallback that draws may fail as the tries did."), PURE],
  refused: ["An event, a draw or a piece the puzzle does not declare is named."],
  examples: [
    {
      title: "A board with one sure move",
      note: "Two kinds laid as a chequerboard make no line. A third kind is laid two in a row with one a step away, so one swap always makes a line.",
      puzzle: "swap",
      wrap: "rules",
      code: `onFallback(ctx) {
  const sure = (p: GridCell): boolean => (p.y === 0 && p.x < 2) || (p.y === 1 && p.x === 2);
  ctx.emit("fill", {}, (e) => {
    for (const place of ctx.board.places()) {
      const kind = sure(place) ? 1 : 2 + ((place.x + place.y) % 2);
      e.arrive(place, { piece: "kind", kind }, "above");
    }
  });
}`,
    },
  ],
};

const canMove: Member = {
  name: "canMove",
  kind: "hook",
  page: true,
  signature: "canMove(view: View<P, S>, move: Move<P>): string | null",
  description: "Says whether a seat may make a move now, and if not, why.",
  about: [
    "It is the puzzle's own rule about a move and nothing else. Whose turn it is and which moves a phase takes are the loop's, and are settled before `canMove` is asked.",
    "It is asked far more often than moves are made: by a board before it lets a player let go, by `view.allowed`, and for every move a stand-in weighs.",
  ],
  need: "required",
  given: "view",
  stages: ["Check"],
  asked: "Each time a seat offers a move, and whenever anything asks `view.allowed`.",
  before: [
    "A move from a seat that is not awaited, or that no player holds, is refused.",
    "A move the open phase does not take is refused.",
    "A move whose fields do not fit the puzzle is refused: a place that is not on the board, a field that is missing, a number where a place belongs.",
  ],
  after: ["On `null` the move is made: `onMove` is asked.", "On a reason nothing changes. The move is not kept in the log, and the reason goes back to the board it came from."],
  each: {
    signature: "canMove: { [M in MoveId<P>]: (view: View<P, S>, move: Move<P, M>) => string | null }",
    note: "One function for each move the puzzle declares, keyed by the move's id. Every move must have one. Each is given its own move's fields, so there is nothing to tell apart.",
  },
  params: [
    view("the seat that offers the move"),
    { name: "move", type: "Move<P>", description: "The move offered: its id in `move`, and the fields the puzzle declares for it. See [`Move`](/api/sdk#move)." },
  ],
  returns: {
    type: "string | null",
    description: "Whether the move may be made.",
    values: [
      { value: "null", description: "The seat may make the move." },
      { value: "string", description: "The seat may not, and this is why: one plain reason, such as `\"pick two pieces side by side\"`. It is for the board to act on." },
    ],
  },
  rules: [
    only("The puzzle's own rule. Do not check the seat, the turn, the phase or the shape of the fields again."),
    ASK_ONLY,
    SAME_ANSWER,
    never("Answer from a piece the seat cannot see. The view does not hold one, so a rule that needs it belongs in `onMove`, on an event that reveals it."),
  ],
  examples: [
    {
      title: "One function",
      puzzle: "swap",
      wrap: "rules",
      code: `canMove(view, { a, b }) {
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return "pick two pieces side by side";
  if (view.board.at(a)?.kind === view.board.at(b)?.kind) return "those two are the same kind";
  return null;
}`,
    },
    {
      title: "One function for each move",
      puzzle: "tricks",
      wrap: "rules",
      given: "declare function followsSuit(view: View<Tricks, {}>, card: number): string | null;",
      code: `canMove: {
  bid: (view, move) => (move.tricks === 0 && view.settings.nilBonus === 0 ? "nil is off at this table" : null),
  play: (view, move) => followsSuit(view, move.card),
}`,
    },
  ],
};

const onMove: Member = {
  name: "onMove",
  kind: "hook",
  page: true,
  signature: "onMove(ctx: Ctx<P, S>, seat: Seat, move: Move<P>): S | void",
  description: "Says what a move does, by reporting events.",
  about: ["It holds only what the move itself does. What follows by itself, such as a clear and the fall after it, belongs in `onCascade`, where the loop can count the steps."],
  need: "required",
  given: "context",
  stages: ["Move"],
  asked: "Once for each move that passed `canMove`. In a phase where seats act together, once when every awaited seat has a move.",
  before: ["`canMove` answered `null` for this seat and this move.", "The move is in the log, stamped with its time.", "Every tick that fell due before the move has been played."],
  after: ["`onCascade` is asked, again and again, until it reports nothing.", "Then `onMoveEnd` is asked, and the loop closes the move: it pays, banks, keeps the streak and checks the endings."],
  each: {
    signature: "onMove: { [M in MoveId<P>]: (ctx: Ctx<P, S>, seat: Seat, move: Move<P, M>) => S | void }",
    note: "One function for each move the puzzle declares, keyed by the move's id. Every move must have one.",
  },
  params: [
    ctx,
    { name: "seat", type: "Seat", description: "The seat that made the move." },
    { name: "move", type: "Move<P>", description: "The move made: its id in `move`, and its fields. See [`Move`](/api/sdk#move)." },
  ],
  returns: NEXT_STATE,
  rules: [
    must("Report at least one event for a move that changes anything. A board plays from events, so a change with no event is never seen."),
    never("Check the move again. `canMove` has passed it, and the two must not disagree."),
    never("Pay points by hand where a payout can. The loop pays every event that a payout names."),
    PURE,
  ],
  refused: ["An event the puzzle does not declare is reported, or one with fields that do not fit it.", "A board change the event is not declared to carry is made."],
  examples: [
    {
      title: "A swap",
      puzzle: "swap",
      wrap: "rules",
      code: `onMove(ctx, seat, { a, b }) {
  ctx.emit("swap", { a, b }, (e) => e.travel(a, b).travel(b, a));
}`,
    },
    {
      title: "One function for each move",
      note: "A bid is remembered in the state. A card played travels from the seat's hand to the trick.",
      puzzle: "tricks",
      wrap: "rules",
      state: "{ bids: (number | null)[] }",
      code: `onMove: {
  bid(ctx, seat, { tricks }) {
    ctx.emit("bid", { seat, tricks });
    return { bids: ctx.state.bids.map((bid, s) => (s === seat ? tricks : bid)) };
  },
  play(ctx, seat, { card }) {
    ctx.emit("played", { seat, card }, (e) => e.send(card, zone("trick")));
  },
}`,
    },
  ],
};

const onCascade: Member = {
  name: "onCascade",
  kind: "hook",
  page: true,
  signature: "onCascade(ctx: Ctx<P, S>): S | void",
  description: "Does one step of what follows a move by itself.",
  about: [
    "Each asking is one step: a clear, then the fall, then another clear. The hook looks at the board as it stands and reports what happens next, or reports nothing when the board has settled.",
    "The loop counts the steps from the events the puzzle marks `step`, keeps the count in `ctx.step`, and applies any multiplier indexed by step. The rules never count a cascade themselves.",
  ],
  need: "optional",
  absent: "Nothing follows a move by itself.",
  given: "context",
  stages: ["Cascade"],
  asked: "After every move, tick and signal, again and again until an asking reports no event.",
  before: ["`onMove`, `onTick` or `onSignal` has returned, and its events are applied.", "On a second asking, the events of the first are applied: the board is read as they left it."],
  after: ["If it reported an event, it is asked again.", "If it reported nothing, the cascade has run dry and `onMoveEnd` is asked."],
  params: [ctx],
  returns: NEXT_STATE,
  rules: [
    must("Report nothing once the board has settled. A hook that always reports never lets the move end, and the loop stops the round at its log limit."),
    must("Do one step an asking. Reporting a clear and its refill together hides a step from the count."),
    PURE,
  ],
  examples: [
    {
      title: "Clear, then refill",
      puzzle: "swap",
      wrap: "rules",
      given: "declare function groupsOf(board: Board<Swap>): GridCell[][];\ndeclare function refill(ctx: Ctx<Swap, {}>): void;",
      code: `onCascade(ctx) {
  const groups = groupsOf(ctx.board);
  for (const group of groups) {
    ctx.emit("clear", { pieces: group, size: group.length }, (e) => group.forEach((place) => e.leave(place)));
  }
  if (groups.length === 0) refill(ctx);
}`,
    },
  ],
};

const onMoveEnd: Member = {
  name: "onMoveEnd",
  kind: "hook",
  page: true,
  signature: "onMoveEnd(ctx: Ctx<P, S>): S | void",
  description: "Handles the end of a move, once the cascade has run dry.",
  about: [
    "It is where a full trick is taken and a turn's hits are counted.",
    "A board with no move left is dealt again by the loop, where the puzzle declares a check that holds during play. Where running out is the puzzle's own matter, the rules report it from here: the round fails, the task ends, or the seat is out.",
  ],
  need: "optional",
  absent: "Nothing happens at the end of a move.",
  given: "context",
  stages: ["Move end"],
  asked: "Once for each move, tick and signal, when `onCascade` has reported nothing.",
  before: ["The cascade has run dry: the last asking of `onCascade` reported no event."],
  after: ["If it reported an event, `onCascade` is asked again, and the steps go on from the same count. `onMoveEnd` is then asked once more, and it is asked again only when what it reported set the cascade off.", "If it reported nothing, the loop closes the move."],
  params: [ctx],
  returns: NEXT_STATE,
  rules: [must("Report nothing when there is nothing to do, so that the move can close."), PURE],
  examples: [
    {
      title: "Take a full trick",
      puzzle: "tricks",
      wrap: "rules",
      given: "declare function winnerOf(trick: readonly Piece<Tricks>[]): Seat;",
      code: `onMoveEnd(ctx) {
  const trick = ctx.zone("trick");
  if (trick.length < ctx.seats.length) return;
  const seat = winnerOf(trick);
  ctx.emit("took", { seat, cards: trick.length }, (e) => e.gather(zone("won", ctx.sideOf(seat)), zone("trick")));
}`,
    },
  ],
};

const onTick: Member = {
  name: "onTick",
  kind: "hook",
  page: true,
  signature: "onTick(ctx: Ctx<P, S>, tick: Tick): S | void",
  description: "Moves a ticking puzzle on by one tick.",
  about: ["A ticking puzzle's rules move by themselves, one tick at a time, whether or not anyone moves. A tick is never an entry in the log: the loop works out how many have passed from the time on each entry."],
  need: "optional",
  absent: "Nothing happens between moves.",
  given: "context",
  asked: "Once for every tick, in order. Before a move is checked, every tick up to the move's time is played.",
  before: ["Every earlier tick has been played, and closed as a move is."],
  after: [
    "Each seat no player holds whose time to move has come is played, lowest seat first.",
    "Then a player's move stamped at this tick is checked.",
    "The tick runs `onCascade`, `onMoveEnd` and the close, as a move does.",
  ],
  params: [ctx, { name: "tick", type: "Tick", description: "Which tick this is, and its time. See [`Tick`](/api/sdk#tick)." }],
  returns: NEXT_STATE,
  rules: [
    only("A puzzle whose [`round.tempo.kind`](/api/puzzle#round-tempo-kind) is `ticking`. In any other puzzle it is never asked."),
    never("Read the time any other way. `tick.ms` is the only clock a rules file has."),
    PURE,
  ],
};

const onSignal: Member = {
  name: "onSignal",
  kind: "hook",
  page: true,
  signature: "onSignal(ctx: Ctx<P, S>, signal: Signal<P>): S | void",
  description: "Takes a signal in: a value from outside the puzzle that steers it.",
  about: ["A signal is never a move, but it is in the log, so a replay sees it at the same time."],
  need: "optional",
  absent: "A signal changes nothing.",
  given: "context",
  asked: "Once for each signal in, at its place in the log.",
  before: ["The signal is in the log, stamped with its time.", "Every tick that fell due before it has been played."],
  after: ["The signal runs `onCascade`, `onMoveEnd` and the close, as a move does."],
  params: [ctx, { name: "signal", type: "Signal<P>", description: "The signal: its id in `signal`, the seat it is for, and its value. See [`Signal`](/api/sdk#signal)." }],
  returns: NEXT_STATE,
  rules: [only("Signals the puzzle declares under [`signals.in`](/api/puzzle#signals). No other can arrive."), PURE],
  examples: [
    {
      title: "Remember a value",
      puzzle: "tricks",
      wrap: "rules",
      state: "{ stakes: number }",
      code: `onSignal(ctx, signal) {
  if (signal.signal === "stakes") return { stakes: signal.value };
}`,
    },
  ],
};

const onTaskNeeded: Member = {
  name: "onTaskNeeded",
  kind: "hook",
  page: true,
  signature: "onTaskNeeded(ctx: Ctx<P, S>): S | void",
  description: "Deals a task when fewer are open than the puzzle declares.",
  about: ["The loop keeps which tasks are open, grades each one, pays on the grade and meets the stock ending. The rules do two things only: deal a task here, and say on an event when one is done, wherever that happens."],
  need: "optional",
  absent: "The puzzle has no tasks.",
  given: "context",
  stages: ["Close"],
  asked: "At the close of a move, tick or signal, once for each task that is missing.",
  before: ["Points are paid and banked, and finished tasks are graded."],
  after: ["If it reported the task's dealing event, the task is open.", "If it reported nothing, there is no room yet, and it is asked again at the next close."],
  params: [ctx],
  returns: NEXT_STATE,
  rules: [only("A puzzle that declares [`tasks`](/api/puzzle#tasks)."), must("Report nothing when there is no room for a task. The loop asks again."), PURE],
};

const phaseHook = (name: "onOpen" | "onClose"): Member => {
  const opens = name === "onOpen";
  return {
    name,
    kind: "hook",
    page: true,
    signature: `${name}: { [Ph in PhaseId<P>]?: (ctx: Ctx<P, S>) => S | void }`,
    description: opens ? "Does what the opening of a phase brings: a hand is dealt." : "Does what the closing of a phase brings: a hand is counted.",
    about: [
      opens
        ? "It is an object with one function for each phase that needs one, keyed by the phase's id. A phase with no function opens with nothing done."
        : "It is an object with one function for each phase that needs one, keyed by the phase's id. A phase with no function closes with nothing done.",
      "The rules never open or close a phase themselves. A phase closes on an event the puzzle names, when no seat is left to wait for, or when its repeats are used up.",
    ],
    need: "optional",
    absent: opens ? "Every phase opens with nothing done." : "Every phase closes with nothing done.",
    given: "context",
    stages: opens ? ["Start", "Close"] : ["Close"],
    asked: opens ? "Each time the phase opens: once for a phase that runs once, and once for every repeat of one that repeats." : "Each time the phase closes, before its tally is banked.",
    before: opens
      ? ["The phase is open: `ctx.phase` is its id and `ctx.repeat` is which repeat this is.", "A phase inside it has not opened yet."]
      : ["The phases inside it have closed.", "The phase is still open: `ctx.phase` is its id, and its tally has not been banked."],
    after: opens ? ["The first phase inside it opens, if it has any.", "The loop works out who is awaited."] : ["The phase's tally is banked, where it keeps one.", "The next phase opens, or the same one again where it repeats."],
    params: [{ ...ctx, description: `${ctx.description} Each function is given it.` }],
    returns: NEXT_STATE,
    rules: [only("Ids of phases the puzzle declares under [`round.phases`](/api/puzzle#round-phases). Any other key does not compile."), PURE],
    examples: [
      opens
        ? {
            title: "Deal a hand",
            note: "`deal` puts cards straight from the draw into a hand. The hook never learns which.",
            puzzle: "tricks",
            wrap: "rules",
            code: `onOpen: {
  hand(ctx) {
    for (const seat of ctx.seats) {
      ctx.emit("dealt", { seat }, (e) => e.deal("shuffle", zone("hand", seat), 13));
    }
  },
}`,
          }
        : {
            title: "Count a hand",
            puzzle: "tricks",
            wrap: "rules",
            state: "{ bids: (number | null)[] }",
            code: `onClose: {
  hand(ctx) {
    for (const side of ctx.sides) {
      const made = ctx.zone("won", side).length / ctx.seats.length;
      ctx.emit("counted", { side, made });
    }
    return { bids: ctx.seats.map(() => null) };
  },
}`,
          },
    ],
  };
};

const onTurn: Member = {
  name: "onTurn",
  kind: "hook",
  page: true,
  signature: "onTurn(ctx: Ctx<P, S>, seat: Seat): S | void",
  description: "Is told that a seat's turn has come, and may pass it.",
  about: ["Most puzzles leave it out. It is for a seat that has nothing to decide, as a seat that is all in has: the rules report an event and the turn moves on."],
  need: "optional",
  absent: "The seat is awaited.",
  given: "context",
  stages: ["Wait"],
  asked: "Each time `whoseTurn` names a seat, before that seat is awaited.",
  before: ["`whoseTurn` has answered this seat, or the loop has taken the next seat clockwise."],
  after: ["If it reported nothing, the seat is awaited: a player's seat waits for its player, and any other is played at once.", "If it reported an event, the turn has passed: `whoseTurn` is asked again."],
  params: [ctx, { name: "seat", type: "Seat", description: "The seat whose turn has come." }],
  returns: NEXT_STATE,
  rules: [only("A phase whose [`acts`](/api/puzzle#round-phases-acts) is `in-turn`."), PURE],
  examples: [
    {
      title: "Pass a seat with no cards",
      puzzle: "tricks",
      wrap: "rules",
      code: `onTurn(ctx, seat) {
  if (ctx.zone("hand", seat).length === 0) ctx.emit("passed", { seat });
}`,
    },
  ],
};

const onEnd: Member = {
  name: "onEnd",
  kind: "hook",
  page: true,
  signature: "onEnd(ctx: Ctx<P, S>, reason: EndingId<P>): S | void",
  description: "Is told that an ending is met, and which.",
  about: ["What it reports can still pay, as a bonus for what is left over does. It is the last hook that can change the round."],
  need: "optional",
  absent: "Nothing happens at the end.",
  given: "context",
  stages: ["End"],
  asked: "Once a round, when the first ending is met.",
  before: ["An ending the rules reported has closed the open phases first, and banked their tallies.", "No further move, tick or signal will be played."],
  after: ["Its events are paid and banked.", "The sides are placed, by `placing` where the puzzle places by its rules.", "`score` is read for each seat."],
  params: [ctx, { name: "reason", type: "EndingId<P>", description: "The id of the ending that was met, one of [`round.ends`](/api/puzzle#round-ends)." }],
  returns: NEXT_STATE,
  rules: [never("Report an event that ends the round or closes a phase. The round has ended."), PURE],
  examples: [
    {
      title: "Pay for what is left",
      puzzle: "tricks",
      wrap: "rules",
      code: `onEnd(ctx, reason) {
  if (reason !== "target") return;
  for (const side of ctx.sides) {
    ctx.emit("won", { side }, (e) => e.pay("leftover", side));
  }
}`,
    },
  ],
};

const whoseTurn: Member = {
  name: "whoseTurn",
  kind: "hook",
  page: true,
  signature: "whoseTurn(view: View<P, S>): Seat | null",
  description: "Says which seat moves next, in a phase where seats act in turn.",
  need: "optional",
  absent: "The next seat clockwise from `view.lastSeat` that is not sitting out. In a phase nobody has moved in yet, the lowest seat.",
  given: "view",
  stages: ["Wait"],
  asked: "After the start and after every close, while a phase in turn is open.",
  before: ["The last move, tick or signal has closed.", "Seats that sit out are known to the loop: naming one is refused."],
  after: ["A seat is answered: `onTurn` is asked for it, and then it is awaited.", "`null` is answered: the phase closes."],
  params: [view("the table: its `seat` is `null`, and it holds only what every seat may see")],
  returns: {
    type: "Seat | null",
    description: "Who moves next.",
    values: [
      { value: "Seat", description: "This seat moves next. It may be a player's seat or one no player holds." },
      { value: "null", description: "Nobody does. The phase closes." },
    ],
  },
  rules: [only("A phase whose [`acts`](/api/puzzle#round-phases-acts) is `in-turn`."), never("Name a seat that sits out of the phase, or is out of the round."), ASK_ONLY, SAME_ANSWER],
  refused: ["The seat answered is not in the round, or is sitting out."],
  examples: [
    {
      title: "The winner of a trick leads",
      puzzle: "tricks",
      wrap: "rules",
      state: "{ leader: Seat }",
      code: `whoseTurn(view) {
  const played = view.zone("trick").length;
  if (played === 4) return null;
  let seat = view.state.leader;
  for (let i = 0; i < played; i++) seat = view.next(seat);
  return seat;
}`,
    },
  ],
};

const pickMove: Member = {
  name: "pickMove",
  kind: "hook",
  page: true,
  signature: "pickMove(view: View<P, S>, standIn: StandInId<P>): Move<P>",
  description: "Chooses the move for a seat that one of the puzzle's own stand-ins holds.",
  about: [
    "A seat no player holds is played at once when it is awaited, through the same `canMove` and `onMove` as a player. Its moves are never entries in the log: a replay works them out again.",
    "It is given only its seat's view, so it has nowhere to read a card its seat cannot see.",
  ],
  need: { when: "the puzzle declares stand-ins of its own under `opponents.standIns`" },
  absent: "One of the four stand-in types plays, choosing from `listMoves`.",
  given: "view",
  stages: ["Wait"],
  asked: "Each time a seat held by one of the puzzle's own stand-ins is awaited.",
  before: ["The seat is awaited, and no player holds it.", "On a ticking puzzle, the seat's delay has passed."],
  after: ["The move goes to `canMove` and then `onMove`, as a player's does.", "A move `canMove` refuses is the rules' mistake. The loop stops the round and names the seat."],
  params: [
    view("the seat being played"),
    { name: "standIn", type: "StandInId<P>", description: "The id of the stand-in that holds the seat, one of [`opponents.standIns`](/api/puzzle#opponents-standins). Its dials are settings, read from `view.settings`." },
  ],
  returns: { type: "Move<P>", description: "The move the seat makes. It must be one `canMove` allows: a stand-in may not pass by answering nothing." },
  rules: [
    must("Answer a move `view.allowed` passes."),
    must("Draw any luck of its own from `view.try`, never from a draw. A stand-in's choices have a stream of their own, which the engine keeps, so a seat changing hands never shifts the deal."),
    ASK_ONLY,
  ],
  examples: [
    {
      title: "Two stand-ins",
      puzzle: "tricks",
      wrap: "rules",
      given: "declare function legal(view: View<Tricks, {}>): Move<Tricks>[];",
      code: `pickMove(view, standIn) {
  const moves = legal(view);
  if (standIn === "careful") return moves[0]!;
  let best = moves[0]!;
  for (const move of moves) {
    if (view.try(move).points > view.try(best).points) best = move;
  }
  return best;
}`,
    },
  ],
};

const listMoves: Member = {
  name: "listMoves",
  kind: "hook",
  page: true,
  signature: "listMoves(view: View<P, S>): Move<P>[]",
  description: "Lists every move a seat can make now.",
  about: [
    "With it the puzzle takes all four stand-in types, the loop can tell that a seat has no move left, and it can hold a deal to its checks: it tries each listed move on a copy to learn whether one is worth making.",
    "The four types choose from everything on the board, so they play only where a seat sees all of it. A puzzle with a place a seat cannot see brings stand-ins of its own.",
  ],
  need: "optional",
  absent: "None of the four stand-in types can play the puzzle, no check can be held, and nothing can tell that a seat has no move left.",
  given: "view",
  asked: "Whenever a stand-in type is awaited, for every try of a check, at a close where a check holds during play, and by the Finish test after every close.",
  params: [view("the seat whose moves are wanted")],
  returns: {
    type: "Move<P>[]",
    description: "Every move the seat can make, in any order.",
    values: [
      { value: "Move<P>[]", description: "Each entry is a move `canMove` allows. Where the same move could be written two ways, list it once." },
      { value: "[]", description: "The seat has no move. The loop does not wait for it." },
    ],
  },
  rules: [must("List only moves `canMove` allows, and every one of them. A move left out is a move no stand-in ever plays."), ASK_ONLY, SAME_ANSWER],
  examples: [
    {
      title: "Every swap side by side",
      puzzle: "swap",
      wrap: "rules",
      code: `listMoves(view) {
  const moves: Move<Swap>[] = [];
  for (const a of view.board.places()) {
    for (const b of view.board.touching(a)) {
      const move: Move<Swap> = { move: "swap", a, b };
      if (view.allowed(move) === null) moves.push(move);
    }
  }
  return moves;
}`,
    },
  ],
};

const worth: Member = {
  name: "worth",
  kind: "hook",
  page: true,
  signature: "worth(view: View<P, S>, move: Move<P>): number",
  description: "Says what a move is worth to a seat.",
  about: ["Two of the four stand-in types choose by it: the greedy one takes the move worth most, and the planner looks further ahead with it."],
  need: "optional",
  absent: "The points the move pays that seat now: `view.try(move).points`.",
  given: "view",
  asked: "For each move a greedy or planner stand-in weighs.",
  params: [view("the seat weighing the move"), { name: "move", type: "Move<P>", description: "A move the seat can make: one of those `listMoves` gave." }],
  returns: { type: "number", description: "What the move is worth. More is better, and only the order matters: it is never points and is never paid." },
  rules: [ASK_ONLY, SAME_ANSWER],
  examples: [
    {
      title: "Points now, and a little for what is set up",
      puzzle: "swap",
      wrap: "rules",
      given: "declare function pairsLeft(board: Board<Swap>): number;",
      code: `worth(view, move) {
  const tried = view.try(move);
  return tried.points * 10 + pairsLeft(tried.view.board);
}`,
    },
  ],
};

const hint: Member = {
  name: "hint",
  kind: "hook",
  page: true,
  signature: "hint(view: View<P, S>): Move<P> | null",
  description: "Offers a move worth making, to a player who is stuck.",
  need: { when: "the puzzle's `teaching.hint` is true" },
  absent: "The puzzle offers no hint.",
  given: "view",
  asked: "When a board asks for a hint, usually after a few idle seconds. A round that counts never asks.",
  params: [view("the player's seat")],
  returns: {
    type: "Move<P> | null",
    description: "A move for the board to point at.",
    values: [
      { value: "Move<P>", description: "A move `canMove` allows. The board shows it and does not make it." },
      { value: "null", description: "There is nothing to suggest." },
    ],
  },
  rules: [only("A puzzle whose [`teaching.hint`](/api/puzzle#teaching) is true."), must("Answer a move `view.allowed` passes, or `null`."), ASK_ONLY],
  examples: [
    {
      title: "The move that pays most now",
      puzzle: "swap",
      wrap: "rules",
      given: "declare function candidates(view: View<Swap, {}>): Move<Swap>[];",
      code: `hint(view) {
  let best: Move<Swap> | null = null;
  let most = 0;
  for (const move of candidates(view)) {
    const points = view.try(move).points;
    if (points > most) [best, most] = [move, points];
  }
  return best;
}`,
    },
  ],
};

const pointsFor: Member = {
  name: "pointsFor",
  kind: "hook",
  page: true,
  signature: "pointsFor(event: Event<P>, paid: number): number",
  description: "Says what an event is worth, where the puzzle's payouts and multipliers cannot.",
  about: ["Most puzzles never write this hook. A puzzle that does should first ask whether a payout could say it instead: a payout is read by a tuning panel, a guide and a test, and code is read by none of them."],
  need: "optional",
  absent: "The puzzle's payouts and multipliers pay.",
  given: "values",
  stages: ["Close"],
  asked: "Once for each event a payout pays on, as the loop pays it.",
  before: ["The payouts that name the event are added up, and every multiplier that scales them is applied."],
  after: ["The answer is paid to the event's account, and fills the event's `points` field.", "Then it is banked as [`points`](/api/puzzle#points) says."],
  params: [
    { name: "event", type: "Event<P>", description: "The event being paid: its id in `event`, and its fields. See [`Event`](/api/sdk#event)." },
    { name: "paid", type: "number", description: "What the payouts and multipliers would pay for it, a whole number." },
  ],
  returns: { type: "number", description: "What the event pays instead, a whole number. Return `paid` for every event the hook has nothing to say about." },
  rules: [must("Return a whole number. A fraction is refused."), never("Read anything but its two arguments. It has no view and no context, so the same event always pays the same.")],
  refused: ["The answer is not a whole number."],
  examples: [
    {
      title: "A contract missed pays nothing",
      puzzle: "tricks",
      wrap: "rules",
      code: `pointsFor(event, paid) {
  if (event.event === "counted" && event.made === 0) return 0;
  return paid;
}`,
    },
  ],
};

const placing: Member = {
  name: "placing",
  kind: "hook",
  page: true,
  signature: "placing(ended: Ended<P>): Side[][]",
  description: "Puts the sides in order, where the puzzle places by its rules.",
  need: { when: "the puzzle's `placing.by` is `rules`" },
  absent: "The loop places by points, or by the last side standing, as [`placing.by`](/api/puzzle#placing-by) says.",
  given: "values",
  stages: ["End"],
  asked: "Once a round, after `onEnd`.",
  before: ["`onEnd` has returned, and what it reported is paid and banked."],
  after: ["`score` is read for each seat, with this placing."],
  params: [{ name: "ended", type: "Ended<P>", description: "How the round ended: the reason, the time played, and each side's points. See [`Ended`](/api/sdk#ended)." }],
  returns: {
    type: "Side[][]",
    description: "The places, best first. Each place is a list of the sides that share it.",
    values: [
      { value: "[[0], [1]]", description: "Side 0 is first and side 1 second." },
      { value: "[[0, 1]]", description: "The two sides tie for first." },
    ],
  },
  rules: [only("A puzzle whose [`placing.by`](/api/puzzle#placing-by) is `rules`. With any other value it is never asked."), must("Place every side of the round exactly once.")],
  refused: ["A side is missing from the answer, or is in it twice."],
  examples: [
    {
      title: "Most points, with ties shared",
      puzzle: "tricks",
      wrap: "rules",
      code: `placing(ended) {
  const sorted = [...ended.sides].sort((a, b) => b.points - a.points);
  const places: Side[][] = [];
  for (const [i, s] of sorted.entries()) {
    if (i > 0 && sorted[i - 1]!.points === s.points) places.at(-1)!.push(s.side);
    else places.push([s.side]);
  }
  return places;
}`,
    },
  ],
};

const score: Member = {
  name: "score",
  kind: "hook",
  page: true,
  signature: "score(result: Result<P>): number",
  description: "Reads one seat's score from how the round ended.",
  need: "optional",
  absent: "The seat's account: `result.points`.",
  given: "values",
  stages: ["End"],
  asked: "Once for each seat, after the sides are placed.",
  before: ["The sides are placed."],
  after: ["A score below zero is raised to zero.", "The score is the round's read for that seat. Judgement turns it into a performance."],
  params: [{ name: "result", type: "Result<P>", description: "The round as it ended for one seat: the reason, the placing, the seat's points, its side's and the time played. See [`Result`](/api/sdk#result)." }],
  returns: { type: "number", description: "The seat's score, a whole number of zero or more." },
  rules: [must("Return a whole number."), never("Read anything but `result`. A score must follow from how the round ended and nothing else.")],
  examples: [
    {
      title: "A side's points, halved for losing",
      puzzle: "tricks",
      wrap: "rules",
      code: `score(result) {
  const won = result.placing[0]!.some((side) => side === result.seat % 2);
  return won ? result.sidePoints : Math.floor(result.sidePoints / 2);
}`,
    },
  ],
};

const checkSettings: Member = {
  name: "checkSettings",
  kind: "hook",
  page: true,
  signature: "checkSettings(settings: Settings<P>): string | null",
  description: "Says what is wrong with a set of settings, before a round starts on them.",
  about: ["The puzzle's bounds and [`relations`](/api/puzzle#relations) are held without it. It is for what they cannot say: a hand-drawn map with no way out, a board too small for its pieces."],
  need: "optional",
  absent: "Only the puzzle's bounds and relations are held.",
  given: "values",
  asked: "Before a round starts, and whenever a tuning panel changes a setting.",
  before: ["Every setting is within its bounds, and every relation holds."],
  after: ["On `null` a round may start on these settings.", "On a reason no round starts. A host never runs a round on settings this hook refuses."],
  params: [{ name: "settings", type: "Settings<P>", description: "A value for every setting, by id. See [`Settings`](/api/sdk#settings)." }],
  returns: {
    type: "string | null",
    description: "Whether a round may start.",
    values: [
      { value: "null", description: "Nothing is wrong." },
      { value: "string", description: "What is wrong, as one plain reason, such as `\"the board is too small for five kinds\"`." },
    ],
  },
  rules: [never("Check a bound or a relation the puzzle already declares."), SAME_ANSWER],
  examples: [
    {
      title: "A board big enough to deal",
      puzzle: "swap",
      wrap: "rules",
      code: `checkSettings(settings) {
  if (settings.width * settings.height < settings.kinds * 3) return "the board is too small for that many kinds";
  return null;
}`,
    },
  ],
};

export const HOOKS_ROOT: SdkRoot = {
  root: "hooks",
  name: "Rules",
  title: "The rules object",
  lede: "Every hook a rules file may hold: when the loop asks it, what it is given, what it must answer, and what happens when it is left out.",
  about: [
    "A rules file exports one object of hooks, passed through [`defineRules`](/api/sdk#definerules). Three hooks are required. Every other has a default, and a hook added later comes with one, so no puzzle already written has to change.",
    "A hook's name says which of two kinds it is. A hook that starts with `on` is told that something happened. It is given a [context](/api/context), and it changes the round in one way only: it reports events. Any other hook is a question. It is given a [view](/api/view) or plain values, it answers, and answering changes nothing.",
    "In every signature `P` is the puzzle's type and `S` is the rules' state. See [Types and functions](/api/sdk).",
  ],
  groups: [
    { title: "Required", note: "Every rules file has these three.", members: [onStart, canMove, onMove] },
    { title: "The deal", members: [onFallback] },
    { title: "After a move", members: [onCascade, onMoveEnd] },
    { title: "Time and signals", members: [onTick, onSignal] },
    { title: "Tasks", members: [onTaskNeeded] },
    { title: "Phases and turns", members: [phaseHook("onOpen"), phaseHook("onClose"), whoseTurn, onTurn] },
    { title: "Seats no player holds", members: [pickMove, listMoves, worth] },
    { title: "Points and endings", members: [pointsFor, onEnd, placing, score] },
    { title: "Teaching and settings", members: [hint, checkSettings] },
  ],
  holds: {
    title: "What holds for every hook",
    items: [
      "A hook is pure. It never reads a clock, never asks for a random number, and never reaches a file, the network or anything global. All luck comes from a [draw](/api/context#draw).",
      "A hook that starts with `on` changes the round only by reporting events with [`emit`](/api/context#emit). It returns the next state, or nothing to keep the state as it is.",
      "A question changes nothing, and gives the same answer for the same view however often it is asked. So a board, a stand-in or a hint may ask one at any time.",
      "Every id a hook names must be declared in the puzzle: a draw, an event, a zone, a phase, a move, a payout. A wrong id does not compile, and at run time the engine refuses one and names it.",
      "Every part the puzzle declares must be used by its rules. A host will not run a puzzle that declares a draw, a zone or an event its rules never touch.",
      "A puzzle may add questions of its own, such as a preview of what a move would clear. Each is written like any other question: it gets a view, it answers, and it changes nothing.",
    ],
  },
  example: {
    title: "swap.rules.ts",
    note: "The three required hooks, and nothing else. This is a whole rules file.",
    puzzle: "swap",
    wrap: "file",
    code: `import { defineRules } from "@openseas/puzzle";
import type { Swap } from "./swap.puzzle.gen";

type State = {};

export default defineRules<Swap, State>({
  onStart(ctx) {
    ctx.emit("fill", {}, (e) => {
      for (const place of ctx.board.places()) {
        const kind = 1 + ctx.draw("fill").even(ctx.settings.kinds);
        e.arrive(place, { piece: "kind", kind }, "above");
      }
    });
    return {};
  },

  canMove(view, { a, b }) {
    const touching = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
    return touching ? null : "pick two pieces side by side";
  },

  onMove(ctx, seat, { a, b }) {
    ctx.emit("swap", { a, b }, (e) => e.travel(a, b).travel(b, a));
  },
});`,
  },
};
