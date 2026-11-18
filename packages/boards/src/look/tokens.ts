/**
 * The game's one palette (docs/BRAND.md section 2, ADR 0061). Every colour a board, the chrome,
 * the world or a guide draws comes from here: this is the only file in the game that types a hex
 * value, and `studio/test/look.test.ts` fails on a literal anywhere else.
 */
import { PIECE_COLORS, PLAYER_COLORS } from "@openseas/content";

export const PALETTE = {
  ground: "#0b1220",
  raised: "#141d30",
  line: "#27344f",
  cream: "#ece3cf",
  dim: "#8f99ad",
  amber: "#e2a94b",
  danger: "#e5604e",
  sand: "#d8c690",
  sky: "#7fb0d8",
  moss: "#8ebd88",
  lilac: "#a99ad4",
  rose: "#d897b2",
  teal: "#6dbcb1",
  rust: "#c27f66",
  slate: "#7f8ba3",
  plum: "#8e6fa8",
  olive: "#a3a86a",
  ice: "#a9d3de",
  brick: "#a85f5a",
} as const;

export type Token = keyof typeof PALETTE;

/** The names a piece and a player may wear are content's vocabulary; their values are here. */
export { PIECE_COLORS, PLAYER_COLORS };
export type PieceColor = (typeof PIECE_COLORS)[number];
export type PlayerColor = (typeof PLAYER_COLORS)[number];

/** A token as the number PixiJS and three.js take. */
export const ink = (token: Token): number => parseInt(PALETTE[token].slice(1), 16);

/** A token as a CSS colour, for a Canvas 2D context. */
export const css = (token: Token): string => PALETTE[token];

/** The type every board and the chrome is set in (docs/BRAND.md section 4). */
export const FONT = {
  body: '"Atkinson Hyperlegible", "Avenir Next", "Segoe UI", sans-serif',
  mono: '"Atkinson Hyperlegible Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

/** One corner for every panel and button, in CSS pixels. */
export const RADIUS = 10;

/** How long things take, in milliseconds (docs/BRAND.md section 6). */
export const MOTION = { move: 120, clear: 160, panel: 180, beat: 420 } as const;

/**
 * The block of custom properties `styles.css` carries between its token markers. The stylesheet is
 * static so a page is the right colour before any script runs; the look test holds the two equal.
 */
export function cssVariables(): string {
  const lines = (Object.keys(PALETTE) as Token[]).map((t) => `  --${t}: ${PALETTE[t]};`);
  lines.push(`  --font-body: ${FONT.body};`, `  --font-mono: ${FONT.mono};`, `  --radius: ${RADIUS}px;`);
  return lines.join("\n");
}

/** Two tokens mixed, as a number: `t` = 0 is `a`, 1 is `b`. For a flat tint, never for a gradient. */
export function blend(a: Token, b: Token, t: number): number {
  const x = ink(a);
  const y = ink(b);
  const ch = (shift: number): number => Math.round(((x >> shift) & 0xff) * (1 - t) + ((y >> shift) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
