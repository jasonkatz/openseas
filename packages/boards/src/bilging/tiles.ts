import { drawSprite, spriteRevision, type SpritePuzzle } from "../sprites/atlas.js";
import { Graphics } from "pixi.js";

/**
 * Tile sprites, painted with Canvas 2D so the board and the page legend share one piece of art.
 * Ordinary kinds use distinct illustrated objects and surfaces. With marks on, each kind also
 * carries a symbol on a light badge (CLAUDE.md rule 6). Specials have a dark chamfered plate,
 * bright double rim, corner studs, their own icon and a label.
 */
export type TileTexture = "knurl" | "fan" | "waves" | "grain" | "nacre" | "fronds" | "pores";
export type SpecialName = "keg" | "ink" | "barnacle";

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

const BRASS = 0xd4a548;
const INK = 0x0b1526;

export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const css = (c: number, alpha = 1): string =>
  `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${alpha})`;

/** Small seeded generator so a kind's speckles land in the same place on every bake. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paints one tile into a cell of size `s` whose top-left corner is the context origin. */
export function paintTile(ctx: CanvasRenderingContext2D, s: number, style: TileStyle): void {
  if (style.special) paintSpecialFrame(ctx, s);
  const sprite = style.sprite?.name ?? style.special ?? ({ knurl: "cog", fan: "shell", waves: "anchor", grain: "plank", nacre: "pearl", fronds: "kelp", pores: "coral" } as const)[style.texture ?? "knurl"];
  const inset = style.special ? s * 0.08 : 0;
  if (drawSprite(ctx, style.sprite?.puzzle ?? "bilging", sprite, inset, inset, s - inset * 2, s - inset * 2)) {
    if (style.special && s >= 36 && style.label) {
      ctx.font = `700 ${Math.max(7, s * 0.15)}px "Atkinson Hyperlegible", sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = Math.max(2, s * 0.05);
      ctx.strokeStyle = "#0b1526";
      ctx.fillStyle = "#f2f0e6";
      ctx.strokeText(style.label, s / 2, s * 0.94);
      ctx.fillText(style.label, s / 2, s * 0.94);
    } else if (style.showMarks && style.mark) paintMark(ctx, s, style.mark);
    return;
  }
  const c = s / 2;
  const half = s * 0.44;
  const x0 = c - half;
  const y0 = c - half;
  const w = half * 2;
  const r = s * 0.16;
  const lip = s * 0.05;
  const base = style.color;

  // Contact shadow and a darker underside so tiles read as raised blocks.
  roundRect(ctx, x0, y0 + lip * 1.4, w, w, r);
  ctx.fillStyle = css(0x000000, 0.38);
  ctx.fill();
  roundRect(ctx, x0, y0 + lip, w, w, r);
  ctx.fillStyle = css(mix(base, 0x000000, style.special ? 0.4 : 0.34));
  ctx.fill();

  ctx.save();
  roundRect(ctx, x0, y0, w, w, r);
  ctx.clip();
  const body = ctx.createLinearGradient(0, y0, 0, y0 + w);
  body.addColorStop(0, css(mix(base, 0xffffff, 0.2)));
  body.addColorStop(0.55, css(base));
  body.addColorStop(1, css(mix(base, 0x000000, 0.14)));
  ctx.fillStyle = body;
  ctx.fillRect(x0, y0, w, w);

  if (style.special) paintSpecialSurface(ctx, s, x0, y0, w, base, style.special);
  else if (style.texture) paintTexture(ctx, s, x0, y0, w, base, style.texture);

  // Gloss across the top and a soft shade along the bottom edge, inside the body.
  const gloss = ctx.createLinearGradient(0, y0, 0, y0 + w * 0.42);
  gloss.addColorStop(0, css(0xffffff, 0.34));
  gloss.addColorStop(1, css(0xffffff, 0));
  roundRect(ctx, x0 + s * 0.06, y0 + s * 0.04, w - s * 0.12, w * 0.38, r * 0.75);
  ctx.fillStyle = gloss;
  ctx.fill();
  const shade = ctx.createLinearGradient(0, y0 + w * 0.7, 0, y0 + w);
  shade.addColorStop(0, css(0x000000, 0));
  shade.addColorStop(1, css(0x000000, 0.22));
  ctx.fillStyle = shade;
  ctx.fillRect(x0, y0 + w * 0.7, w, w * 0.3);
  ctx.restore();

  roundRect(ctx, x0 + 0.75, y0 + 0.75, w - 1.5, w - 1.5, r);
  ctx.lineWidth = Math.max(1, s * 0.024);
  ctx.strokeStyle = css(0xffffff, 0.22);
  ctx.stroke();

  if (style.special) {
    roundRect(ctx, x0, y0, w, w, r);
    ctx.lineWidth = Math.max(1.5, s * 0.045);
    ctx.strokeStyle = css(BRASS, 0.95);
    ctx.stroke();
    const labelled = s >= 36 && style.label.length > 0;
    paintSpecialIcon(ctx, s, labelled ? c - s * 0.07 : c, style.special);
    if (labelled) {
      ctx.font = `700 ${Math.max(7, s * 0.15)}px "Atkinson Hyperlegible", "Avenir Next", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = Math.max(2, s * 0.05);
      ctx.strokeStyle = css(0x000000, 0.55);
      ctx.strokeText(style.label, c, y0 + w - s * 0.06);
      ctx.fillStyle = css(0xf2f0e6);
      ctx.fillText(style.label, c, y0 + w - s * 0.06);
    }
    return;
  }
  if (style.showMarks && style.mark) paintMark(ctx, s, style.mark);
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

/** The white shape flashed over a tile as it clears. */
export function buildFlash(s: number): Graphics {
  const half = s * 0.44;
  return new Graphics().roundRect(-half, -half, half * 2, half * 2, s * 0.16).fill(0xffffff);
}

// ---- surfaces

function paintTexture(ctx: CanvasRenderingContext2D, s: number, x0: number, y0: number, w: number, base: number, texture: TileTexture): void {
  const dark = (a: number, t = 0.45): string => css(mix(base, 0x000000, t), a);
  const light = (a: number, t = 0.55): string => css(mix(base, 0xffffff, t), a);
  const lw = Math.max(1, s * 0.022);
  const cx = x0 + w / 2;
  const cy = y0 + w / 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (texture) {
    case "knurl": {
      // Knurled brass: a fine diagonal cross-hatch, each groove with a lit edge, around a raised hub.
      const step = s * 0.115;
      for (const dir of [1, -1]) {
        for (let k = -w; k <= w * 2; k += step) {
          ctx.beginPath();
          ctx.moveTo(x0 + k, y0);
          ctx.lineTo(x0 + k + w * dir, y0 + w);
          ctx.lineWidth = lw * 1.4;
          ctx.strokeStyle = dark(0.42);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x0 + k + lw * 1.2, y0);
          ctx.lineTo(x0 + k + lw * 1.2 + w * dir, y0 + w);
          ctx.lineWidth = lw * 0.8;
          ctx.strokeStyle = light(0.35);
          ctx.stroke();
        }
      }
      const hub = s * 0.17;
      ctx.beginPath();
      ctx.arc(cx, cy + lw, hub, 0, Math.PI * 2);
      ctx.fillStyle = dark(0.45);
      ctx.fill();
      const hubFill = ctx.createRadialGradient(cx - hub * 0.4, cy - hub * 0.4, hub * 0.1, cx, cy, hub);
      hubFill.addColorStop(0, light(1, 0.5));
      hubFill.addColorStop(1, css(base));
      ctx.beginPath();
      ctx.arc(cx, cy, hub, 0, Math.PI * 2);
      ctx.fillStyle = hubFill;
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = dark(0.5);
      ctx.stroke();
      break;
    }
    case "fan": {
      // A ribbed scallop: ridges fan out from a hinge at the bottom, crossed by growth lines.
      const hx = cx;
      const hy = y0 + w * 1.02;
      const ribs = 9;
      for (let k = 0; k < ribs; k++) {
        const a0 = Math.PI + (Math.PI * k) / ribs;
        const a1 = Math.PI + (Math.PI * (k + 0.5)) / ribs;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.arc(hx, hy, w * 1.3, a0, a1);
        ctx.closePath();
        ctx.fillStyle = css(mix(base, 0x9a6b3c, 0.5), 0.22);
        ctx.fill();
      }
      for (let k = 0; k <= ribs; k++) {
        const a = Math.PI + (Math.PI * k) / ribs;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + Math.cos(a) * w * 1.3, hy + Math.sin(a) * w * 1.3);
        ctx.lineWidth = lw;
        ctx.strokeStyle = css(mix(base, 0x7a5030, 0.6), 0.45);
        ctx.stroke();
      }
      for (const rad of [0.36, 0.62, 0.86]) {
        ctx.beginPath();
        ctx.arc(hx, hy, w * rad, Math.PI, Math.PI * 2);
        ctx.lineWidth = lw * 0.8;
        ctx.strokeStyle = css(mix(base, 0x7a5030, 0.5), 0.3);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(hx, y0 + w * 0.92, w * 0.16, w * 0.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = css(mix(base, 0x9a6b3c, 0.5), 0.5);
      ctx.fill();
      break;
    }
    case "waves": {
      // Rolling swell: stacked wave bands, each with a foam crest.
      const bands = 4;
      const bh = w / bands;
      for (let b = 0; b <= bands; b++) {
        const y = y0 + b * bh - bh * 0.25;
        const shift = (b % 2) * w * 0.17;
        const path = (): void => {
          ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const x = x0 + (w * i) / 24;
            const yy = y + Math.sin(((x - x0 + shift) / w) * Math.PI * 4) * bh * 0.2;
            if (i === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
        };
        path();
        ctx.lineTo(x0 + w, y + bh * 0.62);
        ctx.lineTo(x0, y + bh * 0.62);
        ctx.closePath();
        ctx.fillStyle = dark(0.24, 0.4);
        ctx.fill();
        path();
        ctx.lineWidth = lw * 1.3;
        ctx.strokeStyle = light(0.6, 0.65);
        ctx.stroke();
      }
      break;
    }
    case "grain": {
      // Planking: wavy grain lines that bend around a knot, and a seam between two boards.
      const rnd = seeded(7);
      const kx = x0 + w * 0.68;
      const ky = y0 + w * 0.36;
      for (let line = 0; line < 11; line++) {
        const y = y0 + (w * (line + 0.4)) / 11;
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) {
          const x = x0 + (w * i) / 20;
          const d = Math.hypot((x - kx) / (w * 0.22), (y - ky) / (w * 0.14));
          const bend = d < 2.4 ? ((y < ky ? -1 : 1) * w * 0.06) / Math.max(0.6, d) : 0;
          const yy = y + Math.sin(i * 0.7 + line * 1.3) * s * 0.012 + bend;
          if (i === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.lineWidth = lw * (0.7 + rnd() * 0.9);
        ctx.strokeStyle = dark(0.25 + rnd() * 0.2, 0.42);
        ctx.stroke();
      }
      for (let k = 3; k >= 1; k--) {
        ctx.beginPath();
        ctx.ellipse(kx, ky, w * 0.045 * k, w * 0.03 * k, 0, 0, Math.PI * 2);
        ctx.fillStyle = dark(k === 1 ? 0.6 : 0.18, 0.5);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(x0, y0 + w * 0.62);
      ctx.lineTo(x0 + w, y0 + w * 0.62);
      ctx.lineWidth = lw * 1.6;
      ctx.strokeStyle = dark(0.55, 0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x0, y0 + w * 0.62 + lw * 1.4);
      ctx.lineTo(x0 + w, y0 + w * 0.62 + lw * 1.4);
      ctx.lineWidth = lw;
      ctx.strokeStyle = light(0.35);
      ctx.stroke();
      for (const nx of [0.2, 0.8]) {
        ctx.beginPath();
        ctx.arc(x0 + w * nx, y0 + w * 0.8, s * 0.028, 0, Math.PI * 2);
        ctx.fillStyle = dark(0.65, 0.55);
        ctx.fill();
      }
      break;
    }
    case "nacre": {
      // Mother-of-pearl: shimmering concentric rings off a bright core, tinted pink and teal.
      const px = x0 + w * 0.38;
      const py = y0 + w * 0.38;
      for (let k = 9; k >= 1; k--) {
        ctx.beginPath();
        ctx.arc(px, py, w * 0.12 * k, 0, Math.PI * 2);
        const tint = k % 3 === 0 ? 0xff9ad5 : k % 3 === 1 ? 0x8ff0ff : 0xffffff;
        ctx.lineWidth = lw * 1.5;
        ctx.strokeStyle = css(mix(base, tint, 0.55), 0.38);
        ctx.stroke();
      }
      const core = ctx.createRadialGradient(px, py, 0, px, py, w * 0.3);
      core.addColorStop(0, css(0xffffff, 0.7));
      core.addColorStop(1, css(0xffffff, 0));
      ctx.fillStyle = core;
      ctx.fillRect(x0, y0, w, w);
      break;
    }
    case "fronds": {
      // Kelp: three swaying fronds, each a dark stalk with slanted leaf veins.
      for (let f = 0; f < 3; f++) {
        const fx = x0 + w * (0.2 + f * 0.3);
        const sway = (y: number): number => fx + Math.sin(((y - y0) / w) * Math.PI * 2 + f * 1.4) * w * 0.06;
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const y = y0 + (w * i) / 16;
          if (i === 0) ctx.moveTo(sway(y) - w * 0.07, y);
          else ctx.lineTo(sway(y) - w * 0.07, y);
        }
        for (let i = 16; i >= 0; i--) {
          const y = y0 + (w * i) / 16;
          ctx.lineTo(sway(y) + w * 0.07, y);
        }
        ctx.closePath();
        ctx.fillStyle = dark(0.26, 0.45);
        ctx.fill();
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const y = y0 + (w * i) / 16;
          if (i === 0) ctx.moveTo(sway(y), y);
          else ctx.lineTo(sway(y), y);
        }
        ctx.lineWidth = lw * 1.2;
        ctx.strokeStyle = dark(0.55, 0.55);
        ctx.stroke();
        for (let v = 0; v < 6; v++) {
          const y = y0 + w * (0.08 + v * 0.16);
          const x = sway(y);
          const side = v % 2 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + side * w * 0.09, y - w * 0.07);
          ctx.lineWidth = lw;
          ctx.strokeStyle = light(0.42, 0.5);
          ctx.stroke();
        }
      }
      break;
    }
    case "pores": {
      // Coral: a crowd of round pores, each a dark pit with a lit lower rim.
      const rnd = seeded(31);
      const placed: Array<[number, number, number]> = [];
      for (let tries = 0; tries < 220 && placed.length < 16; tries++) {
        const pr = w * (0.05 + rnd() * 0.055);
        const px = x0 + rnd() * w;
        const py = y0 + rnd() * w;
        if (placed.some(([qx, qy, qr]) => Math.hypot(px - qx, py - qy) < pr + qr + w * 0.035)) continue;
        placed.push([px, py, pr]);
      }
      for (const [px, py, pr] of placed) {
        ctx.beginPath();
        ctx.arc(px, py + pr * 0.18, pr, 0, Math.PI * 2);
        ctx.fillStyle = light(0.45, 0.45);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fillStyle = dark(0.6, 0.5);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py - pr * 0.15, pr * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = dark(0.5, 0.7);
        ctx.fill();
      }
      break;
    }
  }
}

function paintSpecialSurface(ctx: CanvasRenderingContext2D, s: number, x0: number, y0: number, w: number, base: number, special: SpecialName): void {
  const lw = Math.max(1, s * 0.022);
  switch (special) {
    case "keg": {
      // Barrel staves bound by two iron hoops.
      for (let k = 1; k < 5; k++) {
        const x = x0 + (w * k) / 5;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.quadraticCurveTo(x + (x - (x0 + w / 2)) * 0.12, y0 + w / 2, x, y0 + w);
        ctx.lineWidth = lw * 1.3;
        ctx.strokeStyle = css(0x000000, 0.45);
        ctx.stroke();
      }
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = css(k % 2 ? 0x6b4a2e : 0x5a3c24, 0.35);
        ctx.fillRect(x0 + (w * k) / 5, y0, w / 5, w);
      }
      for (const hy of [0.16, 0.84]) {
        ctx.fillStyle = css(0x8d939c, 0.85);
        ctx.fillRect(x0, y0 + w * hy - s * 0.035, w, s * 0.07);
        ctx.fillStyle = css(0xffffff, 0.35);
        ctx.fillRect(x0, y0 + w * hy - s * 0.035, w, s * 0.018);
      }
      break;
    }
    case "ink": {
      // Swirling ink: loose spirals in a lighter violet.
      const spirals: Array<[number, number, number]> = [
        [0.28, 0.3, 0.2],
        [0.74, 0.62, 0.24],
        [0.22, 0.82, 0.14],
      ];
      for (const [fx, fy, fr] of spirals) {
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const a = (i / 40) * Math.PI * 4;
          const rad = (w * fr * i) / 40;
          const x = x0 + w * fx + Math.cos(a) * rad;
          const y = y0 + w * fy + Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = lw * 1.4;
        ctx.strokeStyle = css(mix(base, 0xc084fc, 0.6), 0.45);
        ctx.stroke();
      }
      break;
    }
    case "barnacle": {
      // Crusty rock: speckles and small volcano-shaped shells around the edge.
      const rnd = seeded(53);
      for (let k = 0; k < 40; k++) {
        ctx.beginPath();
        ctx.arc(x0 + rnd() * w, y0 + rnd() * w, s * (0.008 + rnd() * 0.016), 0, Math.PI * 2);
        ctx.fillStyle = css(rnd() > 0.5 ? 0xffffff : 0x000000, 0.18 + rnd() * 0.15);
        ctx.fill();
      }
      const shells: Array<[number, number, number]> = [
        [0.14, 0.18, 0.09],
        [0.86, 0.22, 0.08],
        [0.12, 0.66, 0.07],
        [0.88, 0.7, 0.09],
        [0.5, 0.1, 0.06],
      ];
      for (const [fx, fy, fr] of shells) {
        const x = x0 + w * fx;
        const y = y0 + w * fy;
        ctx.beginPath();
        ctx.arc(x, y, w * fr, 0, Math.PI * 2);
        ctx.fillStyle = css(0xd9dccf, 0.7);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, w * fr * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = css(0x1d2128, 0.85);
        ctx.fill();
      }
      break;
    }
  }
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
  ctx.strokeStyle = css(INK, 0.35);
  ctx.stroke();
  ctx.fillStyle = css(INK, 0.85);
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

function paintSpecialIcon(ctx: CanvasRenderingContext2D, s: number, cy: number, special: SpecialName): void {
  const cx = s / 2;
  const r = s * 0.16;
  const bone = css(0xf2f0e6);
  switch (special) {
    case "keg": {
      // Bomb: ball, cap, fuse and spark.
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.3, r * 1.05, 0, Math.PI * 2);
      ctx.fillStyle = css(0x000000, 0.35);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.3, r, 0, Math.PI * 2);
      ctx.fillStyle = bone;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx - r * 0.35, cy, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = css(0xffffff, 0.9);
      ctx.fill();
      ctx.fillStyle = bone;
      ctx.fillRect(cx - r * 0.3, cy - r * 0.9, r * 0.6, r * 0.5);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.9);
      ctx.quadraticCurveTo(cx + r * 0.6, cy - r * 1.5, cx + r * 1.1, cy - r * 1.2);
      ctx.lineWidth = Math.max(1.5, s * 0.04);
      ctx.strokeStyle = bone;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + r * 1.15, cy - r * 1.2, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = css(0xffb347, 0.5);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + r * 1.15, cy - r * 1.2, r * 0.26, 0, Math.PI * 2);
      ctx.fillStyle = css(0xffe29a);
      ctx.fill();
      break;
    }
    case "ink": {
      // Splat: overlapping drops with a highlight.
      ctx.fillStyle = css(0xc084fc);
      for (const [dx, dy, dr] of [
        [-0.6, 0, 0.7],
        [0.5, -0.3, 0.6],
        [0, 0.5, 0.75],
        [0.2, -1.2, 0.25],
        [1.05, 0.55, 0.2],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + r * dx, cy + r * dy, r * dr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx - r * 0.75, cy - r * 0.2, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = css(0xffffff, 0.6);
      ctx.fill();
      break;
    }
    case "barnacle": {
      // Up chevron over ridges: it climbs.
      ctx.beginPath();
      const pts = [0, -1.3, 1.2, 0, 0.6, 0, 0, -0.6, -0.6, 0, -1.2, 0];
      for (let i = 0; i < pts.length; i += 2) {
        const x = cx + pts[i]! * r;
        const y = cy + pts[i + 1]! * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = bone;
      ctx.fill();
      ctx.fillStyle = css(0xf2f0e6, 0.75);
      ctx.fillRect(cx - r * 1.1, cy + r * 0.35, r * 2.2, r * 0.22);
      ctx.fillStyle = css(0xf2f0e6, 0.5);
      ctx.fillRect(cx - r * 0.8, cy + r * 0.8, r * 1.6, r * 0.22);
      break;
    }
  }
}
