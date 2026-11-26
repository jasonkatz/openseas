import paletteRaw from "../../../content/api/space.palette.json?raw";
import { CUES_MAP, MOTION, MOTION_RULES } from "./skin.js";
import { alias, arr, en, int, map, name, num, obj, req, str, type ObjectPage, type RootObject } from "./types.js";

const page = (p: Omit<ObjectPage, "root">): ObjectPage => ({ root: "theme", ...p });
const colour = alias("colour");

const FIXED: readonly (readonly [string, string])[] = [
  ["ground", "The page, and a board's playfield."],
  ["raised", "A panel, a button, a field: anything that sits on the ground."],
  ["line", "A hairline or a border."],
  ["text", "Text, and anything that carries meaning."],
  ["dim", "Secondary text and labels."],
  ["yours", "What is the player's, or active. Used for nothing else."],
  ["danger", "What is bad: a mistake, a gauge past its danger line."],
];

/** The space theme's palette. It is a file, so that no colour is typed in the site's code. */
const SPACE_PALETTE = JSON.parse(paletteRaw) as { fixed: Record<string, string>; pieces: Record<string, string>; names: Record<string, string> };
const SPACE_TYPE = {
  faces: { text: "Atkinson Hyperlegible", numbers: "Atkinson Hyperlegible Mono" },
  sizes: { title: { px: 28, weight: "bold" }, heading: { px: 20, weight: "bold" }, body: { px: 16, weight: "regular" }, small: { px: 13, weight: "regular" } },
};
const SPACE_SOUND = { scale: ["G2", "A2", "B2", "D3", "E3", "G3", "A3", "B3", "D4", "E4", "G4", "A4", "B4", "D5", "E5", "G5"], longestMs: 400, cutoff: 2400 };
const SPACE_CUE = { level: 1, cutoff: 2200, voices: [{ kind: "tone", note: 10, wave: "triangle", at: 0, attack: 0.012, release: 0.088, level: 0.8 }, { kind: "tone", note: 13, wave: "triangle", at: 0.08, attack: 0.012, release: 0.168, level: 1 }] };
const SPACE_MOTION = {
  changes: { arrive: { ms: 120, ease: "out" }, leave: { ms: 160, ease: "out", as: "shrink" }, travel: { ms: 120, ease: "out" }, change: { ms: 0 } },
  stagger: 46,
  beat: { ms: 420, color: "amber", strength: { from: 0.14, to: 0.3 } },
  reduced: { changes: "cut", beat: "still" },
};
const SPACE_TEXTS = { "tier.green": "Green", "tier.steady": "Steady", "tier.sharp": "Sharp", "tier.masterful": "Masterful", "tier.legendary": "Legendary", start: "Go", countdown: "Ten seconds", end: "Time" };

const palette = page({
  key: "palette",
  title: "palette",
  lede: "Every colour in the theme: the seven every theme fills, and the colours it gives its pieces.",
  about: [
    "A skin names a colour and the theme says what it is, so recolouring a theme recolours every board in it.",
    "The seven fixed colours mean the same thing in every theme. That is what lets a host and any skin work under any theme. A theme has one palette: a light look is a theme of its own.",
  ],
  ideas: { title: "Themes", path: "/domain/skins-and-themes#themes" },
  need: "required",
  type: obj([
    req("fixed", obj(FIXED.map(([key, what]) => req(key, colour, what))), "The seven fixed colours. Every theme fills all seven."),
    req("pieces", map("<colour>", "A name the theme chooses freely, such as `sand` or `sky`.", colour), "The piece colours: what pieces are painted in.", { must: "Hold at least eight, because a family can deal eight kinds." }),
    req(
      "names",
      map("<fixed colour>", "One of the seven fixed colours.", name, FIXED.map(([key]) => [key, `The theme's own name for \`${key}\`.`] as const)),
      "The theme's own name for a fixed colour, where it has one. A skin may then name the colour either way. The object may be empty.",
      { must: "Give names that no piece colour and no fixed colour already has." },
    ),
  ]),
  rules: ["All seven fixed colours are filled.", "There are at least eight piece colours.", "Every colour name is unique across the fixed colours, their own names and the piece colours.", "Every colour any skin of the theme names is in this palette."],
  examples: [{ title: "Space", value: { palette: SPACE_PALETTE } }],
});

const type = page({
  key: "type",
  title: "type",
  lede: "The theme's typefaces, and the steps of its type scale.",
  about: ["A theme has two faces: one for everything read, and one for anything counted, so a score does not shift as its digits change."],
  ideas: { title: "Themes", path: "/domain/skins-and-themes#themes" },
  need: "required",
  type: obj([
    req("faces", obj([req("text", str("a typeface's name"), "The face for everything read."), req("numbers", str("a typeface's name"), "The face for anything counted: a score, a clock. Its digits are all one width.")]), "The two faces."),
    req(
      "sizes",
      map("<step>", "A name for the step, such as `title` or `body`.", obj([req("px", int(1, undefined, "pixels"), "The size."), req("weight", en(["regular", "The face's regular weight."], ["bold", "The face's bold weight."]), "The weight.")], "size")),
      "The steps of its type scale, by name. Nothing in the theme is set at a size that is not one of these.",
    ),
  ]),
  rules: ["Both faces are named.", "The scale has at least one step."],
  examples: [{ title: "Space", value: { type: SPACE_TYPE } }],
});

const sound = page({
  key: "sound",
  title: "sound",
  lede: "The sound frame: the scale every cue's notes come from, and the limits every cue stays inside.",
  about: ["The sound frame is data the checks read. Every cue of every skin in the theme must stay inside it, so any two cues sound well together, whichever boards they come from."],
  ideas: { title: "Themes", path: "/domain/skins-and-themes#themes" },
  need: "required",
  type: obj([
    req("scale", arr(alias("note"), { min: 1, max: 16, noun: "notes" }), "The notes every cue's notes come from, lowest first. A voice names a note by its position in this list, counted from 0."),
    req("longestMs", int(1, undefined, "milliseconds"), "The longest a cue may last: no voice may end later than this after its cue starts."),
    req("cutoff", int(20, 20000, "hertz"), "The highest any cue's cutoff may be."),
  ]),
  rules: ["The scale runs from its lowest note to its highest.", "Every starting cue of the theme, and every cue of every skin in it, stays inside this frame."],
  examples: [{ title: "Space", note: "G major pentatonic from G2 to G5, with no cue over 400ms and no cutoff over 2.4kHz.", value: { sound: SPACE_SOUND } }],
});

const cues = page({
  key: "cues",
  title: "cues",
  lede: "The starting cues: what a new skin copies.",
  about: [
    "These are copied, not read. A skin copies them when it is made, so each puzzle can then revoice its own. Changing a starting cue changes no skin by itself.",
    "Whoever changes one can carry the change to every skin of the theme in one step, or to one skin at a time, and is shown which skins had changed their own copy before those are overwritten.",
  ],
  ideas: { title: "Read, and copied", path: "/domain/skins-and-themes#read-and-copied" },
  need: "required",
  type: CUES_MAP("A name for the cue. The theme brings one for each moment a host plays: `start`, `countdown`, `end` and `beat`."),
  rules: ["There is a cue for each moment a host plays: `start`, `countdown`, `end` and `beat`.", "Every starting cue stays inside the theme's own [sound frame](/api/theme/sound).", "A cue here is written exactly as a skin's [cue](/api/skin/cues) is."],
  examples: [{ title: "One starting cue", value: { cues: { good: SPACE_CUE } } }],
});

const motion = page({
  key: "motion",
  title: "motion",
  lede: "The starting motion: what a new skin copies.",
  about: ["Like the starting cues, this is copied when a skin is made and never read afterwards. It is written exactly as a skin's [motion](/api/skin/motion) is."],
  ideas: { title: "Read, and copied", path: "/domain/skins-and-themes#read-and-copied" },
  need: "required",
  type: MOTION,
  rules: MOTION_RULES,
  examples: [{ title: "Space", note: "A travel of 120ms, a clear of 160ms, ease-out, and a pulse of 420ms in amber.", value: { motion: SPACE_MOTION } }],
});

const TIERS: readonly (readonly [string, string])[] = [
  ["tier.green", "The name of the first tier."],
  ["tier.steady", "The name of the second tier."],
  ["tier.sharp", "The name of the third tier."],
  ["tier.masterful", "The name of the fourth tier."],
  ["tier.legendary", "The name of the fifth tier."],
  ["start", "What the host says as a round starts."],
  ["countdown", "What it says as a round runs down."],
  ["end", "What it says when a round ends."],
];

const texts = page({
  key: "texts",
  title: "texts",
  lede: "The words the host says in this theme: a name for each tier, and its start, countdown and end.",
  about: ["A puzzle's own words are its skin's. These eight belong to no puzzle: every round of every puzzle uses them."],
  ideas: { title: "Themes", path: "/domain/skins-and-themes#themes" },
  need: "required",
  type: obj(TIERS.map(([key, what]) => req(key, str("the text"), what))),
  rules: ["All eight are filled."],
  examples: [{ title: "Space", value: { texts: SPACE_TEXTS } }],
});

export const THEME: RootObject = {
  root: "theme",
  file: "<theme>.theme.json",
  title: "Theme",
  lede: "One look for every puzzle: the palette and type its skins name, the sound frame they stay inside, and what a new skin starts from.",
  about: [
    "The theme object is one JSON file, `<theme>.theme.json`. A theme dresses every puzzle in one look, such as space. It holds what its skins share, and it has a skin for each puzzle.",
    "A theme says nothing about where anything sits on a screen, what shape a host's own controls have, or a host's world. Those stay the host's.",
  ],
  groups: [
    { title: "Identity", fields: [req("id", alias("id"), "The theme's id, such as `space`. A skin names its theme by it.")] },
    { title: "Read by every skin", note: "A skin names a colour or a size, and the theme says what it is.", fields: [palette, type, sound] },
    { title: "Copied by a new skin", note: "A skin copies these when it is made. Changing them changes no skin by itself.", fields: [cues, motion] },
    { title: "Words", fields: [texts] },
  ],
  ready: {
    intro: "A host checks this before it uses a theme.",
    items: [
      "Every fixed colour is filled, and it has at least eight piece colours.",
      "Every colour its skins name is in its palette.",
      "Every starting cue's notes are in its scale and within its limits.",
      "Its type names its faces and sizes.",
      "It has a text for every host key.",
      "It has a skin for every puzzle the host deals.",
    ],
    outro: "A new theme starts as a copy of another, skins and all, so every board plays from the first minute.",
  },
  example: {
    title: "Space, in outline",
    value: { id: "space", palette: SPACE_PALETTE, type: SPACE_TYPE, sound: SPACE_SOUND, cues: { good: SPACE_CUE }, motion: SPACE_MOTION, texts: SPACE_TEXTS },
  },
};
