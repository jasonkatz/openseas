import { drawSprite, spriteRevision, type SpritePuzzle } from "../sprites/atlas.js";
import type { Graphics } from "pixi.js";
import { paintPart } from "../parts.js";

/**
 * Tile sprites, painted with Canvas 2D so the board and the page legend share one piece of art.
 * Ordinary kinds are machine parts with their own silhouettes (cog, valve, bolt, fuse, crystal,
 * coil, chip); `texture` is the content key that picks one. With marks on, each kind also carries
 * a symbol on a light badge (CLAUDE.md rule 6). Specials have a dark chamfered plate, bright
 * double rim, corner studs, their own icon and a label.
 */
export type TileTexture = "knurl" | "fan" | "waves" | "grain" | "nacre" | "fronds" | "pores";
export type SpecialName = "charge" | "magnet" | "slag";

export interface TileStyle {
  /** Other boards may reuse the legend tile with an explicit material sprite. */
  sprite?: { puzzle: SpritePuzzle; name: string };
  color: number;
  texture: TileTexture | null;
  mark: string | null;
  special: SpecialName | null;
  label: string;
  showMarks: boolean;
}

const MAGNET = 0x0b1526;

export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const css = (c: number, alpha = 1): string =>
  `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${alpha})`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Each ordinary kind's sprite frame, and the vector part drawn in its place without the atlas. */
const PART: Record<TileTexture, "cog" | "valve" | "bolt" | "fuse" | "crystal" | "coil" | "chip"> = {
  knurl: "cog",
  fan: "valve",
  waves: "bolt",
  grain: "fuse",
  nacre: "crystal",
  fronds: "coil",
  pores: "chip",
};
const SPECIAL_PART: Record<SpecialName, "zap" | "magnet" | "slag"> = { charge: "zap", magnet: "magnet", slag: "slag" };

/** Paints one tile into a cell of size `s` whose top-left corner is the context origin. */
export function paintTile(ctx: CanvasRenderingContext2D, s: number, style: TileStyle): void {
  if (style.special) paintSpecialFrame(ctx, s);
  const sprite = style.sprite?.name ?? style.special ?? PART[style.texture ?? "knurl"];
  const inset = style.special ? s * 0.08 : 0;
  const labelled = Boolean(style.special) && s >= 36 && style.label.length > 0;
  if (!drawSprite(ctx, style.sprite?.puzzle ?? "cooling", sprite, inset, inset, s - inset * 2, s - inset * 2)) {
    // The atlas did not load: the same pieces as vector parts, so play never waits on an image.
    if (style.special) paintPart(ctx, SPECIAL_PART[style.special], s / 2, labelled ? s / 2 - s * 0.07 : s / 2, s * 0.78);
    else if (style.sprite) paintMaterial(ctx, s, style.color);
    else paintPart(ctx, PART[style.texture ?? "knurl"], s / 2, s / 2, s * 0.92, style.color);
  }
  if (labelled) {
    ctx.font = `700 ${Math.max(7, s * 0.15)}px "Atkinson Hyperlegible", sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.strokeStyle = "#0b1526";
    ctx.fillStyle = "#f2f0e6";
    ctx.strokeText(style.label, s / 2, s * 0.94);
    ctx.fillText(style.label, s / 2, s * 0.94);
  } else if (style.showMarks && style.mark) paintMark(ctx, s, style.mark);
}

/** Another board's material (a Plating metal) as a plain brushed square in its color. */
function paintMaterial(ctx: CanvasRenderingContext2D, s: number, base: number): void {
  const x0 = s * 0.06;
  const w = s * 0.88;
  roundRect(ctx, x0, x0, w, w, s * 0.06);
  const body = ctx.createLinearGradient(x0, x0, x0 + w, x0 + w);
  body.addColorStop(0, css(mix(base, 0xffffff, 0.3)));
  body.addColorStop(0.5, css(base));
  body.addColorStop(1, css(mix(base, 0x000000, 0.25)));
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.strokeStyle = "#0b1526";
  ctx.stroke();
  ctx.strokeStyle = css(mix(base, 0x000000, 0.3), 0.5);
  ctx.lineWidth = Math.max(0.6, s * 0.012);
  for (let k = 0.2; k < 0.95; k += 0.12) {
    ctx.beginPath();
    ctx.moveTo(x0 + s * 0.06, x0 + w * k);
    ctx.lineTo(x0 + w - s * 0.06, x0 + w * k);
    ctx.stroke();
  }
}

/** Specials wear a shared silhouette and a high-contrast rim, not just another piece color. */
function paintSpecialFrame(ctx: CanvasRenderingContext2D, s: number): void {
  const plate = (inset: number): void => {
    const lo = s * inset;
    const hi = s - lo;
    const cut = s * 0.13;
    ctx.beginPath();
    ctx.moveTo(lo + cut, lo);
    ctx.lineTo(hi - cut, lo);
    ctx.lineTo(hi, lo + cut);
    ctx.lineTo(hi, hi - cut);
    ctx.lineTo(hi - cut, hi);
    ctx.lineTo(lo + cut, hi);
    ctx.lineTo(lo, hi - cut);
    ctx.lineTo(lo, lo + cut);
    ctx.closePath();
  };
  ctx.save();
  const body = ctx.createLinearGradient(0, 0, 0, s);
  body.addColorStop(0, "#273c58");
  body.addColorStop(1, "#070f1c");
  plate(0.035);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, s * 0.055);
  ctx.strokeStyle = "#f6d577";
  ctx.stroke();
  plate(0.10);
  ctx.lineWidth = Math.max(0.8, s * 0.022);
  ctx.strokeStyle = "#fff5d0";
  ctx.stroke();
  // Pale corner studs keep the special treatment recognizable without relying on hue.
  ctx.fillStyle = "#fff5d0";
  for (const [x, y] of [[0.22, 0.09], [0.78, 0.09], [0.22, 0.91], [0.78, 0.91]]) {
    ctx.beginPath();
    ctx.arc(s * x!, s * y!, Math.max(0.7, s * 0.022), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A tile as its own canvas, `s` CSS pixels square at `resolution` device pixels per pixel. */
export function tileCanvas(s: number, style: TileStyle, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintTile(ctx, s, style);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a tile for the page legend; cached because legends re-render often. */
export function tileDataUrl(style: TileStyle, px: number): string {
  const key = JSON.stringify([style, px, spriteRevision()]);
  let url = urlCache.get(key);
  if (!url) {
    url = tileCanvas(px, style, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}

/** The white shape flashed over a tile as it clears, centred on (0, 0) in `g`. */
export function drawFlash(g: Graphics, s: number): void {
  const half = s * 0.44;
  g.roundRect(-half, -half, half * 2, half * 2, s * 0.16).fill(0xffffff);
}

// ---- marks and icons

/** Symbols for the marks setting: dark ink on a light badge, so they read over every texture. */
export function paintMark(ctx: CanvasRenderingContext2D, s: number, mark: string): void {
  const c = s / 2;
  const r = s * 0.14;
  ctx.beginPath();
  ctx.arc(c, c, r * 1.75, 0, Math.PI * 2);
  ctx.fillStyle = css(0xffffff, 0.72);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.strokeStyle = css(MAGNET, 0.35);
  ctx.stroke();
  ctx.fillStyle = css(MAGNET, 0.85);
  const poly = (pts: number[]): void => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      if (i === 0) ctx.moveTo(c + pts[i]!, c + pts[i + 1]!);
      else ctx.lineTo(c + pts[i]!, c + pts[i + 1]!);
    }
    ctx.closePath();
    ctx.fill();
  };
  const regular = (n: number, rad: number, rot: number, inner?: number): number[] => {
    const pts: number[] = [];
    const count = inner === undefined ? n : n * 2;
    for (let i = 0; i < count; i++) {
      const a = rot + (i / count) * Math.PI * 2;
      const rr = inner !== undefined && i % 2 ? inner : rad;
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    return pts;
  };
  switch (mark) {
    case "square":
      ctx.fillRect(c - r, c - r, r * 2, r * 2);
      break;
    case "triangle":
      poly([0, -r * 1.1, r * 1.1, r * 0.8, -r * 1.1, r * 0.8]);
      break;
    case "diamond":
      poly([0, -r * 1.25, r * 1.25, 0, 0, r * 1.25, -r * 1.25, 0]);
      break;
    case "hexagon":
      poly(regular(6, r * 1.15, 0));
      break;
    case "star":
      poly(regular(5, r * 1.3, -Math.PI / 2, r * 0.6));
      break;
    case "gear":
      ctx.beginPath();
      ctx.arc(c, c, r * 1.1, 0, Math.PI * 2);
      ctx.arc(c, c, r * 0.45, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
      break;
    case "circle":
    default:
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fill();
  }
}
