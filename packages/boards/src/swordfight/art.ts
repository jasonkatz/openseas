import { drawSprite, spriteRevision } from "../sprites/atlas.js";
import type { MarkName } from "@openseas/content";
import { mix } from "../cooling/tiles.js";
import { paintMark } from "../marks/canvas.js";

/**
 * Swordfight blocks are beveled squares, each color with its own surface (cut facets, riveted
 * steel, fish scale, cross-hatch, a swirl, rings), so colors read apart by pattern too, and a
 * mark badge when marks are on (CLAUDE.md rule 6). A breaker is a block of its color with a
 * blade across it. Scrap is grey stone with cracks that ripens in two drops, with no number on it:
 * it lands as solid stone, and with one drop left it shows its color coming, the stone tinted
 * toward the color it will turn with its surface showing through the cracks. The cracks stay, so
 * scrap never reads as a block, with or without color. A slab is one block the size of all its
 * cells: the same surface tiled, one bevel, one gloss, so it reads as a single heavy thing.
 */
export type SwordTexture = "facet" | "rivet" | "scale" | "hatch" | "swirl" | "rings";

export interface BlockStyle {
  /** The block's color; for scrap, the color it ripens into. */
  color: number;
  texture: SwordTexture;
  mark: MarkName | null;
  kind: "block" | "breaker" | "scrap";
  showMarks: boolean;
  /** Scrap only: the drops left before it ripens. Anything past one is fresh stone. */
  ripen?: number;
}

export const SCRAP_COLOR = 0x6c6f78;

/** How far along scrap is: stone until one drop is left, then a hint of its color. */
export type ScrapStage = "stone" | "hint";
export const scrapStage = (ripen: number): ScrapStage => (ripen <= 1 ? "hint" : "stone");

/** The body color of scrap at a stage: grey, then grey tinted well toward its color and lifted a little. */
export const scrapBody = (color: number, stage: ScrapStage): number => (stage === "stone" ? SCRAP_COLOR : mix(mix(SCRAP_COLOR, color, 0.6), 0xffffff, 0.08));
const BONE = 0xf2f0e6;
const INK = 0x0b1526;

const css = (c: number, alpha = 1): string => `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${alpha})`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paints a block `w` by `h` cells of size `s`, its top-left at the context origin. One cell is the ordinary block. */
export function paintBlock(ctx: CanvasRenderingContext2D, s: number, w: number, h: number, style: BlockStyle): void {
  // Slabs keep their single outer bevel and arbitrary dimensions. Extra lab colors retain
  // procedural skins; the live four-color set uses the atlas.
  const name = style.kind === "scrap" ? (scrapStage(style.ripen ?? Infinity) === "stone" ? "stone" : `${style.texture}-hint`) : `${style.texture}-${style.kind}`;
  if (w === 1 && h === 1 && drawSprite(ctx, "swordfight", name, 0, 0, s, s)) {
    if (style.showMarks && style.mark && (style.kind !== "scrap" || scrapStage(style.ripen ?? Infinity) === "hint")) {
      ctx.save();
      ctx.translate(s * 0.44, s * 0.44);
      paintMark(ctx, s * 0.56, style.mark);
      ctx.restore();
    }
    return;
  }
  const inset = s * 0.05;
  const x0 = inset;
  const y0 = inset;
  const W = s * w - inset * 2;
  const H = s * h - inset * 2;
  const r = s * 0.14;
  const lip = s * 0.06;
  const slab = style.kind === "block" && w * h > 1;
  const stage: ScrapStage | null = style.kind === "scrap" ? scrapStage(style.ripen ?? Infinity) : null;
  const base = stage ? scrapBody(style.color, stage) : style.kind === "breaker" ? mix(style.color, 0x000000, 0.12) : slab ? mix(style.color, 0x000000, 0.14) : style.color;

  // Contact shadow, a darker underside, then the body.
  roundRect(ctx, x0, y0 + lip * 1.5, W, H, r);
  ctx.fillStyle = css(0x000000, 0.4);
  ctx.fill();
  roundRect(ctx, x0, y0 + lip, W, H, r);
  ctx.fillStyle = css(mix(base, 0x000000, 0.4));
  ctx.fill();
  ctx.save();
  roundRect(ctx, x0, y0, W, H, r);
  ctx.clip();
  const body = ctx.createLinearGradient(0, y0, 0, y0 + H);
  body.addColorStop(0, css(mix(base, 0xffffff, 0.18)));
  body.addColorStop(0.5, css(base));
  body.addColorStop(1, css(mix(base, 0x000000, 0.16)));
  ctx.fillStyle = body;
  ctx.fillRect(x0, y0, W, H);
  if (stage) {
    // Scrap about to ripen: its coming surface shows through, under lighter cracks.
    if (stage === "hint") {
      ctx.save();
      ctx.globalAlpha = 0.55;
      for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) paintSurface(ctx, s, cx * s, cy * s, base, style.texture);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = stage === "hint" ? 0.7 : 1;
    paintCracks(ctx, s, w, h);
    ctx.restore();
  } else for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) paintSurface(ctx, s, cx * s, cy * s, base, style.texture);
  // Gloss along the top, shade along the bottom.
  const gloss = ctx.createLinearGradient(0, y0, 0, y0 + Math.min(H, s) * 0.45);
  gloss.addColorStop(0, css(0xffffff, 0.32));
  gloss.addColorStop(1, css(0xffffff, 0));
  roundRect(ctx, x0 + s * 0.06, y0 + s * 0.04, W - s * 0.12, Math.min(H, s) * 0.4, r * 0.7);
  ctx.fillStyle = gloss;
  ctx.fill();
  const shade = ctx.createLinearGradient(0, y0 + H - s * 0.3, 0, y0 + H);
  shade.addColorStop(0, css(0x000000, 0));
  shade.addColorStop(1, css(0x000000, 0.24));
  ctx.fillStyle = shade;
  ctx.fillRect(x0, y0 + H - s * 0.3, W, s * 0.3);
  ctx.restore();
  // Rim. A slab wears a heavier, lighter border so it reads as one forged thing.
  roundRect(ctx, x0 + 0.75, y0 + 0.75, W - 1.5, H - 1.5, r);
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.strokeStyle = css(0xffffff, stage === "stone" ? 0.12 : stage === "hint" ? 0.2 : 0.24);
  ctx.stroke();
  if (slab) {
    const bw = Math.max(2, s * 0.07);
    roundRect(ctx, x0 + bw / 2, y0 + bw / 2, W - bw, H - bw, r * 1.3);
    ctx.lineWidth = bw;
    ctx.strokeStyle = css(mix(style.color, 0xffffff, 0.5), 0.95);
    ctx.stroke();
    roundRect(ctx, x0 + bw * 1.5, y0 + bw * 1.5, W - bw * 3, H - bw * 3, r);
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.strokeStyle = css(mix(style.color, 0x000000, 0.5), 0.6);
    ctx.stroke();
  }
  if (style.kind === "breaker") {
    roundRect(ctx, x0, y0, W, H, r);
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.strokeStyle = css(BONE, 0.9);
    ctx.stroke();
    paintBlade(ctx, s, s / 2, s / 2);
    if (style.showMarks && style.mark) {
      ctx.save();
      ctx.translate(s * 0.02, s * 0.02);
      ctx.scale(0.55, 0.55);
      paintMark(ctx, s, style.mark);
      ctx.restore();
    }
    return;
  }
  if ((style.kind === "block" || stage === "hint") && style.showMarks && style.mark) {
    // One badge at the centre of the block, whatever its size. Scrap about to ripen wears its
    // coming mark, a little faint, so the color coming reads without color too.
    ctx.save();
    ctx.translate((s * w) / 2 - s / 2, (s * h) / 2 - s / 2);
    ctx.globalAlpha = stage === "hint" ? 0.7 : 1;
    paintMark(ctx, s, style.mark);
    ctx.restore();
  }
}

/** A short sword across the block: blade, guard, grip, in bone with a dark edge. */
function paintBlade(ctx: CanvasRenderingContext2D, s: number, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  const L = s * 0.36;
  const bw = s * 0.09;
  ctx.lineJoin = "round";
  const draw = (fill: string, stroke: string | null): void => {
    ctx.beginPath();
    ctx.moveTo(-L, -bw / 2);
    ctx.lineTo(L * 0.55, -bw / 2);
    ctx.lineTo(L, 0);
    ctx.lineTo(L * 0.55, bw / 2);
    ctx.lineTo(-L, bw / 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };
  draw(css(INK, 0.55), null);
  ctx.translate(0, -s * 0.015);
  draw(css(BONE), css(INK, 0.6));
  // Guard and grip.
  ctx.fillStyle = css(0xd4a548);
  ctx.fillRect(-L * 0.42, -s * 0.11, s * 0.06, s * 0.22);
  ctx.fillStyle = css(0x4e3419);
  ctx.fillRect(-L, -bw * 0.6, L * 0.55, bw * 1.2);
  ctx.beginPath();
  ctx.arc(-L - s * 0.01, 0, s * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = css(0xd4a548);
  ctx.fill();
  ctx.restore();
}

function paintCracks(ctx: CanvasRenderingContext2D, s: number, w: number, h: number): void {
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, s * 0.03);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const ox = cx * s;
      const oy = cy * s;
      ctx.strokeStyle = css(0x000000, 0.4);
      ctx.beginPath();
      ctx.moveTo(ox + s * 0.2, oy + s * 0.25);
      ctx.lineTo(ox + s * 0.45, oy + s * 0.5);
      ctx.lineTo(ox + s * 0.38, oy + s * 0.78);
      ctx.moveTo(ox + s * 0.45, oy + s * 0.5);
      ctx.lineTo(ox + s * 0.8, oy + s * 0.42);
      ctx.stroke();
      ctx.strokeStyle = css(0xffffff, 0.18);
      ctx.beginPath();
      ctx.moveTo(ox + s * 0.22, oy + s * 0.29);
      ctx.lineTo(ox + s * 0.47, oy + s * 0.54);
      ctx.stroke();
      // Pits.
      ctx.fillStyle = css(0x000000, 0.25);
      for (const [px, py] of [
        [0.72, 0.7],
        [0.3, 0.6],
        [0.62, 0.22],
      ] as const) {
        ctx.beginPath();
        ctx.arc(ox + s * px, oy + s * py, s * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function paintSurface(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, base: number, texture: SwordTexture): void {
  const dark = (a: number, t = 0.45): string => css(mix(base, 0x000000, t), a);
  const light = (a: number, t = 0.6): string => css(mix(base, 0xffffff, t), a);
  const lw = Math.max(1, s * 0.025);
  const c = s / 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = lw;
  switch (texture) {
    case "facet": {
      // A cut gem: a table in the middle, facets running to the corners, lit on the upper-left.
      const t = s * 0.22;
      const pts = [
        [c - t, c - t],
        [c + t, c - t],
        [c + t, c + t],
        [c - t, c + t],
      ] as const;
      const corners = [
        [ox + s * 0.08, oy + s * 0.08],
        [ox + s * 0.92, oy + s * 0.08],
        [ox + s * 0.92, oy + s * 0.92],
        [ox + s * 0.08, oy + s * 0.92],
      ] as const;
      for (let i = 0; i < 4; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % 4]!;
        ctx.beginPath();
        ctx.moveTo(ox + a[0], oy + a[1]);
        ctx.lineTo(corners[i]![0], corners[i]![1]);
        ctx.lineTo(corners[(i + 1) % 4]![0], corners[(i + 1) % 4]![1]);
        ctx.lineTo(ox + b[0], oy + b[1]);
        ctx.closePath();
        ctx.fillStyle = i === 0 ? light(0.28) : i === 1 ? dark(0.08) : i === 2 ? dark(0.3) : light(0.1);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.rect(ox + c - t, oy + c - t, t * 2, t * 2);
      ctx.fillStyle = light(0.14);
      ctx.fill();
      ctx.strokeStyle = light(0.5);
      ctx.stroke();
      return;
    }
    case "rivet": {
      // Riveted steel: brushed lines and four rivets.
      ctx.strokeStyle = dark(0.22);
      for (let y = s * 0.14; y < s * 0.9; y += s * 0.09) {
        ctx.beginPath();
        ctx.moveTo(ox + s * 0.1, oy + y);
        ctx.lineTo(ox + s * 0.9, oy + y + s * 0.01);
        ctx.stroke();
      }
      for (const [rx, ry] of [
        [0.22, 0.22],
        [0.78, 0.22],
        [0.22, 0.78],
        [0.78, 0.78],
      ] as const) {
        ctx.beginPath();
        ctx.arc(ox + s * rx, oy + s * ry + lw, s * 0.07, 0, Math.PI * 2);
        ctx.fillStyle = dark(0.5);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ox + s * rx, oy + s * ry, s * 0.07, 0, Math.PI * 2);
        ctx.fillStyle = light(0.9, 0.3);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ox + s * rx - s * 0.02, oy + s * ry - s * 0.02, s * 0.03, 0, Math.PI * 2);
        ctx.fillStyle = light(0.8, 0.8);
        ctx.fill();
      }
      return;
    }
    case "scale": {
      // Fish scale: rows of arcs, offset every other row.
      const rr = s * 0.17;
      for (let row = 0; row < 5; row++) {
        const y = oy + s * 0.12 + row * rr * 0.95;
        const off = row % 2 ? rr : 0;
        for (let x = ox - rr + off; x < ox + s + rr; x += rr * 2) {
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, Math.PI);
          ctx.strokeStyle = dark(0.4);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y - lw, rr, 0.15, Math.PI - 0.15);
          ctx.strokeStyle = light(0.3);
          ctx.stroke();
        }
      }
      return;
    }
    case "hatch": {
      // Cross-hatch: a woven lattice.
      const step = s * 0.16;
      for (const dir of [1, -1]) {
        for (let k = -s; k <= s * 2; k += step) {
          ctx.beginPath();
          ctx.moveTo(ox + k, oy);
          ctx.lineTo(ox + k + s * dir, oy + s);
          ctx.strokeStyle = dark(0.3);
          ctx.lineWidth = lw * 1.6;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ox + k + lw, oy);
          ctx.lineTo(ox + k + lw + s * dir, oy + s);
          ctx.strokeStyle = light(0.22);
          ctx.lineWidth = lw * 0.8;
          ctx.stroke();
        }
      }
      ctx.lineWidth = lw;
      return;
    }
    case "swirl": {
      // A spiral from the centre.
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 6; a += 0.15) {
        const rad = (a / (Math.PI * 6)) * s * 0.42;
        const x = ox + c + Math.cos(a) * rad;
        const y = oy + c + Math.sin(a) * rad;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = dark(0.45);
      ctx.lineWidth = lw * 1.8;
      ctx.stroke();
      ctx.strokeStyle = light(0.35);
      ctx.lineWidth = lw * 0.8;
      ctx.stroke();
      ctx.lineWidth = lw;
      return;
    }
    case "rings": {
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(ox + c, oy + c, s * 0.13 * i, 0, Math.PI * 2);
        ctx.strokeStyle = i % 2 ? dark(0.4) : light(0.4);
        ctx.lineWidth = lw * 1.4;
        ctx.stroke();
      }
      ctx.lineWidth = lw;
      return;
    }
    default:
      return;
  }
}

export function blockCanvas(s: number, w: number, h: number, style: BlockStyle, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * w * resolution);
  canvas.height = Math.ceil(s * h * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintBlock(ctx, s, w, h, style);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a block for the page legend; cached because legends re-render often. */
export function blockDataUrl(style: BlockStyle, px: number): string {
  const key = JSON.stringify([style, px, spriteRevision()]);
  let url = urlCache.get(key);
  if (!url) {
    url = blockCanvas(px, 1, 1, style, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
