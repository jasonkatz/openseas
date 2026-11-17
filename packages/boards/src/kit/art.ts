/**
 * What every prototype board draws with besides its own pieces (ADR 0036), on the game's one
 * palette (docs/BRAND.md, ADR 0061): the kit's inks and faces, the ground a playfield sits on, its
 * one hairline and the dot of an empty position. Everything is flat. A board's pieces are
 * pictograms of its own subject, in its `pieces.ts` (`pictogram.ts`, ADR 0062).
 */
import type { Graphics } from "pixi.js";
import { FONT as TYPE, ink } from "../look/tokens.js";

/**
 * The inks a kit board draws in, by token name. Amber is only the player's own, the active thing
 * and the beat; danger is only what is bad; good news is cream.
 */
export const INK = {
  ground: ink("ground"),
  raised: ink("raised"),
  line: ink("line"),
  cream: ink("cream"),
  dim: ink("dim"),
  amber: ink("amber"),
  danger: ink("danger"),
} as const;

/** Text is the body face; anything counted is the mono face, bold (docs/BRAND.md section 4). */
export const FONT = TYPE.body;
export const FONT_MONO = TYPE.mono;

/** Blend two 0xRRGGBB colors: t = 0 is `a`, t = 1 is `b`. For a flat tint, never for a gradient. */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * A playfield: bare ground with one hairline round it, painted so the board is whole wherever it
 * is shown (docs/BRAND.md section 3). No frame, no bevel, no grid. A renderer asks its board for
 * this (`KitBoard.paintGround`), which also tells the beat where the board is.
 */
export function drawGround(g: Graphics, x: number, y: number, w: number, h: number, hairline = true): void {
  g.rect(x, y, w, h).fill({ color: INK.ground });
  if (hairline) drawHairline(g, x, y, w, h);
}

/** The one hairline a playfield may have, where its edge matters: round the ground, or round the grid inside it. */
export function drawHairline(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x - 0.5, y - 0.5, w + 1, h + 1).stroke({ width: 1, color: INK.line });
}

/** The small dot of an empty position that matters, at the centre of a cell of `size`. */
export function drawDot(g: Graphics, cx: number, cy: number, size: number, color: number = INK.line): void {
  g.circle(cx, cy, Math.max(1.5, size * 0.045)).fill({ color });
}
