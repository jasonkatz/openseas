import pathsRaw from "../../../../../docs/puzzles/examples/paths.puzzle.json?raw";
import { alias, amount, arr, bool, condition, en, fieldTypes, id, int, lazy, lit, map, name, obj, opt, or, ref, req, sentence, str, tuple, when, type Example, type Field, type ObjectPage, type RootObject, type Type } from "./types.js";

/** Paths, the puzzle written out in full beside the guide: every example that can be is cut from it. */
export const PATHS = JSON.parse(pathsRaw) as Record<string, unknown>;

const BETWEEN = "the puzzle is played between sides, so it has `opponents`";

/** An example cut from Paths: the whole value under a key, or only the entries with the given ids. */
function fromPaths(key: string, ids?: readonly string[], idKey = "id"): Example {
  const value = PATHS[key];
  const cut = ids && Array.isArray(value) ? ids.map((want) => (value as Record<string, unknown>[]).find((v) => v[idKey] === want)!) : value;
  return { title: "Paths", value: { [key]: cut } };
}

const page = (p: Omit<ObjectPage, "root">): ObjectPage => ({ root: "puzzle", ...p });

const SEEN_BY = en(
  ["everyone", "Every seat sees every piece in it."],
  ["seat", "Only the seat it belongs to sees its pieces. Every other seat is given each piece's id and nothing else."],
  ["side", "The seats of the side it belongs to see its pieces. No other side does."],
  ["nobody", "No seat sees its pieces until an event reveals them, as a deck of cards face down."],
);

const EACH = en(["round", "There is one, shared by the whole round."], ["seat", "Every seat has one of its own."], ["side", "Every side has one of its own."]);

const ACTS = (withNobody: boolean): Type =>
  en(
    ["anyone", "Any seat that is not out may move, at any time."],
    ["in-turn", "One seat moves at a time. The loop asks the rules whose turn it is, and refuses a move from any other seat."],
    ["together", "Every seat owes one move. Each is held back, seen only by its own seat, until every seat has one. They are then resolved as one."],
    ...(withNobody ? ([["nobody", "No seat moves. The phase runs by itself and closes, as when the cards are shown."]] as const) : []),
  );

// ---------------------------------------------------------------- round

const phase: Type = obj(
  [
    req("id", id, "The phase's id. Events close it by this id, and `points.banks` and a stock ending name it."),
    req("description", sentence, "What this stretch of the round is."),
    when("the phase has no phases inside it", "acts", ACTS(true), "How its seats act while it is open.", { never: "A phase that holds other phases. Its inner phases say how their seats act." }),
    when("`acts` is `anyone`, `in-turn` or `together`", "moves", arr(ref("move"), { min: 1 }), "The moves it takes. A move it does not list is refused before the rules are asked.", {
      never: "A phase where `acts` is `nobody`, or one that holds other phases.",
    }),
    opt("repeat", amount, "How many times it runs before the round moves on.", { absent: "It runs once." }),
    opt("next", ref("control"), "The control that starts the next repeat, such as a button that deals the next hand. The round waits for any seat a player holds to use it.", {
      absent: "The next repeat starts by itself.",
      only: "With `repeat`.",
    }),
    opt("tally", bool, "True when the loop keeps a tally of the points paid while it is open, for each account.", {
      absent: "False: it keeps none.",
      must: "Be true on the phase `points.banks` names.",
    }),
    opt(
      "phases",
      lazy("phase", "Each is a phase, declared exactly as this one is.", () => arr(phase, { min: 1 })),
      "The phases inside it, in the order they run. Closing a phase closes those inside it.",
      { absent: "It holds no other phases, so it says how its own seats act." },
    ),
  ],
  "phase",
);

const ending: Type = obj(
  [
    req("id", id, "The ending's **reason**: what the host, the board and the score are told the round ended by.", {
      never: "The id `left`. That ending is the host's, met when the last player leaves, and no puzzle declares it.",
    }),
    req(
      "by",
      en(
        ["clock", "A length of time has passed. It is sized by `setting`, in seconds."],
        ["budget", "A number of moves has been made. Between sides it counts turns for each seat, passed and lapsed turns included. It is sized by `setting`."],
        ["stock", "The round's fixed amount of deal has been worked through, such as five slabs, or a phase has run its repeats, such as five legs. It is sized by `setting`, or it counts `phase`."],
        ["fail", "The rules report a state the round cannot go on from. It is named by `event`."],
        ["outcome", "The round is decided between its sides. It is named by `event`."],
      ),
      "What kind of ending it is. The kind decides which of the three keys below it takes.",
    ),
    when("`by` is `clock` or `budget`, or `stock` with no `phase`", "setting", ref("setting"), "The setting that sizes it: seconds for a clock, moves for a budget, tasks or pieces for a stock.", {
      never: ["An ending whose `by` is `fail` or `outcome`.", "Together with `phase`."],
    }),
    when("`by` is `fail` or `outcome`", "event", ref("event"), "The event that meets it. The round ends when the rules report this event.", {
      never: "An ending whose `by` is `clock`, `budget` or `stock`.",
    }),
    when("`by` is `stock` with no `setting`", "phase", ref("phase"), "The phase whose repeats it counts. The ending is met when that phase has run its last repeat.", {
      only: "An ending whose `by` is `stock`.",
      must: "Name a phase that has a `repeat`.",
    }),
  ],
  "ending",
);

const round = page({
  key: "round",
  title: "round",
  lede: "How time moves, who may move, the stretches a round is made of, and what ends it.",
  about: [
    "Every puzzle has one round object. A solo puzzle fills in very little of it: a tempo, usually one ending, and the cap on its log.",
    "A round between sides is where the rest is used. Phases give it hands, legs and turns, and each phase says how its seats act.",
  ],
  ideas: { title: "The round", path: "/domain/round" },
  need: "required",
  type: obj([
    req(
      "tempo",
      obj([
        req(
          "kind",
          en(
            ["still", "Nothing happens between moves. The board waits for the next one, however long that takes."],
            ["ticking", "The rules move on by themselves, one tick at a time, whether or not anyone moves. The loop asks `onTick` once for every tick."],
          ),
          "How the puzzle's time moves.",
        ),
        when("`kind` is `ticking`", "tickMs", int(1, undefined, "milliseconds"), "The length of one tick. It is fixed by the puzzle, so two rounds of it always tick alike.", {
          never: ["A puzzle whose `kind` is `still`.", "A setting's id. A tick's length is never tuned."],
        }),
      ]),
      "How time moves. A puzzle has one tempo for the whole round.",
    ),
    opt("acts", ACTS(false), "Who may move, for a round that acts in one way throughout.", {
      absent: "`anyone`. A solo puzzle always leaves it out.",
      never: "Together with `phases`. Where a round has phases, each phase says how its seats act.",
    }),
    opt("phases", arr(phase, { min: 1 }), "The named stretches of the round, as a tree, in the order they run. The loop opens and closes them. The rules never set one.", {
      absent: "The round has no phases, and every move may be made at any time `acts` allows.",
      only: "A puzzle between sides. A solo puzzle declares none.",
    }),
    req("ends", arr(ending), "The round's endings. The first one met ends the round. The list may be empty: a puzzle with no ending of its own ends only when its player leaves."),
    req("logLimit", int(1), "The most entries a round's log may hold. It guards a host against a runaway round. A round that reaches it ends there, and any tally not yet banked is dropped.", {
      never: "A setting's id. The cap is fixed by the puzzle.",
    }),
  ]),
  rules: [
    "`acts` and `phases` are never both present. A round either acts in one way throughout, or leaves it to its phases.",
    "A phase is a branch or a leaf. A branch has `phases` and no `acts` or `moves`. A leaf has `acts`, and has `moves` unless nobody acts in it.",
    "Where a puzzle has phases, every move belongs to at least one of them.",
    "Every phase can close: an event names it in `closes`, or its seats run out, or its repeats do.",
    "An ending takes exactly one of `setting`, `event` and `phase`, as its `by` says.",
    "An `outcome` ending is for a puzzle between sides.",
    "`tickMs` and `logLimit` are plain numbers. Neither is ever a setting.",
  ],
  examples: [
    fromPaths("round"),
    {
      title: "A round of hands",
      note: "Two sides bid and then play tricks, hand after hand. The outer phase repeats, waits for a control, and keeps a tally.",
      value: {
        round: {
          tempo: { kind: "still" },
          phases: [
            {
              id: "hand",
              description: "one deal, bid and played out",
              repeat: "hands",
              next: "deal",
              tally: true,
              phases: [
                { id: "bids", description: "each seat bids the tricks it means to take", acts: "in-turn", moves: ["bid"] },
                { id: "tricks", description: "thirteen tricks", acts: "in-turn", moves: ["play"] },
              ],
            },
          ],
          ends: [{ id: "played_out", by: "stock", phase: "hand" }],
          logLimit: 2000,
        },
      },
    },
    {
      title: "A ticking round",
      value: { round: { tempo: { kind: "ticking", tickMs: 250 }, ends: [{ id: "time", by: "clock", setting: "roundSeconds" }, { id: "overrun", by: "fail", event: "overrun" }], logLimit: 4000 } },
    },
  ],
});

// ---------------------------------------------------------------- settings

const settingFields: readonly Field[] = [
  req("id", id, "The setting's id. Other parts of the puzzle name the setting by it, and the rules read its value by it."),
  req(
    "type",
    en(
      ["whole", "A whole number: a count, a size, a length of time, a number of points."],
      ["percent", "A whole number of hundredths. `100` leaves a thing as it is and `200` doubles it."],
      ["permille", "A whole number of thousandths: a chance. `35` is three and a half times in a hundred."],
      ["list", "A list of whole numbers, read by position: a table of percents, or of points."],
      ["flag", "True or false."],
      ["maps", "A list of hand-drawn maps. The seed picks one for each round."],
    ),
    "What kind of value it holds. The type decides the form of `default` and which of the keys below it takes.",
  ),
  req(
    "default",
    or(
      { label: "whole, percent or permille", type: int(), description: "One whole number, within `min` and `max`." },
      { label: "list", type: arr(int(), { noun: "integers" }), description: "The entries, each within `min` and `max`, as many as `entries` allows." },
      { label: "flag", type: bool },
      { label: "maps", type: arr(alias("map"), { min: 1, noun: "maps" }), description: "The maps, each filling the board `map.board` names." },
    ),
    "The value the puzzle ships with. It is the only place that number lives: nothing else in the puzzle, its rules or its skin repeats it.",
  ),
  when("`type` is `whole`, `percent`, `permille` or `list`", "min", int(), "The least it may be. For a list, the least each entry may be. Every host holds a round's settings to their bounds before it starts.", {
    never: "A setting whose `type` is `flag` or `maps`.",
  }),
  when("`type` is `whole`, `percent`, `permille` or `list`", "max", int(), "The most it may be. For a list, the most each entry may be.", {
    never: "A setting whose `type` is `flag` or `maps`.",
    must: "Be no less than `min`.",
  }),
  req("description", sentence, "What it does, and where it helps, which way is harder. A tuning panel shows this beside the setting."),
  req(
    "group",
    en(
      ["board", "The board's size and what stands on it."],
      ["deal", "What luck brings, and how often."],
      ["tempo", "How long things last: a round, a fuse, a tick's worth of anything."],
      ["scoring", "What pays, and how much."],
    ),
    "Where it sits in a tuning panel.",
  ),
  opt(
    "unit",
    en(
      ["seconds", "A length of time on the clock."],
      ["ticks", "A length of time counted in the puzzle's ticks."],
      ["moves", "A number of moves."],
      ["cells", "A size or a distance on the board."],
      ["pieces", "A number of pieces."],
      ["points", "A number of points."],
    ),
    "What a whole number or a list counts.",
    { absent: "It is a plain count, such as a number of kinds.", never: "A setting whose `type` is `percent`, `permille`, `flag` or `maps`." },
  ),
  when(
    "`type` is `list`",
    "entries",
    or(
      {
        label: "a range",
        description: "The list may be any length from `least` to `most`.",
        type: obj([req("least", int(1), "The fewest entries."), req("most", int(1), "The most entries. No less than `least`.")]),
      },
      { label: "a fixed length", description: "The list has exactly this many entries.", type: obj([req("count", amount, "How many entries: a number, or the setting that says.")]) },
    ),
    "How many entries the list may have.",
    { only: "A setting whose `type` is `list`." },
  ),
  when(
    "`type` is `maps`",
    "map",
    obj([
      req("board", lit("board"), "The board each map fills. A puzzle has one board, so this is always `board`."),
      req("check", ref("check"), "The check every map must pass before the puzzle is ready, such as every port being reachable."),
    ]),
    "What each map is drawn on, and the test it must pass.",
    { only: "A setting whose `type` is `maps`." },
  ),
  opt("role", bool, "True when a role may set it for a round, within its bounds, as a ship's state sets how hard a station is.", { absent: "False: only a host's tuning panel may change it." }),
];

const setting: Type = obj(settingFields, "setting");
const settingLazy = lazy("setting", "Each is declared exactly as an entry of [`settings`](/api/puzzle#settings) is, with every key a setting has.", () => arr(setting, { noun: "settings" }));

const settings = page({
  key: "settings",
  title: "settings",
  lede: "Every number the puzzle is tuned by: its type, its default, its bounds and what it does.",
  about: [
    "A setting is a named number. Everything in a puzzle that could be tuned is one, and its default is the only place the number is written.",
    "Other parts name a setting by its id wherever they need its value: a board's width, a payout's size, a clock's length. A round starts from a value for every setting.",
  ],
  ideas: { title: "Settings", path: "/domain/moves-and-events#settings" },
  need: "required",
  type: arr(setting),
  rules: [
    "`min` and `max` are for `whole`, `percent`, `permille` and `list`. A `flag` and `maps` have neither.",
    "`entries` is for `list` only, and `map` is for `maps` only.",
    "`unit` is for `whole` and `list` only.",
    "`default` lies within `min` and `max`. For a list, every entry does, and the number of entries fits `entries`.",
    "A setting a layer brings exists only while that layer is on. Switching the layer off needs no value of its own.",
    "What two settings must keep between them is a [relation](/api/puzzle#relations), not a bound.",
  ],
  examples: [fromPaths("settings", ["roundSeconds", "kinds", "prizePermille", "loopPercent", "streakPercent"])],
});

const relations = page({
  key: "relations",
  title: "relations",
  lede: "What the settings must keep between one another, which no single setting's bounds can say.",
  about: ["Every host holds a round's settings to their bounds and to these relations before it starts, so every host refuses the same settings."],
  ideas: { title: "Settings", path: "/domain/moves-and-events#settings" },
  need: "required",
  type: arr(
    obj(
      [
        req(
          "is",
          en(
            ["at-most", "`a` is no more than `b`."],
            ["below", "`a` is less than `b`."],
            ["ascending", "The entries of the list `a` never fall from one to the next."],
            ["fits", "The count `a` fits `b`: no more pieces than the board has cells."],
          ),
          "Which relation it is.",
        ),
        req("a", ref("setting"), "The setting the relation holds for. For `ascending` it is a setting of type `list`. For the others it is of type `whole`."),
        when(
          "`is` is `at-most`, `below` or `fits`",
          "b",
          or({ label: "a setting", type: ref("setting"), description: "For `at-most` and `below`: the setting `a` is held against." }, { label: "the board", type: lit("board"), description: "For `fits`: the board's number of cells." }),
          "What `a` is held against.",
          { never: "A relation whose `is` is `ascending`. It holds within one list." },
        ),
      ],
      "relation",
    ),
  ),
  rules: ["`ascending` takes `a` alone. Every other relation takes `a` and `b`.", "A relation with a setting that a layer brings holds only while that layer is on."],
  examples: [fromPaths("relations"), { title: "Other relations", value: { relations: [{ is: "below", a: "shortPath", b: "longPath" }, { is: "ascending", a: "cascadePercent" }, { is: "fits", a: "startPieces", b: "board" }] } }],
});

// ---------------------------------------------------------------- sides

const opponents = page({
  key: "opponents",
  title: "opponents",
  lede: "How many sides and seats a round has, who plays a seat no player holds, and what a seat becomes when its player leaves.",
  about: [
    "A solo puzzle has one side of one seat, and leaves this object out. Its presence is what makes a puzzle one played between sides.",
    "Every puzzle between sides gets four types of stand-in for free: careless, greedy, planner and ghost. Those are never declared. This object adds the puzzle's own, where it needs them.",
  ],
  ideas: { title: "Sides and seats", path: "/domain/sides" },
  need: { when: "the puzzle is played between sides" },
  absent: "The puzzle is solo: one side of one seat.",
  type: obj([
    req("sides", tuple(["least", int(1)], ["most", int(1)]), "The fewest and the most sides a round has. Both are the same number where it never varies. A puzzle that plays with or without a rival starts at 1."),
    req("seatsPerSide", tuple(["least", int(1)], ["most", int(1)]), "The fewest and the most seats each side holds. Partners are two seats on one side."),
    req("ghosts", bool, "Whether a seat can be played by a ghost: a player's own earlier round, replayed from its log on the same deal and version.", {
      never: "True where `board.shared` is true. A replayed move must still be one the rules allow, so a ghost needs boards the other side cannot touch.",
    }),
    req(
      "standIns",
      arr(
        obj(
          [
            req("id", id, "The stand-in's id. The rules are told which one to play for a seat by it."),
            req("description", sentence, "How it plays."),
            req("dials", settingLazy, "Its dials: what a host or a role turns to make it stronger or weaker. The list may be empty.", {
              never: "A dial for how long it takes over a move. Delay is kept by the loop for every stand-in.",
            }),
            opt(
              "presets",
              map("<preset>", "A name for the preset, such as `shark`.", map("<dial id>", "The id of one of this stand-in's dials.", or({ label: "a whole, percent or permille dial", type: int() }, { label: "a flag dial", type: bool }, { label: "a list dial", type: arr(int(), { noun: "integers" }) }))),
              "Named presets. Each gives a value for every dial under one name, so a host can pick a whole character at once.",
              { absent: "It has no presets.", must: "Give a value for every dial, each within that dial's bounds." },
            ),
          ],
          "stand-in",
        ),
      ),
      "The puzzle's own stand-ins, beside the four every puzzle gets. The rules play each one in `pickMove`. The list may be empty.",
      { must: "Hold at least one where any zone or the board is hidden from a seat. The four types choose from everything on the board, so they play only where a seat sees all of it." },
    ),
    req("absent", ref("stand-in"), "The stand-in that plays a seat whose player is not there. It plays a lapsed seat for that one wait, so a seat that runs out of time never makes a move the rules refuse."),
    req(
      "left",
      en(["absent", "The seat is played by the `absent` stand-in for the rest of the round."], ["out", "The seat is out of the round. The loop never waits for it again."]),
      "What a seat becomes when its player leaves and others stay. When the last player leaves, the round ends with the reason `left` whatever this says.",
    ),
    opt("seatSettings", settingLazy, "Settings for one seat, whoever holds it, such as a ship's turrets or a fighter's blade. The host or a role sets each for a round.", { absent: "No seat has settings of its own." }),
  ]),
  rules: [
    "`sides` and `seatsPerSide` each give a least first and a most second, and the least is no more than the most.",
    "`ghosts` is true only where every seat has a board of its own: `board.shared` is false.",
    "A puzzle that hides any place from a seat brings at least one stand-in of its own.",
    "A puzzle with no stand-in of its own takes every one of the four types only if its rules answer `listMoves`.",
    "A puzzle with `opponents` also declares [`placing`](/api/puzzle#placing), and says in [`evaluation`](/api/puzzle#evaluation) how its rounds are judged.",
  ],
  examples: [
    {
      title: "Two sides of two",
      note: "Partners, with one stand-in of the puzzle's own that reads only its own seat's cards.",
      value: {
        opponents: {
          sides: [2, 2],
          seatsPerSide: [2, 2],
          ghosts: false,
          standIns: [{ id: "partner", description: "follows suit, and bids what its high cards are worth", dials: [] }],
          absent: "partner",
          left: "absent",
        },
      },
    },
    {
      title: "A stand-in with dials and presets",
      value: {
        opponents: {
          sides: [2, 2],
          seatsPerSide: [1, 1],
          ghosts: false,
          standIns: [
            {
              id: "raider",
              description: "closes to fire, and breaks off when it is losing",
              dials: [
                { id: "aggression", type: "percent", default: 50, min: 0, max: 100, description: "how readily it closes to fire", group: "tempo" },
                { id: "accuracy", type: "percent", default: 60, min: 0, max: 100, description: "how often its shots are aimed where they land", group: "scoring" },
              ],
              presets: { junker: { aggression: 20, accuracy: 35 }, shark: { aggression: 90, accuracy: 85 } },
            },
          ],
          absent: "raider",
          left: "out",
          seatSettings: [{ id: "turrets", type: "whole", default: 4, min: 1, max: 8, description: "turrets this seat's ship carries", group: "board", unit: "pieces" }],
        },
      },
    },
  ],
});

const points = page({
  key: "points",
  title: "points",
  lede: "Whose the accounts are, when points join them, and what stops at zero.",
  about: [
    "Points are paid into an account. Most puzzles need say nothing here: points go to the seat that earned them, join its account as each event is paid, and the total never goes below zero.",
    "A puzzle that counts a hand or a turn as one thing says so here. Until a phase closes, the points paid in it sit in that phase's tally.",
  ],
  ideas: { title: "Points and score", path: "/domain/moves-and-events#points-and-score" },
  need: "optional",
  absent: "The same as `{ \"to\": \"seat\", \"banks\": \"paid\", \"floor\": \"total\" }`.",
  type: obj([
    req("to", en(["seat", "Every seat has an account of its own."], ["side", "Every side has one account, which its seats share, as partners do."]), "Whose each account is.", {
      never: "`side` in a solo puzzle. It has one seat.",
    }),
    req(
      "banks",
      or({ label: "as paid", type: lit("paid"), description: "Points join the account as each event is paid." }, { label: "when a phase closes", type: ref("phase"), description: "Points sit in this phase's tally while it is open, and join the account when it closes." }),
      "When points are banked: when they join an account and count.",
      { must: "Name a phase whose `tally` is true, where it names a phase." },
    ),
    req(
      "floor",
      en(
        ["total", "The account's total stops at zero. A penalty can take a tally below zero, and the total stops once the tally is added."],
        ["tally", "Each tally stops at zero as it is banked, so a phase adds its count or nothing. The total can then never fall."],
      ),
      "What stops at zero.",
      { never: "`tally` where `banks` is `paid`. There is no tally to stop." },
    ),
  ]),
  rules: [
    "`floor` is `tally` only where `banks` names a phase.",
    "The phase `banks` names keeps a tally: its `tally` is true.",
    "A tally not yet banked is dropped when a round ends because its last player left, or at its log cap. An ending the rules report closes the open phases first, and banks their tallies.",
  ],
  examples: [
    { title: "A hand adds its count or nothing", value: { points: { to: "side", banks: "hand", floor: "tally" } } },
    { title: "A turn's hits, net of hits taken", value: { points: { to: "seat", banks: "turn", floor: "total" } } },
  ],
});

const placing = page({
  key: "placing",
  title: "placing",
  lede: "How the sides are put in order when a round between sides ends.",
  about: ["When a round ends, every side has a place. Sides that tie share the better place. Won, lost, drawn and a place among several are all read from that order."],
  ideas: { title: "Between sides", path: "/domain/scoring#between-sides" },
  need: { when: "the puzzle is played between sides" },
  absent: "The puzzle is solo, and has no sides to place.",
  type: obj([
    req(
      "by",
      en(
        ["points", "By each side's points, most first."],
        ["last-standing", "By the order the sides went out of the round, the last one standing first."],
        ["rules", "By the rules' own answer to the `placing` hook, as a puzzle that places by chips does."],
      ),
      "What orders the sides.",
      { must: "Have the rules answer [`placing`](/api/hooks#placing), where it is `rules`." },
    ),
  ]),
  rules: ["`placing` is present exactly when `opponents` is.", "`last-standing` needs a way for a side to go out: an event on which the rules say its seats are out of the round."],
  examples: [{ title: "By points", value: { placing: { by: "points" } } }],
});

// ---------------------------------------------------------------- board

const board = page({
  key: "board",
  title: "board",
  lede: "The board's shape and size, which cells touch, and who sees its pieces.",
  about: [
    "A board is made of cells, and its shape says which cells there are and which touch. Where the board sits on a screen and how big it is drawn is never the puzzle's.",
    "Rows are counted from the top and columns from the left. On rings, ring 0 is innermost, sector 0 is at the top, and sectors count clockwise.",
  ],
  ideas: { title: "The board and its pieces", path: "/domain/board-and-pieces" },
  need: "required",
  type: obj([
    req(
      "shape",
      en(["grid", "Rows and columns of square cells. It takes `width`, `height`, `touch` and `rim`."], ["rings", "Rings around a centre, cut into sectors. Cells touch around a ring, and in and out along a sector. It takes `rings` and `sectors`."]),
      "Which cells there are. The shape decides which of the keys below the board takes.",
    ),
    when("`shape` is `grid`", "width", amount, "How many columns it has.", { never: "A board whose `shape` is `rings`." }),
    when("`shape` is `grid`", "height", amount, "How many rows it has.", { never: "A board whose `shape` is `rings`." }),
    when("`shape` is `grid`", "touch", en([4, "Cells touch on their four sides."], [8, "Cells touch on their four sides and their four corners."]), "Which cells count as touching. A path, a group and a neighbour all follow it.", {
      never: "A board whose `shape` is `rings`.",
    }),
    when("`shape` is `grid`", "rim", bool, "True when the grid has a ring of cells just outside its playing area, for ports, feeders, hatches and turrets. Rim cells are cells like any other, one step outside `width` and `height`.", {
      never: "A board whose `shape` is `rings`.",
    }),
    when("`shape` is `rings`", "rings", amount, "How many rings it has, counted from the innermost.", { never: "A board whose `shape` is `grid`." }),
    when("`shape` is `rings`", "sectors", amount, "How many sectors each ring is cut into.", { never: "A board whose `shape` is `grid`." }),
    when(BETWEEN, "shared", bool, "True when all sides play on one board. False when every seat has a board of its own, all of the same shape.", { never: "A solo puzzle." }),
    opt("seenBy", SEEN_BY, "Who sees the pieces on it.", {
      absent: "`everyone`.",
      never: "`seat` or `side` on a board all sides share. A shared board belongs to no seat.",
      must: "Have an event that names `board` in its `reveals`, where it hides pieces.",
    }),
  ]),
  rules: [
    "A grid takes `width`, `height`, `touch` and `rim`, and never `rings` or `sectors`. A ring board takes `rings` and `sectors`, and never the other four.",
    "`shared` is present exactly when the puzzle has `opponents`.",
    "A board that hides its pieces has at least one event that reveals it.",
    "A size written as a setting's id follows that setting. The setting is of type `whole`.",
  ],
  examples: [fromPaths("board"), { title: "A ring board", value: { board: { shape: "rings", rings: 3, sectors: 8 } } }, { title: "A board for each seat", value: { board: { shape: "grid", width: 6, height: 12, touch: 4, rim: false, shared: false } } }],
});

const terrain = page({
  key: "terrain",
  title: "terrain",
  lede: "What a cell can be, as opposed to the piece on it: a wall, a block, a port.",
  about: ["Every cell has one terrain. A cell is plain unless the puzzle declares otherwise, so a puzzle with nothing but plain cells writes an empty list.", "A puzzle either deals its terrain, as it deals pieces, or draws it by hand as maps held in a setting of type `maps`."],
  ideas: { title: "Terrain and maps", path: "/domain/board-and-pieces#terrain-and-maps" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The terrain's id.", { never: "The id `plain`. Every puzzle has plain cells without declaring them." }),
        opt("states", arr(name, { min: 2, noun: "names" }), "Its states, where it has any, as a mirror that leans one way or the other does. A cell's terrain changes state on an event that carries a `change`.", {
          absent: "It has one form.",
        }),
      ],
      "terrain",
    ),
  ),
  examples: [{ title: "A mirror that flips, and a port", value: { terrain: [{ id: "mirror", states: ["rising", "falling"] }, { id: "port" }] } }],
});

const zones = page({
  key: "zones",
  title: "zones",
  lede: "The named places beside the board that hold pieces: a tray, a queue, a deck, a hand of cards.",
  about: ["A zone holds a fixed number of pieces in numbered spots. A spot in a zone is a place, just as a cell is, so moves and events point at it the same way.", "A card game is mostly zones. Each seat's hand is one, seen only by that seat. The deck is one nobody sees."],
  ideas: { title: "Zones", path: "/domain/board-and-pieces#zones" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The zone's id."),
        req("holds", amount, "How many pieces it can hold, each in a numbered spot."),
        req("player", en(["watches", "A player only watches it, as the next piece due is watched."], ["takes", "A player takes pieces from it as part of a move, as a plate is taken from a tray."]), "What a player may do with it."),
        opt("each", EACH, "Whose it is.", { absent: "`round`: there is one, shared by the whole round." }),
        opt("seenBy", SEEN_BY, "Who sees the pieces in it.", {
          absent: "`everyone`.",
          never: ["`seat` unless `each` is `seat`. A zone must belong to a seat to be seen by its seat.", "`side` unless `each` is `seat` or `side`."],
          must: "Be named in the `reveals` of at least one event, where it hides pieces.",
        }),
      ],
      "zone",
    ),
  ),
  rules: ["`seenBy: \"seat\"` needs `each: \"seat\"`. `seenBy: \"side\"` needs `each` to be `seat` or `side`.", "Every zone that hides its pieces from any seat has an event that reveals it.", "A zone a layer brings exists only while that layer is on."],
  examples: [
    {
      title: "A deck, a hand for each seat, and the trick",
      value: {
        zones: [
          { id: "deck", holds: 52, player: "watches", seenBy: "nobody" },
          { id: "hand", holds: 13, player: "takes", each: "seat", seenBy: "seat" },
          { id: "trick", holds: 4, player: "watches" },
        ],
      },
    },
  ],
});

const pieces = page({
  key: "pieces",
  title: "pieces",
  lede: "Everything on the board or in a zone that the rules know about.",
  about: [
    "A piece is something a player can join, move, clear, hold or has to work around. A card is a piece. How a piece looks and what it is called belong to the skin.",
    "Pieces that are alike except for which one they are form a family. The puzzle never lists a family's kinds: a setting says how many are dealt, and the kinds are numbered from 1.",
  ],
  ideas: { title: "Pieces", path: "/domain/board-and-pieces#pieces" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The piece's id. The skin draws it and names it by this id."),
        opt("footprint", arr(obj([req("x", int(), "Columns to the right of the piece's own cell."), req("y", int(), "Rows below the piece's own cell.")], "cell"), { min: 2, noun: "cells" }), "The cells it covers, each as a step from its own cell, which is `{ \"x\": 0, \"y\": 0 }`.", {
          absent: "It covers one cell. Also left out where the rules cut or build its shape during play, as a rectangle cut from a slab.",
        }),
        opt(
          "family",
          or(
            { label: "one family", type: ref("setting"), description: "The setting that says how many kinds are dealt." },
            { label: "several families", type: arr(ref("setting"), { min: 2, noun: "setting ids" }), description: "One setting for each family it belongs to, as a card is a rank and a suit." },
          ),
          "The setting that counts its kinds. With it the piece is a family: every kind behaves alike, and the skin needs a drawing for every kind the setting's `max` allows.",
          { absent: "It is a plain piece, with one kind.", must: "Name settings of type `whole`." },
        ),
        opt("of", ref("piece"), "The piece it is based on. It behaves as that piece, with rules and states of its own on top, as a piece with a fuse is still its kind.", {
          absent: "It is based on nothing.",
          never: "Together with `family`. It takes the family of the piece it is based on.",
        }),
        opt(
          "states",
          or(
            { label: "named forms", type: arr(name, { min: 2, noun: "names" }), description: "A few named forms, such as `cold` and `hot`. The skin has a drawing for each." },
            { label: "a number", type: obj([req("count", amount, "The most it can show.")]), description: "A number the piece shows, such as the moves a fuse has left. The skin draws it by repeating one mark." },
          ),
          "How the piece can change while it stands.",
          { absent: "It never changes." },
        ),
      ],
      "piece",
    ),
  ),
  rules: ["A piece has `family` or `of`, or neither. Never both.", "A piece a layer brings exists only while that layer is on.", "The skin has a drawing for every piece, every named state and every kind a family's setting allows."],
  examples: [fromPaths("pieces"), { title: "A card, and a rod that heats", value: { pieces: [{ id: "card", family: ["ranks", "suits"] }, { id: "rod", states: ["cold", "warm", "hot"] }] } }],
});

// ---------------------------------------------------------------- deal

const draw: Type = obj(
  [
    req("id", id, "The draw's id. The rules ask for luck by it, and its stream is made from the seed and this id."),
    req("description", sentence, "What it decides."),
    req(
      "gives",
      en(
        ["kind", "Which kind of a family a piece is."],
        ["piece", "Which piece arrives, or whether one does."],
        ["place", "Where on the board, or which spot in a zone."],
        ["map", "Which of the puzzle's maps the round is played on."],
        ["task", "What the next task is."],
        ["number", "A number the rules need, such as a size."],
      ),
      "What it decides.",
    ),
    req(
      "by",
      en(
        ["even", "An even roll: each item alike, every time."],
        ["weighted", "A weighted roll: each item by its weight, or yes or no by a chance in a thousand."],
        ["bag", "A bag: a shuffled set dealt out in order, then shuffled again, so every run of that length holds the same items."],
        ["pick", "A pick: one entry of a setting that holds a list."],
      ),
      "How it draws.",
      { must: "Read a setting of type `list` or `maps`, where it is `pick`." },
    ),
    req(
      "when",
      or(
        {
          label: "at a named point",
          type: en(["start", "Once, as the round starts."], ["refill", "Whenever the board or a zone is filled again after pieces leave."], ["task", "Whenever a new task is dealt."], ["tick", "On a tick."]),
        },
        { label: "every so many moves", type: obj([req("every", ref("setting"), "The setting that says how many moves pass between draws.")]) },
      ),
      "When it is drawn.",
      { never: ["`tick` in a puzzle whose tempo is `still`.", "`task` in a puzzle with no tasks."] },
    ),
    req("reads", arr(ref("setting"), { noun: "setting ids" }), "The settings that size it: how many kinds, what chance, how often. The list may be empty."),
    when(BETWEEN, "shared", bool, "True when every seat reads one shared stream, so every seat meets the same items in the same order. False when each seat has a stream of its own.", { never: "A solo puzzle." }),
  ],
  "draw",
);

const deal = page({
  key: "deal",
  title: "deal",
  lede: "Everything luck puts in a round: every draw, the checks a deal must pass, and the caps on what a draw can give.",
  about: [
    "The deal is declared in full, so a reader knows what is luck and what is skill without reading the rules. The rules can only draw from a draw that is declared here.",
    "Every draw has a stream of its own. Nothing a draw gives depends on another, so a move that changes what one draw is asked for never changes what the others give.",
  ],
  ideas: { title: "The deal", path: "/domain/deal" },
  need: "required",
  type: obj([
    req("draws", arr(draw), "Every source of luck in the puzzle."),
    req(
      "checks",
      arr(
        obj(
          [
            req("id", id, "The check's id."),
            req("description", sentence, "What must be true of a deal."),
            req("draws", arr(ref("draw"), { min: 1, noun: "draw ids" }), "The draws it covers: the ones dealt again when a try fails."),
            req("tries", int(1), "How many times the rules deal again before they give up and use the fallback."),
            req("fallback", sentence, "What is dealt when every try fails, and why that always passes. A fallback always passes, so no round is ever dealt one that fails."),
            opt("during", ref("event"), "The event that says the board was dealt again, where the check also holds during play: when no move is left, the rules deal again and report this.", {
              absent: "The check holds only as the round starts.",
            }),
          ],
          "check",
        ),
      ),
      "The tests a deal must pass before a player sees it: a move can be made, the task can be solved from what is shown. A deal that would force a guess fails its check.",
    ),
    req(
      "bounds",
      arr(obj([req("setting", ref("setting"), "The setting that is the cap."), req("caps", ref("draw"), "The draw it caps.")], "bound")),
      "The settings that cap what one draw can give, so no round is made by one windfall.",
    ),
  ]),
  rules: [
    "Every draw has a stream of its own: no two draws share an id, and the rules never draw from one that is not declared.",
    "Every check has a fallback that passes.",
    "A draw whose `by` is `pick` reads a setting that holds a list. A draw that gives a `map` picks from a setting of type `maps`.",
    "`when: \"tick\"` is for a ticking puzzle, and `when: \"task\"` for a puzzle with tasks.",
    "`shared` is present on every draw exactly when the puzzle has `opponents`.",
    "A draw belongs to a layer when only that layer's rules call for it.",
  ],
  examples: [fromPaths("deal")],
});

// ---------------------------------------------------------------- depth

const BRINGS: readonly (readonly [string, Parameters<typeof ref>[0], string])[] = [
  ["pieces", "piece", "pieces"],
  ["events", "event", "events"],
  ["settings", "setting", "settings"],
  ["zones", "zone", "zones"],
  ["gauges", "gauge", "gauges"],
  ["controls", "control", "controls"],
  ["payouts", "payout", "payouts"],
  ["multipliers", "multiplier", "multipliers"],
  ["tasks", "task", "tasks"],
  ["draws", "draw", "draws"],
];

const layers = page({
  key: "layers",
  title: "layers",
  lede: "The named groups of rules that are each either on or off, and what each one brings.",
  about: ["A layer is how a puzzle is taken apart for a new player. A round starts with a set of layers on, and everything a layer brings exists only while it is on.", "A puzzle's first layer is its core: the verb, and what makes it score."],
  ideas: { title: "Layers", path: "/domain/depth-and-judgement#layers" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The layer's id. A stage of the ladder switches it on by this id."),
        req("rule", sentence, "The rule it adds, as a player would be told it."),
        req(
          "brings",
          obj(BRINGS.map(([key, target, noun]) => opt(key, arr(ref(target), { min: 1, noun: `${target} ids` }), `The ${noun} that exist only while it is on, by id.`, { absent: `It brings no ${noun}.` }))),
          "What exists only while the layer is on. A kind with nothing to name is left out.",
        ),
      ],
      "layer",
    ),
    { min: 1 },
  ),
  rules: ["Every id in `brings` is a declared part of that kind.", "A part is brought by at most one layer. A part no layer brings is always there.", "Every layer is added by exactly one stage of the [ladder](/api/puzzle#ladder)."],
  examples: [fromPaths("layers", ["paths", "loops"])],
});

const ladder = page({
  key: "ladder",
  title: "ladder",
  lede: "The puzzle's stages in order: how it opens up for a new player.",
  about: ["A stage changes nothing but which layers are on. Its round length, its settings and its tier starts are the whole puzzle's.", "The host keeps each player's place on a ladder, and a player only moves forward. Only rounds of the whole puzzle, at the last stage, build standing."],
  ideas: { title: "The ladder", path: "/domain/depth-and-judgement#the-ladder" },
  need: "required",
  type: arr(
    obj(
      [
        req("stage", id, "The stage's id. The host keeps a player's place by it.", { must: "Be `full` on the last stage, and on no other." }),
        req("adds", arr(ref("layer"), { min: 1, noun: "layer ids" }), "The layers it switches on, beside every layer an earlier stage added."),
        when(
          "the stage is not the last",
          "advance",
          obj([
            req(
              "measure",
              en(
                ["best-round", "The player's best round at this stage. Counted in points."],
                ["average-of-last", "The average of the player's last few rounds at this stage. Counted in points."],
                ["wins-over-stand-in", "The player's wins over a stand-in at this stage. Counted in wins."],
                ["rounds-played", "The rounds the player has played at this stage. Counted in rounds."],
              ),
              "What the player is measured by.",
              { never: "`wins-over-stand-in` in a solo puzzle." },
            ),
            req("threshold", int(1), "The bar to clear, in the measure's unit: points, wins or rounds."),
          ]),
          "The bar a player clears to move to the next stage.",
          { never: "The stage `full`. There is nowhere further to go." },
        ),
      ],
      "stage",
    ),
    { min: 1, max: 4 },
  ),
  rules: ["A ladder has one to four stages. A ready puzzle's has at least two: one stage, `full`, is what a puzzle has before it says how it opens up.", "Each layer is added by exactly one stage, and no stage switches a layer off.", "The last stage is `full`, the whole puzzle. It has no `advance`. Every other stage has one."],
  examples: [fromPaths("ladder")],
});

const evaluation = page({
  key: "evaluation",
  title: "evaluation",
  lede: "How a round is judged on the five tiers every puzzle shares.",
  about: ["Every round is judged as Green, Steady, Sharp, Masterful or Legendary. The tiers are the same for every puzzle, and the scale under them is the host's.", "A puzzle places its own scores on that scale by saying where four of the tiers start. Green starts at zero."],
  ideas: { title: "Judgement", path: "/domain/depth-and-judgement#judgement" },
  need: { when: "the puzzle is ready" },
  absent: "The puzzle is valid and not yet ready. Its rounds are scored and never judged.",
  type: obj([
    when(BETWEEN, "by", en(["outcome", "A round is judged by who won, weighted by the opponent's standing: beating a stronger opponent earns more."], ["score", "A round is placed through `tierStarts`, as a solo round is, whoever the opponent was."]), "How a round between sides is judged.", {
      never: "A solo puzzle. It is always judged by its score.",
    }),
    when(
      "the puzzle is solo, or `by` is `score`",
      "tierStarts",
      obj([
        req("steady", int(1), "The score at which Steady begins."),
        req("sharp", int(1), "The score at which Sharp begins. More than `steady`."),
        req("masterful", int(1), "The score at which Masterful begins. More than `sharp`."),
        req("legendary", int(1), "The score at which Legendary begins. More than `masterful`."),
      ]),
      "The score at which each tier begins. A round's performance is its score placed through these, in straight lines between them. No host or role can move them.",
      { never: "A puzzle whose `by` is `outcome`. Its rounds are not judged by score." },
    ),
    req("paceWindowSeconds", int(1, undefined, "seconds"), "The stretch that pace is read over while a round is played: about the time two of the puzzle's scoring events take."),
  ]),
  rules: ["`by` is present exactly when the puzzle has `opponents`.", "`tierStarts` is present unless `by` is `outcome`.", "The four tier starts rise: steady, then sharp, then masterful, then legendary."],
  examples: [fromPaths("evaluation"), { title: "Judged by who won", value: { evaluation: { by: "outcome", paceWindowSeconds: 20 } } }],
});

// ---------------------------------------------------------------- in and out

const signal: Type = obj(
  [
    req("id", id, "The signal's id."),
    when("it carries one value", "type", fieldTypes("number", "flag", "outcome"), "What it carries, where that is one value.", { never: "Together with `fields`." }),
    when("it carries several values", "fields", map("<field>", "A name for the value.", fieldTypes("place", "places", "direction", "piece", "number", "flag")), "What it carries, where that is several values. Each is typed as a move's field is.", {
      never: "Together with `type`.",
    }),
    opt("seat", bool, "True when it is for one seat: a signal in names the seat it is for, and a signal out the seat it is about.", { absent: "False: it is the round's." }),
    req("when", en(["on-change", "Whenever its value changes."], ["sampled", "Whenever whatever reads it asks."], ["at-end", "Once, when the round ends."]), "When it flows."),
  ],
  "signal",
);

const signals = page({
  key: "signals",
  title: "signals",
  lede: "The values that cross between the puzzle and whatever is outside it.",
  about: [
    "A signal in steers the puzzle from outside, as a ship's damage raises a line. It is never a move, but the log keeps it, so a replay sees it. The loop hands each one to `onSignal`.",
    "A signal out is read by a role. The two common ones are the puzzle's pace, sampled when a role asks, and the outcome of a round between sides.",
  ],
  ideas: { title: "Signals in", path: "/domain/moves-and-events#signals-in" },
  need: "required",
  type: obj([req("in", arr(signal), "The signals the puzzle takes. The list may be empty."), req("out", arr(signal), "The signals the puzzle gives. The list may be empty.")]),
  rules: ["A signal has `type` or `fields`, and never both.", "An `outcome` is carried only by a signal out, at the end, in a puzzle between sides.", "An attack from one board to another is part of the rules, not a signal. Signals only cross the puzzle's edge."],
  examples: [
    { title: "A level in, a pace out", value: { signals: { in: [{ id: "level", type: "number", when: "on-change" }], out: [{ id: "pace", type: "number", when: "sampled" }] } } },
    { title: "Several values for one seat, and an outcome", value: { signals: { in: [{ id: "supply", fields: { shots: "number", tokens: "number" }, seat: true, when: "on-change" }], out: [{ id: "outcome", type: "outcome", when: "at-end" }] } } },
  ],
});

const GESTURES = en(
  ["tap", "The player taps a place or a control."],
  ["long-press", "The player presses and holds a place."],
  ["draw", "The player draws a path through touching cells."],
  ["drag", "The player drags from one place to another."],
  ["swipe", "The player swipes a direction, anywhere or starting on a piece."],
  ["slice", "The player slices along a line of the grid."],
  ["turn", "The player turns around the board's centre."],
  ["hold", "The player keeps pressing to hurry what is happening."],
);

const moves = page({
  key: "moves",
  title: "moves",
  lede: "Every act a player can make: its id, the gesture that makes it, and what it carries.",
  about: ["A move is what a player sends and the log keeps. The loop checks a move's fields against the board before the rules see it, so `canMove` holds only the puzzle's own rule.", "No puzzle declares keys for a move. Every puzzle is played by keys with one scheme, which follows from the gesture."],
  ideas: { title: "The verb and its moves", path: "/domain/moves-and-events#the-verb-and-its-moves" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The move's id. It is the name the rules know the move by, and the name a phase lists it by."),
        req("description", sentence, "What the move is."),
        req("gesture", GESTURES, "How a player makes it by touch."),
        opt("inHand", bool, "True when the move is built in hand first: the player takes a piece, moves, turns or flips it, and only setting it down is the move. Adjusting what is in hand never reaches the log.", {
          absent: "False: the gesture is the move.",
        }),
        req("fields", map("<field>", "A name for the value, which the rules read it by.", fieldTypes("place", "places", "direction", "piece", "number", "flag")), "What the move carries. An empty object for a move that carries nothing, such as a skip.", {
          must: "Fit the gesture. A `draw` carries a `places` field, a `drag` two `place` fields, a `swipe` a `direction`.",
        }),
      ],
      "move",
    ),
    { min: 1 },
  ),
  rules: [
    "The puzzle's `verb` is the id of one of these.",
    "A move with no place, such as a skip, is made with a [control](/api/puzzle#controls).",
    "No move ends a round. A round ends by its endings.",
    "Where the puzzle has phases, every move is listed by at least one phase.",
  ],
  examples: [fromPaths("moves"), { title: "A verb and a lesser move", value: { moves: [{ id: "swap", description: "swap two pieces side by side", gesture: "drag", fields: { a: "place", b: "place" } }, { id: "skip", description: "give up the lit clamp", gesture: "tap", fields: {} }] } }],
});

const controls = page({
  key: "controls",
  title: "controls",
  lede: "The buttons a puzzle declares, for a move that has no place on the board.",
  about: ["A skip, calling the next crate early and asking for the next hand have nowhere to be tapped. Each is made with a control. A control can also be a switch that changes what a tap does without being a move itself."],
  ideas: { title: "How a move is made", path: "/domain/moves-and-events#how-a-move-is-made" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The control's id. The skin labels it with the text `control.<id>`."),
        req("move", or({ label: "a move", type: ref("move"), description: "Using the control makes this move." }, { label: "a switch", type: lit("none"), description: "Using it makes no move. It only changes what a tap does, and never reaches the log." }), "What using it does."),
        req("key", str("one letter", "^[A-Za-z]$"), "The letter that uses it on a keyboard.", {
          never: ["W, A, S, D, Q, E or F. The shared scheme uses them to move the cursor and to turn and flip what is in hand.", "Z or C on a grid whose cells touch on eight. There they move the cursor diagonally.", "A letter another control of the puzzle uses."],
        }),
      ],
      "control",
    ),
  ),
  rules: ["A control's `move` carries no place: its `fields` hold nothing the player must point at.", "A control a phase names in `next`, or a task in `control` or `next`, is declared here."],
  examples: [{ title: "A move, and a switch", value: { controls: [{ id: "call", move: "call", key: "N" }, { id: "mode", move: "none", key: "L" }] } }],
});

const events = page({
  key: "events",
  title: "events",
  lede: "Everything the rules can report: what happened, what it carries, and what it can change on the board.",
  about: [
    "An event is the only way the rules change a round. Every change to the board and every number a player sees counted arrives on one, so a board that plays from events always shows what happened.",
    "A round's start, its countdown and its end are the host's, the same for every puzzle. A puzzle declares only its own events.",
  ],
  ideas: { title: "Events", path: "/domain/moves-and-events#events" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The event's id. The rules report it by this id.", { never: "`start`, `countdown` or `end`. Those three are the host's." }),
        req("description", sentence, "What happened."),
        req("fields", map("<field>", "A name for the value.", fieldTypes("place", "places", "piece", "seat", "side", "number", "points")), "What it carries. An empty object for an event that carries nothing.", {
          never: "More than one field of type `points`.",
        }),
        opt("mistake", bool, "True when it is a mistake: something a player who plays well can always avoid. It costs points through a penalty payout, the streak, or both. What luck alone deals is never a mistake.", {
          absent: "False.",
          never: "An event that ends the round. An ending that does is a `fail`.",
        }),
        opt(
          "changes",
          arr(
            en(
              ["arrive", "A piece comes onto the board: from where it stands, from a spot in a zone, or from off the board in a direction."],
              ["leave", "A piece goes from the board: cleared, or taken to a spot in a zone."],
              ["travel", "A piece goes from one cell to another, or between a zone and the board."],
              ["change", "A piece's state or kind, or a cell's terrain, becomes another where it stands."],
            ),
            { min: 1, noun: "board changes" },
          ),
          "The board changes it can carry. A change it does not list is refused when the rules report it.",
          { absent: "It changes nothing on the board." },
        ),
        opt("step", bool, "True when it counts as a step of a cascade. The loop counts the steps, and a multiplier indexed by `step` reads the count.", { absent: "False." }),
        opt("closes", ref("phase"), "The phase it closes. Closing a phase closes those inside it.", { absent: "It closes none." }),
        opt("reveals", arr(or({ label: "a zone", type: ref("zone") }, { label: "the board", type: lit("board") }), { min: 1, noun: "zone ids or `board`" }), "The hidden places it reveals. The rules can read a hidden piece only while reporting an event that reveals its place.", {
          absent: "It reveals nothing.",
          must: "Name only places that hide pieces: a zone or a board whose `seenBy` is not `everyone`.",
        }),
      ],
      "event",
    ),
    { min: 1 },
  ),
  rules: [
    "An event that a payout pays on has a field of type `points`. The rules leave that field out, and the loop fills it in when it pays the event.",
    "Every place that hides something is revealed by at least one event.",
    "An event a layer brings is reported only while that layer is on.",
    "A puzzle with a streak has an event that says it grew, so a board can show it.",
  ],
  examples: [fromPaths("events", ["clear", "refill", "loop", "blowup"]), { title: "An event that closes a phase and shows cards", value: { events: [{ id: "showdown", description: "the hands left in were shown", fields: { winner: "seat", points: "points" }, closes: "hand", reveals: ["hand"] }] } }],
});

const moment = page({
  key: "moment",
  title: "moment",
  lede: "The one event that is the puzzle's biggest, and how big each one is.",
  about: ["Every skin plays its beat on the moment: one pulse over the whole board, stronger for a bigger moment. Which event is biggest follows from scoring, so the puzzle names it and every skin agrees."],
  ideas: { title: "The moment and the beat", path: "/domain/motion#the-moment-and-the-beat" },
  need: { when: "the puzzle is ready" },
  absent: "The puzzle is valid and not yet ready. No skin plays a beat.",
  type: obj([
    req("event", ref("event"), "The event."),
    opt("when", condition, "A condition on the event's fields. The beat plays only on an event that meets it.", { absent: "Every such event is a moment." }),
    req("size", ref("event field"), "The field of the event that says how big this one is.", { must: "Name a field of `event` whose type is `number`." }),
    req("most", amount, "The size that counts as biggest. A moment of this size or more gets the strongest pulse."),
  ]),
  rules: ["`size` is a `number` field of the event `event` names."],
  examples: [fromPaths("moment")],
});

const gauges = page({
  key: "gauges",
  title: "gauges",
  lede: "The numbers a player watches while a round is played, besides the score.",
  about: ["Taps left, a rising line, cuts left, a crate's countdown. Counts the rules keep that are not points, such as chips or tricks taken, are gauges too."],
  ideas: { title: "Gauges", path: "/domain/moves-and-events#gauges" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The gauge's id. The skin labels it with the text `gauge.<id>`."),
        req("description", sentence, "What it counts."),
        opt("most", amount, "The most it can reach, where it has a most.", { absent: "It has no most, as a streak has none." }),
        opt("danger", int(), "The value past which it means danger, such as heat past half.", { absent: "It never means danger." }),
        opt("each", EACH, "Whether there is one for the round, for each seat or for each side.", { absent: "`round`." }),
      ],
      "gauge",
    ),
  ),
  rules: ["A puzzle with a [streak](/api/puzzle#streak) has a gauge for its count.", "A gauge a layer brings is shown only while that layer is on."],
  examples: [fromPaths("gauges"), { title: "A gauge for each seat, with a danger line", value: { gauges: [{ id: "heat", description: "how hot the core runs", most: 100, danger: 50, each: "seat" }] } }],
});

const stats = page({
  key: "stats",
  title: "stats",
  lede: "The counts the rules keep about a round, shown when it ends.",
  about: ["The longest path, loops closed, mistakes made. A stat is told to the player once, on the result."],
  ideas: { title: "Stats", path: "/domain/moves-and-events#stats" },
  need: "required",
  type: arr(obj([req("id", id, "The stat's id. The skin labels it with the text `stat.<id>`."), req("description", sentence, "What it counts.")], "stat")),
  rules: ["A puzzle with a [streak](/api/puzzle#streak) declares the stat `best_streak`. The rules keep the round's best streak in it."],
  examples: [fromPaths("stats", ["best_streak", "longest", "loops"])],
});

// ---------------------------------------------------------------- scoring

const payouts = page({
  key: "payouts",
  title: "payouts",
  lede: "Every way the puzzle pays: the events it pays on, what it counts, and how its points grow.",
  about: [
    "Every point belongs to a payout. The rules report events, and the loop works out the points from what is declared here, so a round can always be broken down by what each payout paid.",
    "A penalty is a payout whose points are taken away: its setting holds a number below zero.",
  ],
  ideas: { title: "Payouts", path: "/domain/scoring#payouts" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The payout's id. A multiplier scales it by this id."),
        req("description", sentence, "What it pays for."),
        req("on", arr(ref("event"), { min: 1, noun: "event ids" }), "The events it pays on.", { must: "Name events that each have a field of type `points`." }),
        when("`growth` is `linear`, `superlinear` or `stepped`", "counts", ref("event field"), "The event's field it grows from. A `number` field is read as it is. A `places` field is counted: a path's cells, the pieces inside a loop.", {
          never: "A payout whose `growth` is `flat`.",
          must: "Name a `number` or `places` field that every event in `on` has.",
        }),
        req(
          "growth",
          en(
            ["flat", "The same points every time: the value of the setting it reads."],
            ["linear", "The setting it reads, times the count."],
            ["superlinear", "The setting it reads, times the count squared."],
            ["stepped", "An entry of the list it reads, one for each count from 1, whose last entry holds for every count past it."],
          ),
          "How its points rise with what it counts.",
        ),
        opt("cap", amount, "The count past which it grows no faster. A count above the cap pays as the cap does.", { absent: "It has no cap.", never: "A payout whose `growth` is `flat`." }),
        req("reads", arr(ref("setting"), { noun: "setting ids" }), "The settings that size it. A payout that reads none pays one point for each thing it counts, which is what a puzzle pays before it says otherwise. A ready puzzle's payout reads at least one.", {
          must: ["Name a setting of type `whole` for `flat`, `linear` and `superlinear`.", "Name a setting of type `list` for `stepped`."],
        }),
      ],
      "payout",
    ),
  ),
  rules: [
    "A `flat` payout has no `counts` and no `cap`. Every other payout has `counts`.",
    "A `stepped` payout reads a list. The others read a whole number.",
    "Every event a payout pays on carries a `points` field.",
    "A payout a layer brings pays only while that layer is on.",
  ],
  examples: [fromPaths("payouts", ["path", "inside", "bounty"]), { title: "A stepped payout with a cap, and a penalty", value: { payouts: [{ id: "rows", description: "clearing more rows at once pays far more", on: ["clear"], counts: "rows", growth: "stepped", cap: 4, reads: ["rowPoints"] }, { id: "wrong_lock", description: "locking an empty cell costs points", on: ["wrong_lock"], growth: "flat", reads: ["wrongLockPoints"] }] } }],
});

const multipliers = page({
  key: "multipliers",
  title: "multipliers",
  lede: "What scales the puzzle's payouts, and by how much.",
  about: ["A multiplier scales named payouts on an event by a percent. Multipliers that meet on one event multiply together, and the result is rounded down once for the event, never once for each multiplier."],
  ideas: { title: "Multipliers", path: "/domain/scoring#multipliers" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The multiplier's id."),
        req("description", sentence, "What it rewards."),
        req("scales", arr(ref("payout"), { min: 1, noun: "payout ids" }), "The payouts it scales. A payout it does not list is paid as it is."),
        req("on", condition, "The event it applies on, and any condition on it. Written as an event's id where it is that plain."),
        req(
          "by",
          or(
            { label: "one percent", description: "Every time it applies, it scales by the same percent.", type: obj([req("percent", ref("setting"), "The setting that holds the percent. Of type `percent`.")]) },
            {
              label: "a table",
              description: "It scales by an entry of a list, read at a count the loop keeps. The last entry holds for every count past it.",
              type: obj([
                req("table", ref("setting"), "The setting that holds the percents. Of type `list`."),
                req("index", en(["streak", "The streak's count: the first entry for no streak, the next for one success in a row, and so on."], ["step", "The cascade's step: the first entry for what the move itself did, the next for the first step it set off."]), "Which count picks the entry."),
              ]),
            },
          ),
          "How much it scales by.",
        ),
      ],
      "multiplier",
    ),
  ),
  rules: [
    "`by` holds `percent`, or `table` with `index`. Never both forms.",
    "`index: \"streak\"` needs the puzzle to declare a [streak](/api/puzzle#streak).",
    "`index: \"step\"` needs at least one event whose `step` is true.",
    "A percent of 100 leaves a payout as it is. A table's entries are percents too.",
  ],
  examples: [fromPaths("multipliers")],
});

const streak = page({
  key: "streak",
  title: "streak",
  lede: "The run of successes that raises a multiplier, where a puzzle has one.",
  about: ["A puzzle has at most one streak. What it raises is a multiplier whose table is indexed by the streak. The loop keeps the count, and the rules keep the round's best as the stat `best_streak`."],
  ideas: { title: "The streak", path: "/domain/scoring#the-streak" },
  need: "optional",
  absent: "The puzzle has no streak.",
  type: obj([
    req(
      "builds",
      or(
        { label: "an event", description: "The streak grows when this event is reported and meets the condition.", type: obj([req("event", condition, "The event that builds it, by id. Where more than one does, their ids joined by `or`."), opt("when", condition, "A condition on the event.", { absent: "Every such event builds it." })]) },
        { label: "a task's grade", description: "The streak grows when a task ends with this grade.", type: obj([req("grade", name, "The grade, as one of a task's `grades`.")]) },
      ),
      "What builds it.",
    ),
    req("grace", int(0), "How many misses in a row it forgives before it breaks. A miss is a move, or a task, that builds nothing. At 0 the first miss breaks it."),
    req("breaksOn", arr(ref("event"), { noun: "event ids" }), "The mistakes that break it at once, whatever its grace. The list may be empty.", { must: "Name only events whose `mistake` is true." }),
  ]),
  rules: [
    "`builds` holds `event`, with or without `when`, or it holds `grade`. Never both forms.",
    "A streak built by a grade needs a task that has that grade.",
    "A puzzle with a streak has a multiplier whose `by.index` is `streak`, a gauge for the count, and the stat `best_streak`.",
  ],
  examples: [fromPaths("streak"), { title: "Built by a task's grade", value: { streak: { builds: { grade: "clean" }, grace: 0, breaksOn: [] } } }],
});

const tasks = page({
  key: "tasks",
  title: "tasks",
  lede: "The units of work the deal sets within a round: a slab to cut, a clamp to fill, a posted bounty.",
  about: [
    "A task is one seat's graded work, and several can be open at once. The loop keeps which tasks are open, grades each one and pays on the grade. The rules deal a task when the loop asks, and say on an event when one is done.",
    "Par is the fewest moves that can finish a task. Best is the most any play could score from it. The rules work out both when the task is dealt. Par is shown to the player. Best never is.",
  ],
  ideas: { title: "Tasks", path: "/domain/scoring#tasks" },
  need: "required",
  type: arr(
    obj(
      [
        req("id", id, "The task's id."),
        req("description", sentence, "What finishes it."),
        req("open", int(1), "How many can be open at once. When fewer are, the loop asks the rules to deal one."),
        req(
          "ends",
          arr(en(["done", "The player finishes it."], ["given-up", "The player gives it up with a control. It takes `control`."], ["out-of-time", "Its time runs out. It takes `setting`."]), { min: 1, noun: "ways" }),
          "Every way it can end.",
        ),
        when("`ends` holds `given-up`", "control", ref("control"), "The control that gives it up.", { never: "A task that cannot be given up." }),
        when("`ends` holds `out-of-time`", "setting", ref("setting"), "The setting that times it.", { never: "A task that cannot run out of time." }),
        req("graded", en(["par", "Against par: the fewest moves that can finish it."], ["best", "Against best: the most any play could score from it."], ["none", "Not at all. It is done or it is not."]), "What it is graded against."),
        req("grades", arr(name, { noun: "names" }), "Its grades, in order from best, such as `clean`, `full` and `slow`.", { must: "Be empty where `graded` is `none`, and hold at least two names otherwise." }),
        opt("next", or({ label: "dealt", type: lit("dealt"), description: "The next one is dealt as soon as one is needed." }, { label: "asked for", type: ref("control"), description: "The player asks for the next one with this control, as a new hand is asked for." }), "How the next one comes.", {
          absent: "`dealt`.",
        }),
      ],
      "task",
    ),
  ),
  rules: [
    "`control` is present exactly when `ends` holds `given-up`, and `setting` exactly when it holds `out-of-time`.",
    "`grades` is empty exactly when `graded` is `none`.",
    "A puzzle with tasks answers the `onTaskNeeded` hook.",
    "Every task in a round is dealt from the same settings, from the first second to the last. A task never gets harder because the last one went well.",
  ],
  examples: [fromPaths("tasks"), { title: "A graded task that can be given up or time out", value: { tasks: [{ id: "slab", description: "cut the slab into the blocks shown", open: 1, ends: ["done", "given-up", "out-of-time"], control: "scrap", setting: "slabSeconds", graded: "par", grades: ["clean", "full", "slow"], next: "dealt" }] } }],
});

// ---------------------------------------------------------------- words

const texts = page({
  key: "texts",
  title: "texts",
  lede: "The keys a skin must give a text for, and the values each text may show.",
  about: ["The puzzle declares the keys and their placeholders. The words themselves are the skin's, so the same puzzle reads as salvage in one theme and as something else in another."],
  ideas: { title: "The skin", path: "/domain/skins-and-themes#the-skin" },
  need: "required",
  type: arr(
    obj(
      [
        req("key", str("a text key", "^[a-z][a-z_]*(\\.[A-Za-z0-9_]+)?$"), "The key. Either one of the two plain keys, `name` and `how_to`, a key of the puzzle's own, or a kind and an id joined by a dot."),
        opt("placeholders", arr(name, { min: 1, noun: "names" }), "The values a text for this key may show, each written in the text in braces. For an event's callout they are fields of the event.", { absent: "The text shows no value." }),
      ],
      "text key",
    ),
    { min: 2 },
  ),
  rules: [
    "Every puzzle declares `name` and `how_to`.",
    "It declares `stage.<id>` and `stage.<id>_intro` for every stage of its ladder, `full` included.",
    "It declares `piece.<id>` for every piece, and `piece.<id>_<n>` for every kind a family's setting allows, counted from 1.",
    "It declares `stat.<id>`, `gauge.<id>` and `control.<id>` for every stat, gauge and control.",
    "It declares `event.<id>` for each event that has a callout. An event with none has no key.",
    "It may declare more keys of its own.",
  ],
  examples: [{ title: "Paths", value: { texts: [{ key: "name" }, { key: "how_to" }, { key: "stage.full" }, { key: "stage.full_intro" }, { key: "piece.kind_1" }, { key: "piece.prize" }, { key: "event.loop", placeholders: ["prizes"] }, { key: "gauge.prizes", placeholders: ["count", "max"] }, { key: "stat.longest" }] } }],
});

const teaching = page({
  key: "teaching",
  title: "teaching",
  lede: "Whether the puzzle can show what a move would do, and whether it offers a move to a player who is stuck.",
  about: ["Both are questions asked of the rules, so neither changes a round."],
  ideas: { title: "What a player sees", path: "/domain/sides#what-a-player-sees" },
  need: "required",
  type: obj([
    req("preview", bool, "Whether the board can tell what a move would do before it is made.", { must: "Have the rules answer a question of their own that previews a move, where it is true." }),
    req("hint", bool, "Whether the puzzle offers a move worth making to a player who is stuck. A round that counts never hints, whatever this says.", { must: "Have the rules answer the [`hint`](/api/hooks#hint) hook, where it is true." }),
  ]),
  examples: [fromPaths("teaching")],
});

const history = page({
  key: "history",
  title: "history",
  lede: "One entry for each version the puzzle has had, saying what changed.",
  about: ["A host may show the newest entry when a player first meets a new version."],
  ideas: { title: "Versions", path: "/domain/versions" },
  need: "required",
  type: arr(obj([req("version", alias("version"), "The version the entry is for."), req("description", sentence, "What changed, in one plain sentence a player could read.")], "history entry"), { min: 1 }),
  rules: ["The list runs from the oldest version to the newest.", "It has an entry for the puzzle's current `version`.", "The version rises once for each change that is merged, never at each save of a draft."],
  examples: [fromPaths("history"), { title: "After two changes", value: { history: [{ version: "0.1", description: "First version" }, { version: "0.2", description: "loops pay 10% more" }, { version: "1.0", description: "prizes are dealt on a stream of their own" }] } }],
});

// ---------------------------------------------------------------- the puzzle

export const PUZZLE: RootObject = {
  root: "puzzle",
  file: "<id>.puzzle.json",
  title: "Puzzle",
  lede: "Everything about a puzzle except what a move does: its round, its board and pieces, its deal, what goes in, what comes out and what pays.",
  about: [
    "The puzzle object is one JSON file, `<id>.puzzle.json`. It holds nothing from any world: no picture, no sound, no name a player reads. Those are its [skin](/api/skin)'s.",
    "What a move does is the one thing it leaves to code: the [rules](/api/rules). Everything the rules name must be declared here, and everything declared here must be used by the rules.",
    "Every object inside it is defined below, on this page. Every key is present unless its section says it may be left out, and a list with nothing in it is written `[]`.",
  ],
  groups: [
    {
      title: "Identity",
      fields: [
        req("id", id, "A neutral word for the mechanic, such as `paths` or `swap`. It names the puzzle everywhere, and its files are named by it.", { never: "A word from a theme. The skin gives the puzzle the name a player reads." }),
        req("version", alias("version"), "Which form of the puzzle this is: one version for its rules and this object together.", { must: "Have an entry in `history`." }),
        history,
        req("mechanic", sentence, "The whole puzzle in one sentence."),
        req("verb", ref("move"), "The move the puzzle is built around: the act a new player learns first."),
      ],
    },
    { title: "The round", fields: [round] },
    { title: "Sides and points", note: "A solo puzzle leaves all three out.", fields: [opponents, points, placing] },
    { title: "The board", fields: [board, terrain, zones, pieces] },
    { title: "What goes in", fields: [settings, relations, moves, controls, signals] },
    { title: "The deal", fields: [deal] },
    { title: "What comes out", fields: [events, moment, gauges, stats] },
    { title: "Scoring", fields: [payouts, multipliers, streak, tasks] },
    { title: "Depth and judgement", fields: [layers, ladder, evaluation] },
    { title: "Words and teaching", fields: [texts, teaching] },
  ],
  ready: {
    intro: "A puzzle is **valid** when it has a board, a piece, a move and an ending, its rules answer `onStart`, `canMove` and `onMove`, every id it names is declared, and it can list its moves where it declares a check. A valid puzzle plays in the studio: its rounds are scored and never judged, and the game cannot deal it. It is **ready**, and may be promoted into the game, when all of this holds as well.",
    items: [
      "Every required key is filled in, with `moment` and `evaluation` among them.",
      "The ladder has two to four stages, each layer is added by exactly one, and the last is `full`.",
      "Every payout reads at least one setting.",
      "The rules know every part the puzzle declares, and the puzzle declares every part the rules name.",
      "The moment names one of the puzzle's events and a number field of it.",
      "Every draw has a stream of its own, every check has a fallback that passes and the rules answer `onFallback`, and every place that hides something has an event that reveals it.",
      "Every phase can close, every move belongs to a phase where the puzzle has phases, and every ending has a reason.",
      "A puzzle between sides can list the moves a round allows, or brings a stand-in of its own. It names its absent stand-in and says how its sides are placed.",
      "The puzzle keeps witness rounds, each still giving the read recorded for it, and a history entry for its current version.",
      "Its skin has a drawing for every piece, state and kind, a cue for every cue an event names, a text for every key, a beat cue, and a motion for every board change.",
    ],
    outro: "A puzzle that is not ready can still be edited and dressed, and a valid one can be played. A puzzle with no rules yet cannot be played.",
  },
  example: {
    title: "Paths, in outline",
    note: "Each object is cut to a line. The whole file is on [Paths, in full](/api/paths).",
    value: {
      id: PATHS.id,
      version: PATHS.version,
      history: PATHS.history,
      mechanic: PATHS.mechanic,
      verb: PATHS.verb,
      round: PATHS.round,
      board: PATHS.board,
      terrain: [],
      zones: [],
      pieces: PATHS.pieces,
      settings: [(PATHS.settings as unknown[])[3]],
      relations: [(PATHS.relations as unknown[])[0]],
      moves: PATHS.moves,
      controls: [],
      signals: PATHS.signals,
      deal: { draws: [((PATHS.deal as { draws: unknown[] }).draws)[0]], checks: [], bounds: [] },
      events: [(PATHS.events as unknown[])[0]],
      moment: PATHS.moment,
      gauges: [(PATHS.gauges as unknown[])[0]],
      stats: [(PATHS.stats as unknown[])[0]],
      payouts: [(PATHS.payouts as unknown[])[0]],
      multipliers: [(PATHS.multipliers as unknown[])[0]],
      streak: PATHS.streak,
      tasks: [],
      layers: [(PATHS.layers as unknown[])[0]],
      ladder: [(PATHS.ladder as unknown[])[0], (PATHS.ladder as unknown[])[3]],
      evaluation: PATHS.evaluation,
      texts: [{ key: "name" }, { key: "how_to" }],
      teaching: PATHS.teaching,
    },
  },
};
