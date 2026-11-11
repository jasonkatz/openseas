import { GunneryKind } from "@openseas/engine";
import type { MarkName } from "@openseas/content";
import { drawSprite, spriteRevision } from "../sprites/atlas.js";
import { paintMark } from "../marks/canvas.js";
import { paintPart, type PartName } from "../parts.js";

/**
 * Gunnery's own pieces: an energy cell, a split sabot, a pointed slug and a jug of coolant. Each
 * has its own silhouette (an upright canister, an open C-shaped shell, a pointed round, a square
 * jug with a handle and hose), so they read apart without color (CLAUDE.md rule 6); with marks on,
 * each also carries its symbol on a small badge in the corner. The atlas draws them; the vector
 * parts stand in when it cannot load.
 */

const PARTS: Record<number, { part: PartName; color: number }> = {
  [GunneryKind.Cell]: { part: "cell", color: 0xe8892c },
  [GunneryKind.Sabot]: { part: "sabot", color: 0xd8ccae },
  [GunneryKind.Slug]: { part: "slug", color: 0x5b6068 },
  [GunneryKind.Coolant]: { part: "coolant", color: 0x3fa7f5 },
};

/** Paints one piece into an `s`-pixel square whose top-left corner is the context origin. */
export function paintGunneryPiece(ctx: CanvasRenderingContext2D, s: number, kind: number, mark: MarkName | null): void {
  // Drawn a little larger than the painters' own proportions, so a piece fills most of its deck plate.
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.scale(PIECE_ZOOM, PIECE_ZOOM);
  ctx.translate(-s / 2, -s / 2);
  const name = ["cell", "sabot", "slug", "coolant"][kind];
  const part = PARTS[kind];
  if (!name || !drawSprite(ctx, "gunnery", name, s * 0.06, s * 0.06, s * 0.88, s * 0.88)) if (part) paintPart(ctx, part.part, s / 2, s / 2, s * 0.88, part.color);
  ctx.restore();
  if (mark) {
    // The shared mark on a badge in the lower right, so the piece itself stays recognisable.
    ctx.save();
    ctx.translate(s * 0.42, s * 0.42);
    paintMark(ctx, s * 0.6, mark);
    ctx.restore();
  }
}

const PIECE_ZOOM = 1.14;

/** A piece as its own canvas, `s` CSS pixels square at `resolution` device pixels per pixel. */
export function gunneryPieceCanvas(s: number, kind: number, mark: MarkName | null, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintGunneryPiece(ctx, s, kind, mark);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a piece for the page legend; cached because legends re-render often. */
export function gunneryPieceUrl(kind: number, mark: MarkName | null, px: number): string {
  const key = `${kind}|${mark ?? ""}|${px}|${spriteRevision()}`;
  let url = urlCache.get(key);
  if (!url) {
    url = gunneryPieceCanvas(px, kind, mark, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
