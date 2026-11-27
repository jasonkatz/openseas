import skinRaw from "../../../../../docs/puzzles/examples/paths.skin.json?raw";
import { alias, arr, bool, en, int, map, num, obj, opt, or, ref, req, str, when, type Example, type Field, type ObjectPage, type RootObject, type Type } from "./types.js";

/** The skin of Paths in the space theme, written out in full beside the guide. */
export const PATHS_SKIN = JSON.parse(skinRaw) as Record<string, Record<string, unknown>>;

const page = (p: Omit<ObjectPage, "root">): ObjectPage => ({ root: "skin", ...p });

function cut(key: string, names: readonly string[]): Example {
  const from = PATHS_SKIN[key]!;
  return { title: "Paths in the space theme", value: { [key]: Object.fromEntries(names.map((n) => [n, from[n]])) } };
}

const colourName = alias("colour name");

// ---------------------------------------------------------------- drawings

/** Where on the 24 unit square, and how far off it a layer may reach. */
const U = num(-12, 36, "units");
/** A length on the square. */
const L = num(0, 48, "units");
const DEG = num(-720, 720, "degrees");

const layerCommon: readonly Field[] = [
  opt("name", str("up to 32 characters"), "What the layer is called in an editor. Nothing draws it.", { absent: "It has no name." }),
  opt("cut", bool, "True to cut the shape out of what the layers before it drew, so the ground shows through. It is how a piece gets its one inner detail.", { absent: "False: the shape is painted." }),
  opt("turn", DEG, "Turns the layer about the square's centre, clockwise.", { absent: "0." }),
  opt("copies", int(1, 12), "Draws the layer this many times in all, each turned `spread` further than the last, as a cog's teeth are.", { absent: "1." }),
  opt("spread", DEG, "How much further each copy is turned than the one before it.", { absent: "0.", only: "With `copies` above 1." }),
];

/** A layer. The mark a count repeats is one too, and may leave out where it sits across the piece. */
const xOf = (mark: boolean, description: string): Field =>
  mark ? opt("x", U, description, { absent: "The count places each mark across the piece itself." }) : req("x", U, description);

const layerOf = (mark: boolean): Type => ({
  kind: "variants",
  noun: "layer",
  on: "kind",
  common: layerCommon,
  variants: [
    {
      value: "rect",
      description: "A rounded rectangle.",
      fields: [xOf(mark, "Its left edge."), req("y", U, "Its top edge."), req("w", L, "Its width."), req("h", L, "Its height."), req("r", L, "The radius of its corners. 0 for square corners.")],
    },
    { value: "disc", description: "A disc.", fields: [xOf(mark, "Its centre, across."), req("y", U, "Its centre, down."), req("r", L, "Its radius.")] },
    {
      value: "poly",
      description: "A filled polygon with rounded corners.",
      fields: [
        req("points", arr(U, { min: 6, max: 128, noun: "numbers" }), "Its corners in order, as x then y for each: `[x0, y0, x1, y1, …]`.", { must: "Hold an even count of numbers: at least three corners." }),
        req("round", L, "How far its corners are rounded. 0 for sharp corners."),
      ],
    },
    {
      value: "bar",
      description: "A stroke with round ends, from one point to another.",
      fields: [req("x0", U, "Where it starts, across."), req("y0", U, "Where it starts, down."), req("x1", U, "Where it ends, across."), req("y1", U, "Where it ends, down."), req("width", L, "How thick it is.")],
    },
    {
      value: "arc",
      description: "A stroked arc about a point.",
      fields: [
        req("x", U, "The centre it bends about, across."),
        req("y", U, "The centre it bends about, down."),
        req("r", L, "Its radius."),
        req("from", DEG, "Where it starts, clockwise from three o'clock."),
        req("to", DEG, "Where it ends, clockwise from three o'clock."),
        req("width", L, "How thick it is."),
        opt("cap", bool, "True to round its ends.", { absent: "False: its ends are flat." }),
      ],
    },
    {
      value: "path",
      description: "A stroked line through points, with bends: a hook, a horseshoe.",
      fields: [
        req(
          "steps",
          arr(
            or(
              { label: "a point", description: "The line runs straight to it.", type: obj([req("x", U, "How far across the point is."), req("y", U, "How far down the point is.")]) },
              {
                label: "a bend",
                description: "From the last point, the line runs round a circle.",
                type: obj([
                  req("x", U, "The circle's centre, across."),
                  req("y", U, "The circle's centre, down."),
                  req("r", L, "The circle's radius."),
                  req("from", DEG, "Where on the circle the bend starts, clockwise from three o'clock."),
                  req("to", DEG, "Where on the circle it ends."),
                  opt("ccw", bool, "True to run round it anticlockwise.", { absent: "False: clockwise." }),
                ]),
              },
            ),
            { min: 2, max: 32, noun: "steps" },
          ),
          "What the line runs through, in order.",
        ),
        req("width", L, "How thick it is."),
        opt("cap", bool, "True to round its ends.", { absent: "False." }),
        opt("fill", bool, "True to fill it as well, as one closed shape.", { absent: "False: it is only stroked." }),
      ],
    },
  ],
});
const layer = layerOf(false);

const drawing: Type = obj(
  [
    when("the drawing has no `over`", "tint", colourName, "The colour the piece is painted in. A drawing with `over` may leave it out, and is then painted in the colour of the piece under it."),
    req("layers", arr(layer, { min: 1, max: 32, noun: "layers" }), "Its shapes, painted in order on a square 24 units wide. Every layer is painted in the piece's one colour."),
    opt("over", ref("piece"), "The piece this drawing is laid over. That piece is drawn first, in its own colour and its own kind, and these layers go on top.", {
      absent: "It is drawn on nothing.",
      only: "The drawing of a piece whose `of` names that piece.",
    }),
    opt(
      "count",
      obj([
        req("layer", layerOf(true), "The mark that is repeated, once for each one counted. It is a layer like any other, and may leave out `x`: the marks are then spread evenly across the piece."),
        req("step", L, "How far apart the marks sit."),
      ]),
      "How the piece shows the number that is its state: one mark for each, such as a notch for each move a fuse has left.",
      { absent: "It shows no number.", only: "The drawing of a piece whose `states` is a count." },
    ),
  ],
  "drawing",
);

const pieces = page({
  key: "pieces",
  title: "pieces",
  lede: "A drawing for every piece the puzzle declares: every kind of a family, and every named state.",
  about: [
    "A drawing is a few flat shapes on a square 24 units wide, painted in one of the theme's colours. There are no image files: every piece is numbers.",
    "Each kind on a board must be told from every other by its silhouette alone. Colour is never the only signal.",
  ],
  ideas: { title: "The skin", path: "/domain/skins-and-themes#the-skin" },
  need: "required",
  type: map(
    "<piece>",
    "The id of one of the puzzle's pieces. A kind of a family is the piece's id, an underscore and the kind's number, counted from 1: `kind_3`.",
    or(
      { label: "a drawing", description: "For a piece with one form, a kind of a family, or a piece that shows a count.", type: drawing },
      { label: "a drawing for each state", description: "For a piece with named states.", type: map("<state>", "One of the piece's named states.", drawing) },
    ),
  ),
  rules: [
    "There is an entry for every piece the puzzle declares.",
    "A family has an entry for every kind its setting's `max` allows, not only its default.",
    "A piece with named states has a drawing under every state's name.",
    "A piece whose state is a count has a drawing with `count`.",
    "A drawing has 1 to 32 layers, and at most one of them is a `cut`: a piece has one colour and one inner detail.",
    "Every `tint` is one of the theme's colours.",
  ],
  examples: [cut("pieces", ["kind_2", "prize", "timed"]), { title: "A piece with named states", value: { pieces: { rod: { cold: { tint: "slate", layers: [{ kind: "rect", x: 9, y: 2, w: 6, h: 20, r: 3 }] }, hot: { tint: "rust", layers: [{ kind: "rect", x: 8, y: 2, w: 8, h: 20, r: 4 }] } } } } }],
});

// ---------------------------------------------------------------- cues

const param = str("a parameter's name");

const whenRange: Type = obj([
  req("param", param, "The value the board passes that decides it. A flag reads as 1 when set and 0 when not."),
  opt("from", num(), "The least the value may be.", { absent: "No least." }),
  opt("to", num(), "The most the value may be.", { absent: "No most." }),
]);

const voiceCommon: readonly Field[] = [
  req("at", num(0, 1, "seconds"), "When it starts, after the cue starts."),
  req("attack", num(0, 1, "seconds"), "How long it takes to rise from silence to full."),
  req("release", num(0.001, 1, "seconds"), "How long it takes to fall back to silence."),
  req("level", num(0.001, 1), "How loud it is within the cue."),
  opt("when", whenRange, "Sounds only while a value the board passes is in this range.", { absent: "It always sounds." }),
  opt(
    "repeat",
    obj([
      req("param", param, "The value the board passes that says how many times."),
      req("min", int(0, 8), "The fewest times it sounds in all. At 0 it may not sound."),
      req("max", int(0, 8), "The most times it sounds in all."),
      req("note", int(-8, 8), "How many steps of the scale each sounding is from the last."),
      req("at", num(0, 0.4, "seconds"), "How long after the last each one sounds."),
    ]),
    "Sounds it again a number of times the board says, each a few steps and a moment after the last.",
    { absent: "It sounds once." },
  ),
];

const voice: Type = {
  kind: "variants",
  noun: "voice",
  on: "kind",
  common: voiceCommon,
  variants: [
    {
      value: "tone",
      description: "A note of the theme's scale, sounded soft.",
      fields: [
        req("note", int(0, 15), "A step of the theme's scale, where 0 is its lowest note.", { must: "Be a step the theme's `sound.scale` has." }),
        req("wave", en(["sine", "A pure, round tone."], ["triangle", "A slightly brighter tone."]), "The shape of the tone."),
        opt("fixed", bool, "True to stay where it is when the cue is shifted.", { absent: "False: it moves with the cue." }),
      ],
    },
    {
      value: "air",
      description: "A breath of soft noise through a filter that moves.",
      fields: [
        req("from", num(20, 20000, "hertz"), "The filter's cutoff as the breath starts."),
        req("to", num(20, 20000, "hertz"), "The filter's cutoff as the breath ends."),
        req("band", bool, "True for a band-pass, as a whoosh is. False for a low-pass, as a thump is."),
      ],
    },
  ],
};

export const CUE: Type = obj(
  [
    req("level", num(0.01, 4), "The cue's level. 1 is about the peak every cue is tuned to."),
    req("cutoff", num(20, 20000, "hertz"), "The low-pass the whole cue passes through.", { must: "Be no higher than the theme's `sound.cutoff`." }),
    req("voices", arr(voice, { min: 1, max: 16, noun: "voices" }), "The voices that sound.", { must: "End, each of them, within the theme's `sound.longestMs`." }),
    opt(
      "shift",
      obj([
        req("param", param, "The value the board passes."),
        req("per", num(-16, 16), "How many steps the cue moves for each one of the value."),
        req("offset", num(-100, 100), "What is added to the value first."),
        req("min", num(-16, 16), "The fewest steps it may move."),
        req("max", num(-16, 16), "The most steps it may move."),
        req("round", en(["floor", "Round down to a whole step."], ["round", "Round to the nearest whole step."]), "How a part of a step is rounded."),
      ]),
      "Moves every tone up or down the scale by a value the board passes, as a cascade climbs. The steps are `per` times the value and `offset`, held between `min` and `max`.",
      { absent: "It always sounds at the same pitch." },
    ),
    opt(
      "swell",
      obj([req("param", param, "The value the board passes."), req("from", num(0, 2), "The level's scale when the value is 0."), req("to", num(0, 2), "The level's scale when the value is 1.")]),
      "Scales the level as a value the board passes goes from 0 to 1.",
      { absent: "It always sounds at the same level." },
    ),
    opt("alt", obj([req("when", whenRange, "When the other level and cutoff are used."), req("level", num(0.01, 4), "The level then."), req("cutoff", num(20, 20000, "hertz"), "The cutoff then.")]), "Another level and cutoff while a value the board passes is in a range.", {
      absent: "It has one level and one cutoff.",
    }),
  ],
  "cue",
);

const CUES_MAP = (keyNote: string): Type => map("<cue>", keyNote, CUE);

const cues = page({
  key: "cues",
  title: "cues",
  lede: "The skin's own copy of every sound it plays, each a few synthesized voices.",
  about: [
    "A cue is a short synthesized sound. There are no samples: a cue is its voices, each a note of the theme's scale or a breath of soft noise.",
    "A new skin starts from a copy of its theme's cues. Because each skin holds its own copy, a puzzle can revoice a cue without a change being heard on any other board.",
  ],
  ideas: { title: "The skin", path: "/domain/skins-and-themes#the-skin" },
  need: "required",
  type: CUES_MAP("A name for the cue: a lower-case letter, then letters and digits. Events play a cue by this name."),
  rules: [
    "There is a cue for every name an entry of [`events`](/api/skin#events) lists.",
    "There is a cue named `beat`. It is played on the puzzle's moment, alone, with no other cue over it.",
    "Every cue stays inside its theme's [sound frame](/api/theme#sound): each tone is a step of the scale, no voice ends later than the frame's longest, and no cutoff is higher than the frame's.",
    "A cue has 1 to 16 voices.",
  ],
  examples: [cut("cues", ["pop", "good"]), { title: "A whoosh: one voice of air", value: { cues: { whoosh: { level: 0.9, cutoff: 2000, voices: [{ kind: "air", at: 0, attack: 0.05, release: 0.25, level: 0.6, from: 400, to: 1800, band: true }] } } } }],
});

// ---------------------------------------------------------------- motion

const EASE = en(["linear", "At one speed throughout."], ["in", "Starts slow and gathers speed."], ["out", "Starts fast and settles."], ["in-out", "Starts slow, gathers speed, then settles."]);
const ms = (max?: number): Type => int(0, max, "milliseconds");

const changeMotion = (leave: boolean): Type =>
  obj([
    req("ms", ms(), "How long it takes. 0 to make it at once."),
    when("`ms` is above 0", "ease", EASE, "How it eases.", { never: "A change whose `ms` is 0. There is nothing to ease." }),
    ...(leave ? [req("as", en(["shrink", "The piece shrinks to nothing where it stands."], ["fade", "The piece fades where it stands."]), "How a piece leaves.")] : []),
  ]);

export const MOTION: Type = obj(
  [
    req(
      "changes",
      obj([
        req("arrive", changeMotion(false), "How a piece comes onto the board."),
        req("leave", changeMotion(true), "How a piece goes from the board."),
        req("travel", changeMotion(false), "How a piece goes from one cell to another."),
        req("change", changeMotion(false), "How a piece or a cell becomes another where it stands."),
      ]),
      "How each of the four board changes plays.",
    ),
    req("stagger", ms(), "The gap between the places of one event, so a path plays in the order it was drawn. 0 to play them together."),
    req(
      "beat",
      obj([
        req("ms", ms(), "How long the pulse lasts."),
        req("color", colourName, "The colour it pulses in."),
        req("strength", obj([req("from", num(0, 1), "The pulse's strength for the smallest moment."), req("to", num(0, 1), "Its strength for the biggest. No less than `from`.")]), "How strong the pulse is. A bigger moment is a stronger pulse, never a second effect."),
      ]),
      "The beat: one pulse over the whole board, played on the puzzle's moment, on top of every other motion.",
    ),
    req(
      "reduced",
      obj([
        req("changes", en(["cut", "Every board change is made at once, with no motion."], ["as-is", "Board changes play as they always do."]), "What board changes do."),
        req("beat", en(["still", "The beat does not pulse. Its cue is still heard."], ["as-is", "The beat pulses as it always does."]), "What the beat does."),
      ]),
      "What it does when the player asks for reduced motion. The host passes that on from the player.",
    ),
  ],
  "motion",
);

const MOTION_RULES = [
  "There is a motion for each of the four board changes: `arrive`, `leave`, `travel` and `change`.",
  "Only `leave` takes `as`.",
  "No length of motion is ever a setting, or written in the puzzle. Motion never reaches the rules, so no skin can change a round.",
  "The host caps what one entry's motion can cost. Whatever a move sets off plays for at most about a second, and past that the host snaps it to its end.",
];

const motion = page({
  key: "motion",
  title: "motion",
  lede: "How everything that happens on the board plays out on a screen.",
  about: ["The puzzle says what changes, on its events. The skin says how each change plays: how long, how it eases, and how the board pulses on the puzzle's moment.", "A new skin's motion starts as a copy of its theme's."],
  ideas: { title: "Motion", path: "/domain/motion" },
  need: "required",
  type: MOTION,
  rules: MOTION_RULES,
  examples: [{ title: "Paths in the space theme", value: { motion: PATHS_SKIN.motion } }],
});

// ---------------------------------------------------------------- events and texts

const events = page({
  key: "events",
  title: "events",
  lede: "What the skin does for each event: the cues it plays, the marks it draws, where points rise, and its callout's rank.",
  about: ["The puzzle's events say what happened. This says how each is heard and shown. It also voices the three moments every host plays: a round's start, its countdown and its end."],
  ideas: { title: "The skin's motion", path: "/domain/motion#the-skins-motion" },
  need: "required",
  type: map(
    "<event>",
    "The id of one of the puzzle's events, or one of the host's three.",
    obj(
      [
        req("cues", arr(ref("cue"), { noun: "cue names" }), "The cues it plays, together. The list may be empty for an event that is silent."),
        opt(
          "marks",
          arr(
            or(
              { label: "a ring", description: "A ring drawn at a place, or at each of several.", type: obj([req("ring", ref("event field"), "A `place` or `places` field of the event.")]) },
              { label: "a line", description: "A line drawn through places, in order.", type: obj([req("line", ref("event field"), "A `places` field of the event.")]) },
            ),
            { min: 1, noun: "marks" },
          ),
          "Marks drawn from the event's own places, to show a rule at work rather than a piece: the loop a path closed, the cell a fuse ran out on.",
          { absent: "It draws no marks.", never: "The host's `start`, `countdown` and `end`. They carry no places." },
        ),
        opt("points", ref("event field"), "The field its points rise from on the board.", { absent: "Its points are added without rising from anywhere.", must: "Name a `place` or `places` field of an event that carries `points`." }),
        opt("callout", int(1), "Its callout's rank, 1 the highest. One entry of the log shows at most one callout: the highest any of its events earned.", {
          absent: "It has no callout.",
          must: "Have a text `event.<id>` in [`texts`](/api/skin#texts), and a rank no other event shares.",
        }),
      ],
      "event's dress",
    ),
    [
      ["start", "The round starts. The host's, the same for every puzzle."],
      ["countdown", "The round runs down. The host's."],
      ["end", "The round ends. The host's."],
    ],
  ),
  rules: [
    "There is an entry for every event the puzzle declares, and for `start`, `countdown` and `end`.",
    "Every cue an entry names is in [`cues`](/api/skin#cues).",
    "Every field an entry names is a field of that event, of the type the key needs.",
    "The beat is not an entry here. It plays on the puzzle's [moment](/api/puzzle#moment), with the cue named `beat`.",
  ],
  examples: [cut("events", ["clear", "loop", "blowup", "refill", "start"])],
});

const texts = page({
  key: "texts",
  title: "texts",
  lede: "The words: a text for every key the puzzle declares.",
  about: ["Everything a player reads about a puzzle is here: its name, how to play it, what each piece is called, each callout and each label."],
  ideas: { title: "The skin", path: "/domain/skins-and-themes#the-skin" },
  need: "required",
  type: map("<key>", "One of the keys the puzzle's [`texts`](/api/puzzle#texts) declares.", str("the text")),
  rules: ["There is a text for every key the puzzle declares, and for no other.", "A text keeps its key's placeholders, each written in braces: `{count}`. It may leave one out, and may not use one the key does not declare.", "A text names nothing from another theme."],
  examples: [cut("texts", ["name", "how_to", "stage.full", "piece.prize", "event.loop", "gauge.prizes", "stat.longest"])],
});

export const SKIN: RootObject = {
  root: "skin",
  file: "<id>.skin.json",
  title: "Skin",
  lede: "Everything that dresses one puzzle in one theme: a drawing for every piece, the sounds, the motion and the words.",
  about: [
    "The skin object is one JSON file, `<id>.skin.json`. A puzzle has one skin for each theme it is dressed in, and its default skin is its skin in the default theme.",
    "A skin never sets a number and never changes a round: not even how many kinds a board deals. It has no version of its own. It must be ready against its puzzle's current version.",
  ],
  groups: [
    {
      title: "Identity",
      fields: [
        req("puzzle", ref("puzzle"), "The id of the puzzle it dresses."),
        req("theme", ref("theme"), "The id of its one theme. Every colour the skin names is one of that theme's, and every cue stays inside that theme's sound frame."),
      ],
    },
    { title: "Looks", fields: [pieces] },
    { title: "Sound", fields: [cues] },
    { title: "Motion", fields: [motion, events] },
    { title: "Words", fields: [texts] },
  ],
  ready: {
    intro: "A host checks this whenever the puzzle's version rises.",
    items: [
      "A drawing for every piece, every named state and every kind a family's setting allows.",
      "A cue for every cue an event names, and a `beat` cue.",
      "A motion for every board change.",
      "An entry in `events` for every event, and for the host's three.",
      "A text for every key, with its placeholders kept.",
      "Every colour it names is in its theme's palette, and every cue is inside its theme's sound frame.",
    ],
  },
  example: {
    title: "Paths in the space theme, in outline",
    note: "The whole file is on [Paths, in full](/api/paths).",
    value: {
      puzzle: PATHS_SKIN.puzzle,
      theme: PATHS_SKIN.theme,
      pieces: { prize: PATHS_SKIN.pieces!.prize },
      cues: { good: PATHS_SKIN.cues!.good },
      motion: PATHS_SKIN.motion,
      events: { loop: PATHS_SKIN.events!.loop, start: PATHS_SKIN.events!.start },
      texts: { name: PATHS_SKIN.texts!.name, "event.loop": PATHS_SKIN.texts!["event.loop"] },
    },
  },
};

export { CUES_MAP, MOTION_RULES };
