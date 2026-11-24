/**
 * The game's theme, as the document the puzzle domain asks for (docs/puzzles/DOMAIN.md, "Themes",
 * ADR 0083): the palette, the type, the sound frame, the motion and the host's words, each read
 * from where the game already keeps it (the tokens, the cue limits, the message table). A skin is
 * held to this by `checkSkin`, and the domain board draws from the two together.
 */
import { TIERS, type Skin, type Theme, type PuzzleDoc } from "@openseas/puzzle";
import { content, t } from "../content.js";
import { LIMITS, SCALE } from "../cues.js";
import { FONT, MOTION, PALETTE, ink, type Token } from "../look/tokens.js";
import swapSkin from "../../data/skins/space/swap.json" with { type: "json" };

/** The fixed colours, by the token each is in this theme. */
const FIXED = { ground: "ground", raised: "raised", line: "line", text: "cream", dim: "dim", yours: "amber", danger: "danger" } as const satisfies Record<string, Token>;
const PIECES = ["sand", "sky", "moss", "lilac", "rose", "teal", "rust", "slate", "plum", "olive", "ice", "brick"] as const satisfies readonly Token[];

/** The scale's notes by name, low to high, as `NOTES` holds them in hertz. */
const NOTE_NAMES: readonly string[] = (() => {
  const letters = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  // The root is G2: seven semitones above C2.
  const name = (semis: number): string => `${letters[(7 + semis) % 12]}${2 + Math.floor((7 + semis) / 12)}`;
  const out: string[] = [];
  for (let o = 0; o < SCALE.octaves; o++) for (const s of SCALE.semitones) out.push(name(o * 12 + s));
  out.push(name(SCALE.octaves * 12));
  return out;
})();

const MOTION_DOC: Theme["motion"] = {
  changes: {
    arrive: { ms: MOTION.move, ease: "out" },
    leave: { ms: MOTION.clear, ease: "out", as: "shrink" },
    travel: { ms: MOTION.move, ease: "out" },
    change: { ms: MOTION.move, ease: "out" },
  },
  stagger: 18,
  beat: { ms: MOTION.beat, color: "amber", strength: { from: 0.14, to: 0.3 } },
  reduced: { changes: "cut", beat: "still" },
};

/** The game's one theme. Its words are read when it is asked for, so a string rewritten in the studio is the one said. */
export function spaceTheme(): Theme {
  return {
    id: "space",
    palette: {
      fixed: Object.fromEntries(Object.entries(FIXED).map(([name, token]) => [name, PALETTE[token]])) as Theme["palette"]["fixed"],
      pieces: Object.fromEntries(PIECES.map((token) => [token, PALETTE[token]])),
      names: { text: "cream", yours: "amber" },
    },
    type: { faces: { text: FONT.body, numbers: FONT.mono }, sizes: { text: { px: 16, weight: "regular" }, count: { px: 18, weight: "bold" }, callout: { px: 32, weight: "bold" } } },
    sound: { scale: NOTE_NAMES, longestMs: LIMITS.cue * 1000, cutoff: LIMITS.cutoff },
    cues: {},
    motion: MOTION_DOC,
    texts: {
      ...Object.fromEntries(TIERS.map((tier) => [`tier.${tier}`, t(`tier.${tier}`)])),
      start: t("domain.start"),
      countdown: t("domain.countdown"),
      end: t("domain.end"),
    },
  };
}

/** One of the theme's colours as the token it is. A name the theme does not have is the text colour. */
export function tokenOf(name: string | undefined): Token {
  if (name !== undefined && name in FIXED) return FIXED[name as keyof typeof FIXED];
  return name !== undefined && name in PALETTE ? (name as Token) : "cream";
}
export const inkOf = (name: string | undefined): number => ink(tokenOf(name));

const SKINS: Readonly<Record<string, unknown>> = { swap: swapSkin };

/**
 * A puzzle's skin in the game's theme: its drawings, cues, motion and events from
 * `data/skins/space/<puzzle>.json`, and its texts from the message table, where every string a
 * player reads lives (CLAUDE.md rule 5), keyed `<puzzle>.<text key>`. Null for a puzzle with none.
 */
export function skinOf(doc: PuzzleDoc): Skin | null {
  const file = SKINS[doc.id];
  if (!file) return null;
  const prefix = `${doc.id}.`;
  const texts: Record<string, string> = {};
  for (const key of Object.keys(content.messages)) if (key.startsWith(prefix)) texts[key.slice(prefix.length)] = t(key);
  return { ...(file as Omit<Skin, "texts">), texts };
}

/** A text with its places filled from an event's fields. */
export function fill(text: string, fields: Readonly<Record<string, unknown>>): string {
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (typeof fields[k] === "number" || typeof fields[k] === "string" ? String(fields[k]) : all));
}
