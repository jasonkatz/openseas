import { must, never, only, type Member, type SdkRoot } from "./types.js";

/** A view and a context: what a hook is handed, member by member. */

const board: Member = {
  name: "board",
  kind: "property",
  page: true,
  signature: "readonly board: Board<P>",
  description: "The board: its size, its cells, and the piece on each.",
  about: [
    "A board is read a cell at a time. A cell on a grid is `{ x, y }`, with columns counted from the left and rows from the top. A cell on rings is `{ ring, sector }`, with ring 0 innermost, sector 0 at the top and sectors counted clockwise. See [`Cell`](/api/sdk#cell).",
    "In a puzzle where each seat has a board of its own, a view's board is its seat's. A context's is the board of the seat that is moving.",
    "After an event is reported, the board reads as that event left it.",
  ],
  members: [
    {
      title: "Size",
      name: "board",
      note: "A grid has a width and a height. A ring board has rings and sectors. The two that do not belong to the board's shape are 0.",
      members: [
        { name: "width", kind: "property", signature: "readonly width: number", description: "A grid's columns, its rim included. 0 on a ring board." },
        { name: "height", kind: "property", signature: "readonly height: number", description: "A grid's rows, its rim included. 0 on a ring board." },
        { name: "rings", kind: "property", signature: "readonly rings: number", description: "A ring board's rings. 0 on a grid." },
        { name: "sectors", kind: "property", signature: "readonly sectors: number", description: "The sectors of each ring. 0 on a grid." },
      ],
    },
    {
      title: "Cells",
      name: "board",
      members: [
        {
          name: "places",
          kind: "method",
          signature: "places(): Cell<P>[]",
          description: "Every cell of the board.",
          returns: { type: "Cell<P>[]", description: "Each cell once. A grid is listed a row at a time from the top, each row from the left. Rings are listed from the innermost, each from sector 0. The list is a new one each time and may be changed freely." },
        },
        {
          name: "has",
          kind: "method",
          signature: "has(place: Cell<P>): boolean",
          description: "Whether a cell is on the board.",
          params: [{ name: "place", type: "Cell<P>", description: "Any cell, on the board or off it." }],
          returns: {
            type: "boolean",
            description: "Whether the board has that cell.",
            values: [
              { value: "true", description: "The cell is on the board." },
              { value: "false", description: "It is past an edge. Every other member is refused for such a cell, so ask this first when stepping off a cell." },
            ],
          },
        },
        {
          name: "at",
          kind: "method",
          signature: "at(place: Cell<P>): Piece<P> | null",
          description: "The piece on a cell.",
          params: [{ name: "place", type: "Cell<P>", description: "A cell on the board." }],
          returns: {
            type: "Piece<P> | null",
            description: "What is on the cell.",
            values: [
              { value: "Piece<P>", description: "The piece there. Where its footprint covers several cells, every one of them gives the same piece. A piece this view may not see has an `id` and nothing else. See [`Piece`](/api/sdk#piece)." },
              { value: "null", description: "The cell is empty." },
            ],
          },
          refused: ["The cell is not on the board."],
        },
        {
          name: "terrain",
          kind: "method",
          signature: "terrain(place: Cell<P>): TerrainId<P> | \"plain\" | \"off\"",
          description: "The terrain of a cell.",
          params: [{ name: "place", type: "Cell<P>", description: "A cell, on the board or off it." }],
          returns: {
            type: "TerrainId<P> | \"plain\" | \"off\"",
            description: "What the cell itself is, whatever stands on it.",
            values: [
              { value: "TerrainId<P>", description: "The id of one of the puzzle's [`terrain`](/api/puzzle#terrain)." },
              { value: "\"plain\"", description: "An ordinary cell. Every cell is plain in a puzzle that declares no terrain." },
              { value: "\"off\"", description: "The cell is not on the board. Rules that look a step ahead of a piece need no check of their own for the edge." },
            ],
          },
        },
        {
          name: "terrainState",
          kind: "method",
          signature: "terrainState(place: Cell<P>): string | null",
          description: "The state a cell's terrain is in.",
          params: [{ name: "place", type: "Cell<P>", description: "A cell, on the board or off it." }],
          returns: {
            type: "string | null",
            description: "The state, where the terrain has any.",
            values: [
              { value: "string", description: "One of the states the terrain declares, as a mirror leans one way or the other." },
              { value: "null", description: "The terrain has no states. So it is on a plain cell, and off the board." },
            ],
          },
        },
        {
          name: "touching",
          kind: "method",
          signature: "touching(place: Cell<P>): Cell<P>[]",
          description: "The cells that touch a cell, by the board's own shape.",
          params: [{ name: "place", type: "Cell<P>", description: "A cell on the board." }],
          returns: {
            type: "Cell<P>[]",
            description: "The touching cells that are on the board. On a grid they are the four beside it, or all eight where the puzzle's [`board.touch`](/api/puzzle#board) is 8, listed clockwise from the one above. On rings they are the two around the ring and the ones in and out along the sector.",
          },
          refused: ["The cell is not on the board."],
        },
      ],
    },
  ],
  examples: [
    {
      title: "Every pair side by side",
      puzzle: "swap",
      wrap: "body",
      code: `for (const a of view.board.places()) {
  for (const b of view.board.touching(a)) {
    if (view.board.at(a)?.kind === view.board.at(b)?.kind) continue;
    // a and b hold different kinds
  }
}`,
    },
    {
      title: "Step off a cell safely",
      puzzle: "swap",
      wrap: "body",
      code: `const below = { x: 2, y: view.board.height };
const piece = view.board.has(below) ? view.board.at(below) : null;`,
    },
  ],
};

const zoneMember: Member = {
  name: "zone",
  kind: "method",
  page: true,
  signature: "zone(id: ZoneId<P>, owner?: Seat | Side): readonly Piece<P>[]",
  description: "What a zone holds, in order.",
  about: [
    "A zone is a named place beside the board: a hand, a deck, a tray, the next pair. The puzzle declares each under [`zones`](/api/puzzle#zones), and says whose it is and who sees it.",
    "This reads a zone. To name one as a place for a piece to go, use the function [`zone()`](/api/sdk#zone).",
  ],
  params: [
    { name: "id", type: "ZoneId<P>", description: "The id of one of the puzzle's zones." },
    {
      name: "owner",
      type: "Seat | Side",
      optional: true,
      description: "Whose zone, for a zone each seat or each side has.",
      values: [
        { value: "Seat", description: "A seat, for a zone the puzzle declares one of for each seat." },
        { value: "Side", description: "A side, for a zone it declares one of for each side." },
      ],
      absent: "On a view, the view's own seat, or that seat's side. For a zone the round has one of, nothing is needed.",
      rules: [must("Be given on a context for a zone each seat or each side has. A context is nobody's seat."), never("Be given for a zone the round has one of.")],
    },
  ],
  returns: {
    type: "readonly Piece<P>[]",
    description: "The pieces in the zone, spot 0 first. The list cannot be changed: a piece moves only on an event.",
    values: [
      { value: "Piece<P>", description: "A piece this view may see has its `piece`, `kind` and `state`. One it may not see has its `id` and nothing else, so a hidden hand still shows how many cards it holds." },
      { value: "[]", description: "The zone is empty." },
    ],
  },
  refused: ["The puzzle declares no such zone.", "An owner is missing where one is needed, or given where the round has one zone.", "The owner is not a seat or a side of the round."],
  examples: [
    {
      title: "On a view",
      puzzle: "tricks",
      wrap: "body",
      code: `const mine = view.zone("hand");            // the view's own seat's
const theirs = view.zone("hand", view.next(view.seat!));
const count = theirs.length;               // seen
const first = theirs[0]?.kind;             // undefined: the card is hidden`,
    },
    {
      title: "On a context",
      puzzle: "tricks",
      wrap: "body",
      code: `const trick = ctx.zone("trick");
const hand = ctx.zone("hand", seat);
const won = ctx.zone("won", ctx.sideOf(seat));`,
    },
  ],
};

const allowed: Member = {
  name: "allowed",
  kind: "method",
  page: true,
  signature: "allowed(move: Move<P>): string | null",
  description: "Asks `canMove` again, for this view's seat.",
  about: ["It runs the whole check, the loop's part included: whether the seat is awaited, whether the open phase takes the move, and then the puzzle's own `canMove`."],
  params: [{ name: "move", type: "Move<P>", description: "A move to ask about." }],
  returns: {
    type: "string | null",
    description: "Whether this seat may make the move now.",
    values: [
      { value: "null", description: "It may." },
      { value: "string", description: "It may not, and this is why: the loop's reason, or the one `canMove` gave." },
    ],
  },
  rules: [never("Call it from `canMove` with the same move. The hook would ask itself without end.")],
  refused: ["The view is the table's: its `seat` is `null`, so there is no seat to ask for."],
  examples: [
    {
      title: "Keep only what may be played",
      puzzle: "tricks",
      wrap: "body",
      code: `const playable = view
  .zone("hand")
  .map((card): Move<Tricks> => ({ move: "play", card: card.id }))
  .filter((move) => view.allowed(move) === null);`,
    },
  ],
};

const tryMember: Member = {
  name: "try",
  kind: "method",
  page: true,
  signature: "try(move: Move<P>): Tried<P, S>",
  description: "Plays a move on a copy of the round and gives back what came of it.",
  about: [
    "The copy runs the move as the loop would: `onMove`, the whole cascade, `onMoveEnd` and the close. The round itself is untouched.",
    "The copy draws from a throwaway stream. So trying never shows the luck to come, and never shifts the deal. Two tries of one move may meet different luck.",
    "`pickMove`, `hint`, a preview and the four stand-in types all try moves this one way.",
  ],
  params: [{ name: "move", type: "Move<P>", description: "A move `allowed` passes." }],
  returns: {
    type: "Tried<P, S>",
    description: "What came of the move. See [`Tried`](/api/sdk#tried).",
    values: [
      { value: "events", description: "Every event the move caused, in order, as this view's seat would see them." },
      { value: "points", description: "The points those events pay this view's seat, or its side where accounts are a side's." },
      { value: "view", description: "This seat's view afterwards. It can be tried from again, to look further ahead." },
    ],
  },
  rules: [
    must("Pass a move `allowed` answers `null` for."),
    only("A puzzle where the seat sees every place. Trying a move where a seat cannot see everything is not settled yet, and such a puzzle brings its own stand-in."),
  ],
  refused: ["The move is not allowed.", "The view is the table's: its `seat` is `null`."],
  examples: [
    {
      title: "Look two moves ahead",
      puzzle: "swap",
      wrap: "body",
      given: "declare const first: Move<Swap>;\ndeclare const second: Move<Swap>;",
      code: `const one = view.try(first);
const two = one.view.allowed(second) === null ? one.view.try(second) : null;
const total = one.points + (two?.points ?? 0);`,
    },
  ],
};

const next: Member = {
  name: "next",
  kind: "method",
  page: true,
  signature: "next(seat: Seat): Seat",
  description: "The next seat clockwise.",
  params: [{ name: "seat", type: "Seat", description: "A seat of the round." }],
  returns: { type: "Seat", description: "The seat after it, going round. After the last seat comes seat 0. A seat that sits out is not skipped: only the loop's own default for `whoseTurn` skips one. In a solo puzzle it is the same seat." },
  refused: ["The seat is not in the round."],
};

const sideOf: Member = {
  name: "sideOf",
  kind: "method",
  page: true,
  signature: "sideOf(seat: Seat): Side",
  description: "The side a seat is on.",
  params: [{ name: "seat", type: "Seat", description: "A seat of the round." }],
  returns: { type: "Side", description: "The seat's side. In a solo puzzle it is 0. Where every seat plays for itself, it is the seat's own number." },
  refused: ["The seat is not in the round."],
};

const seatsOf: Member = {
  name: "seatsOf",
  kind: "method",
  page: true,
  signature: "seatsOf(side: Side): readonly Seat[]",
  description: "The seats of a side.",
  params: [{ name: "side", type: "Side", description: "A side of the round." }],
  returns: { type: "readonly Seat[]", description: "The side's seats, lowest first. It always holds at least one." },
  refused: ["The side is not in the round."],
};

const state: Member = {
  name: "state",
  kind: "property",
  signature: "readonly state: Readonly<S>",
  description: "The rules' own state, as the last `on` hook left it.",
  about: ["It is always public: every seat's view holds all of it. Anything a seat must not see is a piece in a place that seat cannot see, with no exception."],
  rules: [never("Change it in place. An `on` hook returns the next state.")],
};

const settings: Member = {
  name: "settings",
  kind: "property",
  signature: "readonly settings: Settings<P>",
  description: "This round's value for every setting, by id. See [`Settings`](/api/sdk#settings).",
  about: ["It is the same for the whole round. A setting a seat has for itself is read for the view's seat."],
};

const phase: Member = {
  name: "phase",
  kind: "property",
  signature: "readonly phase: PhaseId<P> | null",
  description: "The open phase, innermost.",
  returns: {
    type: "PhaseId<P> | null",
    description: "",
    values: [
      { value: "PhaseId<P>", description: "The id of the innermost open phase: in a trick of a hand, the trick." },
      { value: "null", description: "No phase is open: the puzzle declares none, or the round is in `onStart`." },
    ],
  },
};

const score: Member = {
  name: "score",
  kind: "property",
  signature: "readonly score: number",
  description: "The points banked so far. A move's points are banked when it closes, so within a move this is the score before it.",
};

const streak: Member = {
  name: "streak",
  kind: "property",
  signature: "readonly streak: number",
  description: "The [streak](/api/puzzle#streak)'s count: moves, or tasks, in a row that built it. It is 0 in a puzzle with no streak. It moves when a move closes, so within a move it is the count the move started on.",
};

const on: Member = {
  name: "on",
  kind: "method",
  signature: "on(layer: LayerId<P>): boolean",
  description: "Whether a [layer](/api/puzzle#layers) is on at the stage the round is played at.",
  about: [
    "A part that a stage switches on is never asked while it is off, so no part tests whether it is on itself. `on` is for the part that deals what a later layer brings: a refill that deals a prize only once the prizes layer is on.",
    "A stage is chosen when a round starts and holds for the whole round, so the answer never changes within one.",
  ],
  params: [{ name: "layer", type: "LayerId<P>", description: "The id of one of the puzzle's layers. A part's layer has the part's name." }],
  returns: {
    type: "boolean",
    description: "Whether the layer is on.",
    values: [
      { value: "true", description: "The round's stage has reached the layer. Everything it brings exists." },
      { value: "false", description: "It has not. An event or a draw the layer brings is refused." },
    ],
  },
};

const value: Member = {
  name: "value",
  kind: "method",
  signature: "value(id: CountId<P>): number",
  description: "What a [gauge](/api/puzzle#gauges) or a [stat](/api/puzzle#stats) stands at.",
  about: ["The engine keeps every gauge and stat. The rules set one on an event with [`set`](/api/context#e-set) and read it back here, so a count is never kept twice."],
  params: [{ name: "id", type: "CountId<P>", description: "The id of one of the puzzle's gauges or stats." }],
  returns: { type: "number", description: "Its value. One that nothing has set stands at 0. The gauge `streak` is the streak's count, and the stat `best_streak` is the longest it has stood." },
};

const task: Member = {
  name: "task",
  kind: "method",
  signature: "task(id: TaskId<P>): OpenTask | null",
  description: "The open [task](/api/puzzle#tasks) of that id.",
  params: [{ name: "id", type: "TaskId<P>", description: "The id of one of the puzzle's tasks." }],
  returns: {
    type: "OpenTask | null",
    description: "The task, with what it holds. See [`OpenTask`](/api/sdk#opentask).",
    values: [
      { value: "OpenTask", description: "The one opened first, where several of that id are open." },
      { value: "null", description: "None is open." },
    ],
  },
};

const repeat: Member = {
  name: "repeat",
  kind: "property",
  signature: "readonly repeat: number",
  description: "Which repeat of the open phase this is, counted from 0. It is 0 where no phase is open, and in a phase that runs once.",
};

const lastSeat: Member = {
  name: "lastSeat",
  kind: "property",
  signature: "readonly lastSeat: Seat | null",
  description: "The seat that moved last in the open phase.",
  returns: {
    type: "Seat | null",
    description: "",
    values: [
      { value: "Seat", description: "The seat whose move was made last." },
      { value: "null", description: "Nobody has moved since the phase opened, or since the round started where there are no phases." },
    ],
  },
};

const seat: Member = {
  name: "seat",
  kind: "property",
  signature: "readonly seat: Seat | null",
  description: "The seat this view is for.",
  returns: {
    type: "Seat | null",
    description: "",
    values: [
      { value: "Seat", description: "The view holds what this seat may see: every public place, its own zones and its side's." },
      { value: "null", description: "The table's public view: only what every seat may see. `whoseTurn` is asked with it." },
    ],
  },
};

export const VIEW_ROOT: SdkRoot = {
  root: "view",
  name: "View",
  title: "The view",
  lede: "What one seat may see of a round. Every question is asked with one, so a stand-in or a hint cannot cheat by accident.",
  about: [
    "A view is given to every hook that is a question: `canMove`, `whoseTurn`, `pickMove`, `listMoves`, `worth` and `hint`, and any question a puzzle adds.",
    "There is nowhere in a view to read a piece its seat may not see. Such a piece is still there, so that it can be counted and pointed at, but it has an `id` and nothing else.",
    "A view cannot change a round. It has no `emit` and no `draw`.",
  ],
  groups: [
    { title: "Whose it is", members: [seat] },
    { title: "The round", members: [state, settings, score, streak, on, value, task, phase, repeat, lastSeat] },
    { title: "The table", members: [board, zoneMember] },
    { title: "Moves", members: [allowed, tryMember] },
    { title: "Seats and sides", members: [next, sideOf, seatsOf] },
  ],
  holds: {
    title: "What holds for every view",
    items: [
      "Reading a view changes nothing. Every member can be read at any time, any number of times.",
      "A view is of one moment. It does not follow the round: a hook is handed a fresh one each time it is asked.",
      "What a seat cannot see, its view does not hold. That is kept by the engine, from who the puzzle says sees each [zone](/api/puzzle#zones), and no rules file writes code to hide anything.",
      "The rules' state is in every view, whole. A secret is never kept in the state.",
    ],
  },
  example: {
    title: "A question reads a view",
    puzzle: "tricks",
    wrap: "rules",
    code: `canMove: {
  bid: (view, { tricks }) => (tricks > view.zone("hand").length ? "that is more tricks than cards" : null),
  play(view, { card }) {
    if (view.phase !== "trick") return "wait for the bids";
    const mine = view.zone("hand").some((c) => c.id === card);
    return mine ? null : "that card is not in your hand";
  },
}`,
  },
};

// ---- the context

const draw: Member = {
  name: "draw",
  kind: "method",
  page: true,
  signature: "draw(id: DrawId<P>): Draw",
  description: "One of the puzzle's draws: a source of luck.",
  about: [
    "All luck in a round comes from a draw. The puzzle declares each under [`deal.draws`](/api/puzzle#deal-draws), with what it decides and how.",
    "Every draw has a stream of its own, made from the round's seed and the draw's id. Nothing a draw gives depends on another draw, so a move that changes what one draw is asked for never changes what the others give.",
    "Each call takes the next value from the stream. The same seed, settings and log always ask the same draws in the same order, so they always get the same values.",
  ],
  params: [{ name: "id", type: "DrawId<P>", description: "The id of one of the puzzle's draws." }],
  returns: { type: "Draw", description: "The draw. Its four members are below. Calling `draw` again with the same id gives the same stream, carried on from where it was." },
  rules: [
    must("Ask a draw the way the puzzle declares it [`by`](/api/puzzle#deal-draws): `even` for an even roll, `chance` or `pick` for a weighted roll, `next` for a bag, `pick` for a pick."),
    never("Keep a `Draw` in the state, or ask one from a question. A view has no draws."),
  ],
  refused: ["The puzzle declares no such draw.", "The draw belongs to a layer the round's stage has not reached."],
  members: [
    {
      title: "On a draw",
      name: "draw",
      members: [
        {
          name: "even",
          kind: "method",
          signature: "even(n: number): number",
          description: "A whole number, each alike.",
          params: [{ name: "n", type: "number", description: "How many values there are to choose from. A whole number of 1 or more.", rules: [must("Be a whole number of 1 or more.")] }],
          returns: { type: "number", description: "A whole number from 0 up to, and not including, `n`. Add 1 for a kind, which is counted from 1." },
          refused: ["`n` is less than 1 or is not a whole number."],
        },
        {
          name: "chance",
          kind: "method",
          signature: "chance(permille: number): boolean",
          description: "Yes or no, by a chance.",
          params: [{ name: "permille", type: "number", description: "The chance of yes, in thousandths: a whole number from 0 to 1000. A `permille` setting is read as it is.", rules: [must("Be a whole number from 0 to 1000.")] }],
          returns: {
            type: "boolean",
            description: "",
            values: [
              { value: "true", description: "That many times in a thousand. Always, at 1000." },
              { value: "false", description: "Every other time. Always, at 0." },
            ],
          },
          refused: ["`permille` is below 0, above 1000, or is not a whole number."],
        },
        {
          name: "pick",
          kind: "method",
          signature: "pick<T>(list: readonly T[]): T",
          description: "One entry of a list, each alike.",
          params: [{ name: "list", type: "readonly T[]", description: "The entries to pick from: a list setting, the puzzle's maps, a list the rules build.", rules: [must("Hold at least one entry.")] }],
          returns: { type: "T", description: "One of the entries. An entry written twice is twice as likely." },
          refused: ["The list is empty."],
        },
        {
          name: "next",
          kind: "method",
          signature: "next(): number",
          description: "The next item of a bag.",
          about: ["A bag is a shuffled set dealt out in order, then shuffled again. Every run of the set's length holds each item once, so no item stays away for long."],
          returns: { type: "number", description: "The item's number, counted from 0, among those the draw [`gives`](/api/puzzle#deal-draws)." },
          refused: ["The draw is not declared `by` a bag."],
        },
      ],
    },
  ],
  examples: [
    {
      title: "A kind, and a chance",
      puzzle: "swap",
      wrap: "body",
      code: `const kind = 1 + ctx.draw("fill").even(ctx.settings.kinds);
const lucky = ctx.draw("rise").chance(35);
const percent = ctx.draw("rise").pick(ctx.settings.cascadePercent);`,
    },
  ],
};

const emit: Member = {
  name: "emit",
  kind: "method",
  page: true,
  signature: "emit<E extends EventId<P>>(id: E, fields: EventFields<P, E>, changes?: (e: Changes<P>) => void): void",
  description: "Reports an event. It is the one way the rules change a round.",
  about: [
    "An event is something the rules say happened. The puzzle declares each under [`events`](/api/puzzle#events): its fields, the board changes it can carry, and what it closes or reveals.",
    "The engine applies an event as it is reported. The lines after an `emit` read the board, the zones and `ctx.step` as that event left them.",
    "Everything else follows from events. The loop pays the payouts that name an event, keeps the streak, counts a cascade's steps, closes a phase, meets an ending and grades a task, all from what was reported. A board plays from events and from nothing else.",
  ],
  params: [
    { name: "id", type: "E", description: "The id of one of the puzzle's events." },
    {
      name: "fields",
      type: "EventFields<P, E>",
      description: "A value for every field the puzzle declares for the event. An event with no fields takes `{}`. See [`EventFields`](/api/sdk#eventfields).",
      rules: [never("Give a field typed `points`. The engine fills it in when it pays the event."), must("Give every other field. A field left out does not compile.")],
    },
    {
      name: "changes",
      type: "(e: Changes<P>) => void",
      optional: true,
      description: "A function that says what the event changes, through the builder `e`. It is called once, at once, before `emit` returns.",
      absent: "The event changes nothing on the table. It is still reported, paid and played.",
    },
  ],
  returns: { type: "void", description: "Nothing. The event is applied by the time `emit` returns." },
  rules: [
    must("Report a change with the event that causes it. A board draws each event's changes together, as one beat."),
    never("Call `emit` inside another `emit`'s `changes`. An event is finished before the next begins."),
    never("Keep the builder `e` after `changes` returns."),
  ],
  refused: [
    "The puzzle declares no such event.",
    "A field is missing, is of the wrong type, or names a place that is not on the board.",
    "A board change is made that the event is not declared to carry in its [`changes`](/api/puzzle#events).",
    "The round has ended and the hook is not `onEnd`.",
  ],
  members: [
    {
      title: "Board changes",
      name: "e",
      note: "Everything that happens on a board is one of four changes: arrive, leave, travel and change. The puzzle says which of them each event can carry, and one it does not list is refused. Each returns `e`, so changes chain.",
      members: [
        {
          name: "arrive",
          kind: "method",
          signature: "arrive(place: Cell<P>, piece: NewPiece<P>, from?: Edge | \"in place\" | Spot): this",
          description: "Puts a new piece on the board.",
          params: [
            { name: "place", type: "Cell<P>", description: "The cell it lands on. For a piece with a footprint, the cell its footprint is counted from." },
            { name: "piece", type: "NewPiece<P>", description: "What the piece is: which of the puzzle's pieces, its kind, its state. The engine gives it its id. See [`NewPiece`](/api/sdk#newpiece)." },
            {
              name: "from",
              type: "Edge | \"in place\" | Spot",
              optional: true,
              description: "Where it comes from. It decides how a board plays the arrival, and nothing else.",
              absent: "The same as `\"in place\"`.",
              values: [
                { value: "\"in place\"", description: "It appears where it lands." },
                { value: "\"above\"", description: "It comes in from off the board, above its cell." },
                { value: "\"below\"", description: "From off the board, below its cell." },
                { value: "\"left\"", description: "From off the board, to the left." },
                { value: "\"right\"", description: "From off the board, to the right." },
                { value: "Spot", description: "From a spot in a zone, as a plate comes from a tray. The piece at that spot leaves the zone and keeps its id. `piece` must match it." },
              ],
            },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The event is not declared to carry `arrive`.", "The cell is not on the board, or any cell of the footprint already holds a piece.", "The piece is not one the puzzle declares, its kind is out of range, or its state is not one of its states."],
        },
        {
          name: "leave",
          kind: "method",
          signature: "leave(place: Cell<P>, to?: Spot): this",
          description: "Takes a piece off the board.",
          params: [
            { name: "place", type: "Cell<P>", description: "A cell the piece stands on." },
            { name: "to", type: "Spot", optional: true, description: "A spot in a zone it is taken to. It keeps its id there.", absent: "The piece is cleared. It is gone from the round, and its id is never used again." },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The event is not declared to carry `leave`.", "The cell is empty or is not on the board.", "The spot is taken, or is past the zone's size."],
        },
        {
          name: "travel",
          kind: "method",
          signature: "travel(from: Cell<P>, to: Cell<P>, route?: readonly Cell<P>[]): this",
          description: "Moves a piece from one cell to another.",
          about: ["Travels on one event happen together. So two pieces may trade cells, and a whole column may fall a row, without one landing on another."],
          params: [
            { name: "from", type: "Cell<P>", description: "The cell the piece stands on." },
            { name: "to", type: "Cell<P>", description: "The cell it ends on." },
            { name: "route", type: "readonly Cell<P>[]", optional: true, description: "The cells it passes through on the way, in order, not counting the first and the last.", absent: "It goes straight there. A board plays it as one slide." },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The event is not declared to carry `travel`.", "`from` is empty, or either cell is not on the board.", "When every travel of the event is done, two pieces stand on one cell."],
        },
        {
          name: "send",
          kind: "method",
          signature: "send(piece: PieceId, to: ZoneRef): this",
          description: "Moves a piece that is in a zone to another zone. It is a travel, and the event must carry `travel`.",
          params: [
            { name: "piece", type: "PieceId", description: "The id of a piece in a zone. A hidden piece may be sent: its id is all a hook needs." },
            { name: "to", type: "ZoneRef", description: "The zone it goes to, made with [`zone()`](/api/sdk#zone). It takes the first free spot." },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The event is not declared to carry `travel`.", "The piece is not in a zone, or the zone it goes to is full or not declared."],
        },
        {
          name: "change",
          kind: "method",
          signature: "change(place: Cell<P>, to: Change<P>): this",
          description: "A piece's state or kind, or a cell's terrain, becomes another where it stands.",
          params: [
            { name: "place", type: "Cell<P>", description: "The cell of the piece, or the cell whose terrain changes." },
            {
              name: "to",
              type: "Change<P>",
              description: "What it becomes. See [`Change`](/api/sdk#change).",
              values: [
                { value: "{ piece?, kind?, state? }", description: "The piece on the cell becomes this, and keeps its id. Naming a `piece` makes it that piece, whole: a kind or a state left out is gone. Naming only a kind or a state changes that alone." },
                { value: "{ terrain, state? }", description: "The cell's terrain becomes this, whatever stands on it. A terrain with states takes the state named, or its first." },
              ],
            },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The event is not declared to carry `change`.", "A piece is changed on an empty cell.", "The piece, kind, state or terrain is not one the puzzle declares."],
        },
      ],
    },
    {
      title: "On an event",
      name: "e",
      note: "An event may do seven more things. Each is refused when it names something the puzzle does not declare.",
      members: [
        {
          name: "set",
          kind: "method",
          signature: "set(id: CountId<P>, value: number): this",
          description: "Sets a gauge or a stat to a value.",
          about: ["The event carries what it set, so a screen that sees only events can show every number. Read the old value with [`value`](/api/view#value) to add to it."],
          params: [
            { name: "id", type: "CountId<P>", description: "The id of one of the puzzle's gauges or stats." },
            { name: "value", type: "number", description: "What it stands at from now on." },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The puzzle declares no such gauge or stat.", "It is `streak` or `best_streak`, which the engine keeps.", "It belongs to a layer that is off."],
        },
        {
          name: "open",
          kind: "method",
          signature: "open(task: TaskId<P>, holds?: { readonly [name: string]: unknown }): this",
          description: "Opens a task, with what it holds.",
          about: ["It is what [`onTaskNeeded`](/api/hooks#ontaskneeded) reports. The event that opens a task is the one a board shows it on."],
          params: [
            { name: "task", type: "TaskId<P>", description: "The id of one of the puzzle's tasks." },
            { name: "holds", type: "{ readonly [name: string]: unknown }", optional: true, description: "Whatever the rules must remember of this task, such as the kind a bounty names.", absent: "The task holds nothing." },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The puzzle declares no such task.", "As many are open as the task's [`open`](/api/puzzle#tasks) allows."],
        },
        {
          name: "done",
          kind: "method",
          signature: "done(task: TaskId<P>): this",
          description: "Finishes the open task of that id.",
          params: [{ name: "task", type: "TaskId<P>", description: "The id of the task. Where several of that id are open, the one opened first is finished." }],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["No task of that id is open."],
        },
        {
          name: "deal",
          kind: "method",
          signature: "deal(from: ZoneRef | DrawId<P>, to: ZoneRef | Cell<P>, count?: number): this",
          description: "Puts pieces from a draw or a zone straight into a place. The hook never learns what was dealt.",
          about: ["It is how anything hidden is dealt. A hand dealt this way is known to its seat and to nobody else, the rules included."],
          params: [
            {
              name: "from",
              type: "ZoneRef | DrawId<P>",
              description: "Where the pieces come from.",
              values: [
                { value: "DrawId<P>", description: "A draw that gives pieces. Each piece is drawn as it is dealt." },
                { value: "ZoneRef", description: "A zone. Its pieces are taken from spot 0 on, as cards come off a deck." },
              ],
            },
            {
              name: "to",
              type: "ZoneRef | Cell<P>",
              description: "Where they go.",
              values: [
                { value: "ZoneRef", description: "A zone. Each piece takes the next free spot." },
                { value: "Cell<P>", description: "A cell of the board. Only one piece can be dealt to a cell." },
              ],
            },
            { name: "count", type: "number", optional: true, description: "How many pieces.", absent: "One." },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The draw or the zone is not declared.", "The draw does not give pieces.", "There are fewer pieces to take than `count`, or less room than `count`."],
        },
        {
          name: "peek",
          kind: "method",
          signature: "peek(piece: PieceId): Piece<P>",
          description: "Reads a piece the table cannot see.",
          about: ["A secret only ever comes out on an event. Peeking is how the rules read a hidden card at the moment the event shows it."],
          params: [{ name: "piece", type: "PieceId", description: "The id of a piece in a place this event reveals." }],
          returns: { type: "Piece<P>", description: "The piece, with its `piece`, `kind` and `state`. It is the one member of the builder that does not return `e`." },
          rules: [only("An event the puzzle declares to reveal the piece's place, in its [`reveals`](/api/puzzle#events).")],
          refused: ["The event is not declared to reveal the place the piece is in."],
        },
        {
          name: "sitOut",
          kind: "method",
          signature: "sitOut(seat: Seat, phase?: PhaseId<P>): this",
          description: "A seat sits out of a phase, or is out of the round.",
          params: [
            { name: "seat", type: "Seat", description: "The seat that sits out. The loop never waits for it." },
            { name: "phase", type: "PhaseId<P>", optional: true, description: "The phase it sits out of, which must be open. It is back when that phase closes.", absent: "The seat is out of the round." },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The seat is not in the round.", "The phase is not open."],
        },
        {
          name: "pay",
          kind: "method",
          signature: "pay(payout: PayoutId<P>, to: Seat | Side): this",
          description: "Pays a declared payout to a seat or a side.",
          about: ["Most payouts need no call: the loop pays every payout whose [`on`](/api/puzzle#payouts) names the event, to the seat that moved. `pay` is for a payout that goes to someone else, or that only the rules know is due."],
          params: [
            { name: "payout", type: "PayoutId<P>", description: "The id of one of the puzzle's payouts." },
            {
              name: "to",
              type: "Seat | Side",
              description: "Whose account it is paid into.",
              values: [
                { value: "Seat", description: "A seat's account." },
                { value: "Side", description: "A side's account, which its seats share." },
              ],
              rules: [must("Be a seat where [`points.to`](/api/puzzle#points) is `seat`, and a side where it is `side`.")],
            },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The puzzle declares no such payout.", "The account is not in the round."],
        },
      ],
    },
    {
      title: "Zones of cards",
      name: "e",
      note: "Two more keep a deck short to write.",
      members: [
        {
          name: "gather",
          kind: "method",
          signature: "gather(into: ZoneRef, ...from: ZoneRef[]): this",
          description: "Brings every piece of the named zones into one.",
          params: [
            { name: "into", type: "ZoneRef", description: "The zone they are brought into." },
            { name: "from", type: "ZoneRef[]", description: "The zones they are taken from, emptied in the order given." },
          ],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["A zone is not declared, or the pieces do not fit."],
        },
        {
          name: "shuffle",
          kind: "method",
          signature: "shuffle(zone: ZoneRef): this",
          description: "Shuffles a zone, with the draw the puzzle declares for it.",
          params: [{ name: "zone", type: "ZoneRef", description: "The zone to shuffle. Every piece stays in it, and takes a new spot." }],
          returns: { type: "this", description: "The builder, to chain." },
          refused: ["The puzzle declares no draw that shuffles this zone."],
        },
      ],
    },
  ],
  examples: [
    {
      title: "An event with no change",
      puzzle: "tricks",
      wrap: "body",
      code: `ctx.emit("bid", { seat, tricks: 3 });`,
    },
    {
      title: "Two pieces trade cells",
      puzzle: "swap",
      wrap: "body",
      given: "declare const a: GridCell;\ndeclare const b: GridCell;",
      code: `ctx.emit("swap", { a, b }, (e) => e.travel(a, b).travel(b, a));`,
    },
    {
      title: "A field typed points is left out",
      note: "`clear` declares `pieces`, `size` and `points`. The engine fills `points` when it pays.",
      puzzle: "swap",
      wrap: "body",
      given: "declare const group: GridCell[];",
      code: `ctx.emit("clear", { pieces: group, size: group.length }, (e) => {
  for (const place of group) e.leave(place);
});`,
    },
    {
      title: "Deal a hidden hand",
      puzzle: "tricks",
      wrap: "body",
      code: `ctx.emit("dealt", { seat }, (e) => e.deal("shuffle", zone("hand", seat), 13));`,
    },
  ],
};

const inherited = (name: string, description: string, signature: string): Member => ({ name, kind: signature.includes("(") ? "method" : "property", signature, description, from: "view" });

export const CONTEXT_ROOT: SdkRoot = {
  root: "context",
  name: "Ctx",
  title: "The context",
  lede: "What a hook that starts with `on` is handed: the whole table, the puzzle's draws, and `emit`.",
  about: [
    "A context is given to every hook that starts with `on`. It has what a [view](/api/view) has, for the whole table and not one seat, and adds the two things that change a round: [`draw`](/api/context#draw) and [`emit`](/api/context#emit).",
    "A context sees the table, and still not what is hidden. A piece nobody sees has an `id` and nothing else even here, and is read only by [peeking](/api/context#e-peek) on an event that reveals it.",
    "A context has no `seat`, no `allowed` and no `try`. Those belong to a seat's view.",
  ],
  groups: [
    {
      title: "Its own",
      members: [
        { name: "seats", kind: "property", signature: "readonly seats: readonly Seat[]", description: "Every seat in the round, lowest first. A seat that is out of the round is still listed. A solo puzzle has one seat, 0." },
        { name: "sides", kind: "property", signature: "readonly sides: readonly Side[]", description: "Every side in the round, lowest first. A solo puzzle has one side, 0." },
        {
          name: "step",
          kind: "property",
          signature: "readonly step: number",
          description: "The cascade step the loop has counted for the move being played. It is 0 until an event marked [`step`](/api/puzzle#events) is reported, and grows by one for each asking of `onCascade` that reports one.",
        },
        {
          name: "pending",
          kind: "property",
          signature: "readonly pending: number",
          description: "What the move being played would bank if it closed now: everything it has reported so far, with every multiplier, rounded down once. A rule that answers the score in the middle of a move reads it, as a heat that falls with the points a move earns does.",
        },
        draw,
        emit,
      ],
    },
    {
      title: "Shared with a view",
      note: "These are a view's, read for the whole table. Each is defined on the [view](/api/view).",
      members: [
        inherited("state", "The rules' own state, as the last `on` hook left it.", "readonly state: Readonly<S>"),
        inherited("settings", "This round's value for every setting, by id.", "readonly settings: Settings<P>"),
        inherited("score", "The points banked so far.", "readonly score: number"),
        inherited("streak", "The streak's count.", "readonly streak: number"),
        inherited("on", "Whether a layer is on at the round's stage.", "on(layer: LayerId<P>): boolean"),
        inherited("value", "What a gauge or a stat stands at.", "value(id: CountId<P>): number"),
        inherited("task", "The open task of that id, or `null`.", "task(id: TaskId<P>): OpenTask | null"),
        inherited("phase", "The open phase, innermost, or `null`.", "readonly phase: PhaseId<P> | null"),
        inherited("repeat", "Which repeat of the open phase this is, from 0.", "readonly repeat: number"),
        inherited("lastSeat", "The seat that moved last in the open phase, or `null`.", "readonly lastSeat: Seat | null"),
        inherited("board", "The board. Where each seat has one, the board of the seat that is moving.", "readonly board: Board<P>"),
        inherited("zone", "What a zone holds. The owner must be given for a zone each seat or each side has.", "zone(id: ZoneId<P>, owner?: Seat | Side): readonly Piece<P>[]"),
        inherited("next", "The next seat clockwise.", "next(seat: Seat): Seat"),
        inherited("sideOf", "The side a seat is on.", "sideOf(seat: Seat): Side"),
        inherited("seatsOf", "The seats of a side.", "seatsOf(side: Side): readonly Seat[]"),
      ],
    },
  ],
  holds: {
    title: "What holds for every context",
    items: [
      "A context is for the length of one hook. Keeping it, or anything taken from it but plain values, past the hook's return is refused.",
      "Everything it reads is as the last reported event left it.",
      "It can change the round through `emit` and nothing else. `draw` changes only where a stream has got to.",
      "The engine keeps what a context does not offer: the log, time, who is awaited, phases, points, the streak, tasks and the endings. No rules file writes any of them.",
    ],
  },
  example: {
    title: "An `on` hook uses a context",
    puzzle: "swap",
    wrap: "rules",
    code: `onCascade(ctx) {
  if (ctx.board.places().every((p) => ctx.board.at(p))) return;
  ctx.emit("rise", {}, (e) => {
    for (let x = 0; x < ctx.board.width; x++) {
      let top = 0;
      for (let y = 0; y < ctx.board.height; y++) {
        if (!ctx.board.at({ x, y })) continue;
        if (y !== top) e.travel({ x, y }, { x, y: top });
        top++;
      }
      for (let y = top; y < ctx.board.height; y++) {
        const kind = 1 + ctx.draw("rise").even(ctx.settings.kinds);
        e.arrive({ x, y }, { piece: "kind", kind }, "below");
      }
    }
  });
}`,
  },
};
