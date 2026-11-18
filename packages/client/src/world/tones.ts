/**
 * The world's colours, every one a token or a flat tint between tokens (docs/BRAND.md sections 2
 * and 7, ADR 0061). Rock, hull and plate are `raised`, `line` and `slate` and the steps between
 * them. What is lit, and what is the player's own, is `amber`. The muted player colours mark a
 * few props and other people's things, mixed down toward `line` so they stay quiet. Nothing in
 * the world types a colour of its own.
 */
import { PLAYER_COLORS, blend, ink, type Token } from "@openseas/boards/look";

/** Two colours mixed, channel by channel as `blend` mixes two tokens: `t` = 0 is `a`, 1 is `b`. */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A colour as Canvas 2D takes it. */
export const cssOf = (color: number): string => `#${color.toString(16).padStart(6, "0")}`;

/** Plate and rock: a step from `line` (0) up to `slate` (1). */
export const plate = (t: number): number => blend("line", "slate", t);

/** A muted colour, quietened: mixed down toward `line`. `t` = 1 is the colour itself. */
export const muted = (token: Token, t: number): number => blend("line", token, t);

export const GROUND = ink("ground");
export const RAISED = ink("raised");
export const LINE = ink("line");
export const SLATE = ink("slate");
export const CREAM = ink("cream");
/** Lit, or the player's own. Nothing else is this colour. */
export const AMBER = ink("amber");

/** The twelve colours a jacket or a flag may be, for a figure that was given no look. */
export const PLAYER_INKS: readonly number[] = PLAYER_COLORS.map((c) => ink(c));

/**
 * What the things of the world are painted. The names are the things, not the colours: a `tin`
 * panel is the lightest plate, `iron` the darkest, and `trim` is the band of colour a made thing
 * carries so it reads apart from the rock.
 */
export const TONES = {
  // Plate, lightest to darkest.
  tin: SLATE,
  wall: plate(0.85),
  wallDark: plate(0.62),
  tinDark: plate(0.55),
  steel: plate(0.3),
  iron: LINE,
  cable: blend("raised", "line", 0.5),
  pitch: GROUND,
  // Ground underfoot.
  rock: LINE,
  rockDark: RAISED,
  paving: plate(0.3),
  pavingDark: plate(0.16),
  walk: plate(0.22),
  // The few muted colours.
  trim: muted("rust", 0.62),
  trimDark: muted("rust", 0.32),
  teal: muted("teal", 0.6),
  tealDark: muted("teal", 0.3),
  blue: muted("sky", 0.55),
  blueDark: muted("sky", 0.28),
  panel: muted("sky", 0.3),
  panelLight: muted("sky", 0.5),
  foil: muted("sand", 0.6),
  foilLight: muted("sand", 0.8),
  leaf: muted("moss", 0.75),
  leafDark: muted("moss", 0.45),
  ice: ink("ice"),
  iceBlue: muted("ice", 0.7),
  iceDeep: muted("ice", 0.4),
  crystal: muted("teal", 0.85),
  crystalViolet: muted("lilac", 0.85),
  grow: ink("lilac"),
  ember: ink("rust"),
  // Light that is not a lamp: a screen, a strip, a hologram.
  glow: muted("ice", 0.8),
  screen: muted("sky", 0.7),
  // Lamps, windows and beacons, lit and unlit.
  lamp: AMBER,
  lampLow: blend("line", "amber", 0.8),
  lampOff: plate(0.12),
  window: AMBER,
  // What carries meaning: a marker, a ring, a lane.
  mark: CREAM,
} as const;
