import { must, never, type Member, type Param, type TypeDef, type Value } from "./types.js";

/** The two functions a rules file calls, and every type the SDK names, down to what each is made of. */

export const FUNCTIONS: readonly Member[] = [
  {
    name: "defineRules",
    kind: "function",
    signature: "defineRules<P extends Puzzle, S>(rules: Rules<P, S>): Rules<P, S>",
    description: "Types a rules object against its puzzle. A rules file's default export is what it returns.",
    about: [
      "It does nothing at run time: it gives back the object it was handed. What it does is let the compiler check every hook against the puzzle's type, so a draw, an event or a zone the puzzle does not declare fails to compile.",
      "Both types are always written. `P` cannot be worked out from the hooks, and `S` should be said once, in one place.",
    ],
    params: [
      { name: "P", type: "Puzzle", description: "The puzzle's own type, made from its puzzle file and imported from `./<id>.puzzle.gen`. See [`Puzzle`](#puzzle)." },
      { name: "S", type: "any plain data", description: "The rules' own state: whatever the puzzle must remember that the engine does not already keep. Many puzzles use `{}`.", rules: [must("Be plain data: numbers, strings, booleans, `null`, and arrays and objects of them. No class, function, `Map`, `Set` or `Date`. The engine copies and compares it."), never("Hold a secret. The state is in every seat's view.")] },
      { name: "rules", type: "Rules<P, S>", description: "The hooks. See [the rules object](/reference/hooks)." },
    ],
    returns: { type: "Rules<P, S>", description: "The same object, typed." },
    examples: [
      {
        title: "A rules file",
        puzzle: "swap",
        wrap: "file",
        code: `import { defineRules } from "@openseas/puzzle";
import type { Swap } from "./swap.puzzle.gen";

type State = { swaps: number };

export default defineRules<Swap, State>({
  onStart: () => ({ swaps: 0 }),
  canMove: () => null,
  onMove: (ctx) => ({ swaps: ctx.state.swaps + 1 }),
});`,
      },
    ],
  },
  {
    name: "zone",
    kind: "function",
    signature: "zone<P extends Puzzle = Puzzle>(id: ZoneId<P>, owner?: Seat | Side): ZoneRef",
    description: "Names a zone, as a place for an event to send or deal a piece to.",
    about: ["It names a zone and reads nothing. To read what a zone holds, use a view's or a context's [`zone`](/reference/view#zone)."],
    params: [
      { name: "id", type: "ZoneId<P>", description: "The id of one of the puzzle's zones. Written `zone<Tricks>(\"hand\", seat)`, a wrong id does not compile. Without the type, any string is taken and the engine checks it when the event is reported." },
      { name: "owner", type: "Seat | Side", optional: true, description: "Whose zone, for a zone each seat or each side has.", values: [{ value: "Seat", description: "A seat, for a zone each seat has." }, { value: "Side", description: "A side, for a zone each side has." }], absent: "The zone is the round's.", rules: [must("Be given for a zone each seat or each side has, and left out for one the round has.")] },
    ],
    returns: { type: "ZoneRef", description: "The zone's name and owner as plain data. See [`ZoneRef`](#zoneref)." },
    examples: [
      {
        title: "Three zones",
        puzzle: "tricks",
        wrap: "body",
        code: `zone("deck");            // the round's
zone("hand", seat);      // one seat's
zone<Tricks>("won", side); // one side's, with the id checked`,
      },
    ],
  },
];

const idRow = (name: string, of: string, where: string): Value => ({ value: name, description: `The id of one of the puzzle's ${of}, declared under ${where}.` });

export const ID_TYPES: readonly Value[] = [
  idRow("MoveId<P>", "moves", "[`moves`](/reference/puzzle#moves)"),
  idRow("EventId<P>", "events", "[`events`](/reference/puzzle#events)"),
  idRow("SignalId<P>", "signals in", "[`signals.in`](/reference/puzzle#signals)"),
  idRow("PhaseId<P>", "phases, however deep", "[`round.phases`](/reference/puzzle#round-phases)"),
  idRow("ZoneId<P>", "zones", "[`zones`](/reference/puzzle#zones)"),
  idRow("DrawId<P>", "draws", "[`deal.draws`](/reference/puzzle#deal-draws)"),
  idRow("PayoutId<P>", "payouts", "[`payouts`](/reference/puzzle#payouts)"),
  idRow("EndingId<P>", "endings", "[`round.ends`](/reference/puzzle#round-ends)"),
  idRow("StandInId<P>", "own stand-ins", "[`opponents.standIns`](/reference/puzzle#opponents-standins)"),
  idRow("TerrainId<P>", "terrain", "[`terrain`](/reference/puzzle#terrain)"),
  idRow("LayerId<P>", "layers", "[`layers`](/reference/puzzle#layers)"),
  idRow("CountId<P>", "gauges and stats", "[`gauges`](/reference/puzzle#gauges) and [`stats`](/reference/puzzle#stats)"),
  idRow("TaskId<P>", "tasks", "[`tasks`](/reference/puzzle#tasks)"),
];

const P = (name: string, type: string, description: string, extra: Partial<Param> = {}): Param => ({ name, type, description, ...extra });

export interface TypeGroup {
  readonly title: string;
  readonly note?: string;
  readonly types: readonly TypeDef[];
}

export const TYPE_GROUPS: readonly TypeGroup[] = [
  {
    title: "The puzzle's type",
    note: "Every type below that takes `P` reads it from the puzzle's own type. That type is made from the puzzle file by a tool, into `<id>.puzzle.gen.ts`, and is never written by hand.",
    types: [
      {
        name: "Puzzle",
        definition: "",
        description: "The shape every puzzle's type has. A puzzle's own type narrows each member to exactly what its file declares, which is what lets the compiler know every id.",
        detail: ["A member the puzzle declares none of is `never`: a puzzle with no zones has `zones: never`, and so `zone()` and `view.zone` cannot be called with any id."],
        fields: [
          P("cell", "GridCell | RingCell", "The form of a cell on this puzzle's board: `GridCell` where [`board.shape`](/reference/puzzle#board) is `grid`, `RingCell` where it is `rings`.", { values: [{ value: "GridCell", description: "The board is a grid." }, { value: "RingCell", description: "The board is rings." }] }),
          P("settings", "{ [id]: number | boolean | readonly number[] | readonly (readonly string[])[] }", "Every setting by id, with the type its [`type`](/reference/puzzle#settings-type) gives. See [how a setting reaches the rules](#how-a-setting-reaches-the-rules)."),
          P("moves", "{ [id]: object }", "Every move by id, with its fields typed. See [how a field reaches the rules](#how-a-field-reaches-the-rules)."),
          P("events", "{ [id]: object }", "Every event by id, with its fields typed. A field of type `points` is typed [`Points`](#points)."),
          P("signals", "{ [id]: unknown }", "Every signal in by id, with the type of the value it carries: one value, or an object of its fields."),
          P("pieces", "string", "The ids of the puzzle's pieces, as a union: `\"kind\" | \"prize\"`."),
          P("states", "string | number", "Every state a piece of the puzzle can be in: the names of named states, and `number` where a piece shows a count. `never` where no piece has a state.", { values: [{ value: "string", description: "The name of a named state, as a union of the names: `\"cold\" | \"hot\"`." }, { value: "number", description: "A count a piece shows, a whole number." }] }),
          P("terrain", "string", "The ids of the puzzle's terrain, as a union."),
          P("phases", "string", "The ids of its phases, however deep, as a union."),
          P("zones", "string", "The ids of its zones, as a union."),
          P("draws", "string", "The ids of its draws, as a union."),
          P("payouts", "string", "The ids of its payouts, as a union."),
          P("endings", "string", "The ids of its endings, as a union."),
          P("standIns", "string", "The ids of its own stand-ins, as a union."),
          P("layers", "string", "The ids of its layers, as a union."),
          P("counts", "string", "The ids of its gauges and its stats, as one union."),
          P("tasks", "string", "The ids of its tasks, as a union."),
        ],
      },
    ],
  },
  {
    title: "Hooks",
    types: [
      {
        name: "On",
        definition: "",
        description: "The shape of a hook that starts with `on`: it is given a context and then its own arguments, and returns the next state or nothing.",
        fields: [P("A", "unknown[]", "The hook's arguments after the context, as a tuple. Empty for a hook that is given only the context.")],
      },
      {
        name: "Ask",
        definition: "",
        description: "The shape of a question: it is given a view and one argument, and returns its answer.",
        fields: [P("A", "any", "The question's argument. `void` for a question that is asked with only a view."), P("R", "any", "What it answers.")],
      },
    ],
  },
  {
    title: "Seats and sides",
    types: [
      {
        name: "Seat",
        definition: "",
        description: "One seat, as its number. Seats are numbered from 0, clockwise.",
        detail: ["A solo puzzle has one seat, 0. A seat keeps its number for the whole round, whoever holds it and whether or not it is out."],
        examples: ["0", "3"],
      },
      {
        name: "Side",
        definition: "",
        description: "One side, as its number. Sides are numbered from 0.",
        detail: ["How seats fall into sides is the puzzle's [`opponents.sides`](/reference/puzzle#opponents). A solo puzzle has one side, 0. `sideOf` and `seatsOf` go between the two."],
        examples: ["0", "1"],
      },
    ],
  },
  {
    title: "Places",
    note: "A place is a cell on a board or a numbered spot in a zone. Moves and events point at places.",
    types: [
      {
        name: "GridCell",
        definition: "",
        description: "A cell of a grid.",
        fields: [P("x", "number", "The column, counted from 0 at the left. A whole number."), P("y", "number", "The row, counted from 0 at the top. A whole number.")],
        detail: ["Where the grid has a rim, the rim's cells are cells like any other: column 0 and row 0 are the rim's, and the playing area starts at 1."],
        examples: ["{ x: 0, y: 0 }", "{ x: 6, y: 7 }"],
      },
      {
        name: "RingCell",
        definition: "",
        description: "A cell of a ring board.",
        fields: [P("ring", "number", "The ring, counted from 0 at the innermost. A whole number."), P("sector", "number", "The sector, counted from 0 at the top, clockwise. A whole number.")],
        examples: ["{ ring: 0, sector: 0 }", "{ ring: 2, sector: 7 }"],
      },
      {
        name: "Cell",
        definition: "",
        description: "A cell of this puzzle's board: a `GridCell` on a grid, a `RingCell` on rings. With the puzzle's type it is exactly one of the two, so `place.x` needs no check.",
        detail: ["Two cells are the same cell when their numbers are equal. They are plain data and are never compared with `===`."],
      },
      {
        name: "Spot",
        definition: "",
        description: "A numbered spot in a zone.",
        fields: [P("zone", "ZoneRef", "Which zone, made with [`zone()`](#zone)."), P("spot", "number", "The spot, counted from 0. It is less than the zone's [`size`](/reference/puzzle#zones).")],
        examples: ["{ zone: zone(\"tray\"), spot: 2 }"],
      },
      {
        name: "Place",
        definition: "",
        description: "Any place: a cell or a spot.",
        forms: [
          { label: "A cell", type: "Cell<P>", description: "On the board." },
          { label: "A spot", type: "Spot", description: "In a zone. It is told from a cell by having a `zone`." },
        ],
      },
      {
        name: "ZoneRef",
        definition: "",
        description: "The name of one zone: its id and whose it is. It is made with [`zone()`](#zone) and is plain data.",
        fields: [
          P("zone", "string", "The zone's id."),
          P("owner", "Seat | Side | null", "Whose it is.", {
            values: [
              { value: "Seat", description: "A seat's, where the puzzle's zone is one for each seat." },
              { value: "Side", description: "A side's, where it is one for each side." },
              { value: "null", description: "The round's: there is one." },
            ],
          }),
        ],
      },
      {
        name: "Edge",
        definition: "",
        description: "A side of the board that a new piece comes in from. It is how a board plays an arrival and decides nothing else.",
        values: [
          { value: "\"above\"", description: "From off the board, above the cell it lands on. It drops in." },
          { value: "\"below\"", description: "From off the board, below. It rises in." },
          { value: "\"left\"", description: "From off the board, to the left." },
          { value: "\"right\"", description: "From off the board, to the right." },
        ],
      },
      {
        name: "Direction",
        definition: "",
        description: "One of the ways a board's cells touch. A move or an event carries one in a field of type `direction`.",
        detail: ["A grid that touches on four sides uses the first four. A grid that touches on eight adds the diagonals. A ring board uses the last four."],
        values: [
          { value: "\"up\"", description: "Towards row 0. On a grid." },
          { value: "\"down\"", description: "Away from row 0. On a grid." },
          { value: "\"left\"", description: "Towards column 0. On a grid." },
          { value: "\"right\"", description: "Away from column 0. On a grid." },
          { value: "\"up-left\"", description: "Up and left at once. On a grid whose [`board.touch`](/reference/puzzle#board) is 8." },
          { value: "\"up-right\"", description: "Up and right. On a grid that touches on eight." },
          { value: "\"down-left\"", description: "Down and left. On a grid that touches on eight." },
          { value: "\"down-right\"", description: "Down and right. On a grid that touches on eight." },
          { value: "\"in\"", description: "Towards ring 0, along a sector. On rings." },
          { value: "\"out\"", description: "Away from ring 0, along a sector. On rings." },
          { value: "\"clockwise\"", description: "To the next sector, around a ring. On rings." },
          { value: "\"anticlockwise\"", description: "To the sector before, around a ring. On rings." },
        ],
      },
    ],
  },
  {
    title: "Pieces",
    types: [
      {
        name: "PieceId",
        definition: "",
        description: "The number the rules know one piece by. It is unique within the round, from the moment the piece is dealt until it leaves, and is never used again.",
        detail: ["The engine gives each piece its id as it arrives. A piece keeps its id as it travels, changes, and goes between a zone and the board. A move's field of type `piece` carries one."],
        examples: ["0", "51"],
      },
      {
        name: "Piece",
        definition: "",
        description: "What the rules know about one thing on the table.",
        detail: ["A piece a seat may not see reaches that seat's view with its `id` and nothing else. So every member but `id` may be `undefined`, and a rule that reads one says what it does then."],
        fields: [
          P("id", "PieceId", "Its id. Always there."),
          P("piece", "P[\"pieces\"]", "Which of the puzzle's [`pieces`](/reference/puzzle#pieces) it is, by id.", { optional: true, absent: "The piece is hidden from this view." }),
          P("kind", "number", "Its kind within its family, a whole number counted from 1.", { optional: true, absent: "The piece is hidden from this view, or its piece is not a family." }),
          P("state", "P[\"states\"]", "Its state: a name for a named state, a whole number for a count.", { optional: true, absent: "The piece is hidden from this view, or its piece has no states." }),
        ],
      },
      {
        name: "NewPiece",
        definition: "",
        description: "What a piece is, for an event that puts one on the board. It has no `id`: the engine gives one.",
        fields: [
          P("piece", "P[\"pieces\"]", "Which of the puzzle's pieces it is, by id."),
          P("kind", "number", "Its kind, a whole number from 1 up to the setting its family names.", { optional: true, absent: "The piece is not a family, and has no kind.", rules: [must("Be given for a piece whose [`family`](/reference/puzzle#pieces) is set, and for no other.")] }),
          P("state", "P[\"states\"]", "Its state.", { optional: true, absent: "The first of its named states, or 0 for a count. Left out for a piece with no states." }),
        ],
        examples: ["{ piece: \"kind\", kind: 3 }", "{ piece: \"prize\" }", "{ piece: \"timed\", kind: 2, state: 5 }"],
      },
      {
        name: "Change",
        definition: "",
        description: "What a piece or a cell becomes, where it stands.",
        forms: [
          {
            label: "A piece",
            type: "{ piece?, kind?, state? }",
            description: "The piece on the cell becomes this. Anything left out stays as it was.",
            fields: [
              P("piece", "P[\"pieces\"]", "Another of the puzzle's pieces, as a timed piece becomes a ruined one.", { optional: true, absent: "It stays the piece it is." }),
              P("kind", "number", "Another kind.", { optional: true, absent: "It keeps its kind." }),
              P("state", "P[\"states\"]", "Another state.", { optional: true, absent: "It keeps its state." }),
            ],
          },
          {
            label: "A cell's terrain",
            type: "{ terrain, state? }",
            description: "The cell itself becomes another terrain, or the same terrain in another state.",
            fields: [P("state", "string", "The state it is in, one of those the terrain declares.", { optional: true, absent: "The first state the terrain declares, where it has any." }), P("terrain", "TerrainId<P> | \"plain\"", "The terrain it becomes.", { values: [{ value: "TerrainId<P>", description: "One of the puzzle's terrain, by id." }, { value: "\"plain\"", description: "An ordinary cell." }] })],
          },
        ],
        examples: ["{ state: \"hot\" }", "{ piece: \"ruined\" }", "{ terrain: \"plain\" }"],
      },
    ],
  },
  {
    title: "Moves, events and signals",
    types: [
      {
        name: "Settings",
        definition: "",
        description: "This round's value for every setting, by id. It cannot be changed.",
        detail: ["Every setting the puzzle declares is there, at the value the round was started on. A setting an amount names, such as a board's width, is read here like any other."],
        examples: ["view.settings.kinds", "ctx.settings.cascadePercent[2]"],
      },
      {
        name: "Move",
        definition: "",
        description: "A move: its id, and the fields the puzzle declares for it.",
        detail: [
          "`Move<P>` is any of the puzzle's moves. Check `move.move` to tell them apart, and the fields narrow with it. `Move<P, \"swap\">` is one move's.",
          "The engine has checked a move's fields before any hook sees it: every place is on the board or in a declared zone, and every number is whole.",
        ],
        fields: [P("move", "MoveId<P>", "The move's id."), P("…", "its fields", "Each field the puzzle declares for the move, by name. See [how a field reaches the rules](#how-a-field-reaches-the-rules).")],
        examples: ["{ move: \"swap\", a: { x: 1, y: 2 }, b: { x: 2, y: 2 } }", "{ move: \"bid\", tricks: 3 }"],
      },
      {
        name: "Event",
        definition: "",
        description: "An event as it was reported: its id, and its fields.",
        detail: ["It is what `pointsFor` is given and what a tried move gives back. Check `event.event` to tell events apart, and the fields narrow with it."],
        fields: [
          P("event", "EventId<P>", "The event's id."),
          P("…", "its fields", "Each field the puzzle declares for the event. A field of type `points` holds what the event paid, or 0 while it is being paid."),
        ],
      },
      {
        name: "EventFields",
        definition: "",
        description: "What `emit` is given for one event: every field the puzzle declares for it, but for those typed `points`.",
        detail: ["An event with no fields, or with only a `points` field, takes `{}`."],
      },
      {
        name: "Points",
        definition: "",
        description: "A number of points on an event. It is a whole number, and reads as one.",
        detail: ["It is marked apart from a plain number only so that `emit` can leave it out: the rules never give an event its points. The engine fills the field when it pays the event."],
      },
      {
        name: "Signal",
        definition: "",
        description: "A signal in, as `onSignal` is given it.",
        fields: [
          P("signal", "SignalId<P>", "The signal's id. Check it to tell signals apart, and `value` narrows with it."),
          P("seat", "Seat | null", "Who it is for.", {
            values: [
              { value: "Seat", description: "One seat, where the signal's [`perSeat`](/reference/puzzle#signals) is true." },
              { value: "null", description: "The whole round." },
            ],
          }),
          P("value", "P[\"signals\"][id]", "What it carries: a number, a boolean, an [`Outcome`](#outcome), or an object of its fields."),
        ],
      },
      {
        name: "OpenTask",
        definition: "",
        description: "A task that is open: which task it is, and what it holds.",
        fields: [
          P("task", "string", "The id of the task, one of the puzzle's [`tasks`](/reference/puzzle#tasks)."),
          P("holds", "{ readonly [name: string]: unknown }", "What the rules gave it when they opened it, such as the kind a bounty names. It is the rules' own, and the engine never reads it."),
        ],
      },
      {
        name: "Tick",
        definition: "",
        description: "One tick of a ticking puzzle.",
        fields: [
          P("n", "number", "Which tick this is, counted from 1. A whole number. The first tick falls one tick's length after the round starts."),
          P("ms", "number", "The tick's time, in milliseconds since the round started. It is always `n` times the puzzle's [`tickMs`](/reference/puzzle#round-tempo-tickms)."),
        ],
      },
    ],
  },
  {
    title: "Results",
    types: [
      {
        name: "Tried",
        definition: "",
        description: "What came of a move tried on a copy of the round.",
        fields: [
          P("events", "readonly Event<P>[]", "Every event the move caused, in order, the cascade's included, as the trying seat would see them."),
          P("points", "number", "The points those events pay the trying seat's account. A whole number, and it may be 0."),
          P("view", "View<P, S>", "The trying seat's view after the move. It can be tried from again."),
        ],
      },
      {
        name: "Ended",
        definition: "",
        description: "How a round ended, as `placing` is given it.",
        fields: [P("reason", "EndingId<P>", "The id of the ending that was met."), P("seconds", "number", "How long the round was played, in whole seconds."), P("sides", "readonly SideResult[]", "Every side of the round, lowest first. See [`SideResult`](#sideresult).")],
      },
      {
        name: "SideResult",
        definition: "",
        description: "One side at the end of a round.",
        fields: [
          P("side", "Side", "The side."),
          P("seats", "readonly Seat[]", "Its seats, lowest first."),
          P("points", "number", "The side's points: its account where accounts are a side's, or the sum of its seats' accounts."),
          P("out", "number | null", "When the side went out of the round.", {
            values: [
              { value: "number", description: "It went out, and this is its order: 0 for the first side out, 1 for the next." },
              { value: "null", description: "It was still in when the round ended." },
            ],
          }),
        ],
      },
      {
        name: "Result",
        definition: "",
        description: "A round as it ended for one seat, as `score` is given it.",
        fields: [
          P("reason", "EndingId<P>", "The id of the ending that was met."),
          P("seconds", "number", "How long the round was played, in whole seconds."),
          P("placing", "readonly (readonly Side[])[]", "The places, best first, each a list of the sides that share it. A solo puzzle has `[[0]]`."),
          P("seat", "Seat", "The seat being scored."),
          P("points", "number", "The seat's account: a whole number of zero or more."),
          P("sidePoints", "number", "Its side's points. In a solo puzzle, the same as `points`."),
        ],
      },
      {
        name: "Outcome",
        definition: "",
        description: "How a round between sides ended, as plain data. It is what a field or a signal of type `outcome` carries.",
        fields: [P("reason", "string", "The id of the ending that was met."), P("placing", "readonly (readonly Side[])[]", "The places, best first, each a list of the sides that share it.")],
      },
    ],
  },
];

export const TYPE_DEFS: readonly TypeDef[] = TYPE_GROUPS.flatMap((g) => g.types);

/** How each type a puzzle gives a field of a move, an event or a signal reaches the rules. */
export const FIELD_MAP: readonly (readonly [field: string, type: string, note: string])[] = [
  ["place", "Cell<P> | Spot", "A cell, or a spot in a zone. Where the puzzle has no zone a player takes from, it is `Cell<P>` alone."],
  ["places", "readonly Cell<P>[]", "Cells, in the order they were drawn or found."],
  ["direction", "Direction", "One of the ways the board's cells touch."],
  ["piece", "PieceId", "The id of a piece. On a field that names a kind and not one piece, a `number`: the kind."],
  ["seat", "Seat", "A seat's number."],
  ["side", "Side", "A side's number."],
  ["number", "number", "A whole number."],
  ["flag", "boolean", "True or false."],
  ["points", "Points", "On an event only. The rules leave it out of `emit`, and read it as a number afterwards."],
  ["outcome", "Outcome", "How a round between sides ended."],
];

/** How each type of setting reaches the rules. */
export const SETTING_MAP: readonly (readonly [setting: string, type: string, note: string])[] = [
  ["whole", "number", "A whole number."],
  ["percent", "number", "A whole number of hundredths, as written: `200` for double. The rules divide by 100 themselves, and round down."],
  ["permille", "number", "A whole number of thousandths, as written. Handed to `chance` as it is."],
  ["list", "readonly number[]", "The entries, in order. A table read past its end is the rules' to handle: most hold their last entry."],
  ["flag", "boolean", "True or false."],
  ["maps", "readonly (readonly string[])[]", "Every map the round may be played on. Each is a row at a time, each cell a terrain id or `plain`. A draw picks one, and the rules lay it on the board on an event, so a board can draw the map from the event alone."],
];
