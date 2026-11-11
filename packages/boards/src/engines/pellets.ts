import type { MarkName } from "@openseas/content";
import { drawSprite, spriteRevision } from "../sprites/atlas.js";
import { paintMark } from "../marks/canvas.js";
import { paintPart } from "../parts.js";

/**
 * Engines pieces are discs, not tiles: a riveted cream rim round a colored face, each kind with
 * its own emblem (trefoil, rings, three spokes, and a hexagon for the lab's extra kind) so kinds
 * read apart by shape as well as color, and a mark badge when the player turns marks on
 * (CLAUDE.md rule 6). `texture` is the content key that picks the emblem.
 */
export type EnginesTexture = "weave" | "coil" | "ripple" | "speckle";

export interface PelletStyle {
  color: number;
  texture: EnginesTexture;
  mark: MarkName | null;
  showMarks: boolean;
}

const EMBLEM: Record<EnginesTexture, "disc-trefoil" | "disc-rings" | "disc-spokes" | "disc-hex"> = {
  weave: "disc-trefoil",
  coil: "disc-rings",
  ripple: "disc-spokes",
  speckle: "disc-hex",
};

/** Paints one disc into a cell of size `s` whose top-left corner is the context origin. */
export function paintPellet(ctx: CanvasRenderingContext2D, s: number, style: PelletStyle): void {
  // The lab's extra kind has no atlas frame, so it always takes the vector disc, as every kind does without the atlas.
  if (!drawSprite(ctx, "engines", style.texture, 0, 0, s, s)) paintPart(ctx, EMBLEM[style.texture], s / 2, s / 2, s, style.color);
  if (style.showMarks && style.mark) paintMark(ctx, s, style.mark);
}

export function pelletCanvas(s: number, style: PelletStyle, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintPellet(ctx, s, style);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a disc for the page legend; cached because legends re-render often. */
export function pelletDataUrl(style: PelletStyle, px: number): string {
  const key = JSON.stringify([style, px, spriteRevision()]);
  let url = urlCache.get(key);
  if (!url) {
    url = pelletCanvas(px, style, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
