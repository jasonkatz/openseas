import { css, type Token } from "../look/tokens.js";
import { drawingOf } from "../look/pieces.js";
import { paintDrawing } from "../kit/drawing.js";

/**
 * Space Battle's things, as pictograms (docs/BRAND.md section 3, ADR 0062): each kind
 * is one solid silhouette in one palette colour, on a 24 unit square, with at most one detail cut
 * out so the ground shows through. Everything that has a facing is drawn pointing up and turned by
 * the board.
 *
 * No two outlines are alike, so every kind reads with the colour taken away: the captain's ship is
 * a dart with one point forward, the raider a broad hull with two prongs forward and a square
 * stern, an asteroid a lump, a gravity well a ring broken by an arrowhead, a current a chevron, a
 * slug a small capsule, a plotted position the dart hollow, and a turret a barrel on a mount.
 * Each is drawn from its layers in `data/pieces/battle.json` (ADR 0065), by the kind's name.
 */
export type BattleKind = "ship" | "raider" | "asteroid" | "well" | "current" | "slug" | "ghost" | "turret" | "turretArmed";

type Ctx = CanvasRenderingContext2D;

/** A palette colour, or a flat blend of two (`blend` in the token module), as Canvas 2D takes it. */
export type Paint = Token | number;
const paintOf = (color: Paint): string => (typeof color === "number" ? `#${color.toString(16).padStart(6, "0")}` : css(color));

/** Paints one pictogram, pointing up, on a square of `s` whose top-left corner is the context origin. */
export function paintKind(ctx: Ctx, s: number, kind: BattleKind, color: Paint): void {
  ctx.save();
  ctx.scale(s / 24, s / 24);
  ctx.fillStyle = paintOf(color);
  ctx.strokeStyle = paintOf(color);
  paintDrawing(ctx, drawingOf("battle", kind));
  ctx.restore();
}

/** A pictogram as its own canvas, `s` CSS pixels square at `resolution` device pixels a pixel. */
export function kindCanvas(s: number, kind: BattleKind, color: Paint, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(s * resolution));
  canvas.height = Math.max(1, Math.ceil(s * resolution));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintKind(ctx, s, kind, color);
  }
  return canvas;
}
