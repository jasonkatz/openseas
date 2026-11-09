import { drawSprite, spriteRevision } from "../sprites/atlas.js";
import { mix, paintMark } from "../cooling/tiles.js";

/**
 * Engines pieces are discs, not tiles: round, glossy, each kind with its own surface (sailcloth
 * weave, coiled rope, sea ripples, salt speckle) so kinds read apart by pattern as well as color,
 * and a mark badge when the player turns marks on (CLAUDE.md rule 6).
 */
export type EnginesTexture = "weave" | "coil" | "ripple" | "speckle";

export interface PelletStyle {
  color: number;
  texture: EnginesTexture;
  mark: string | null;
  showMarks: boolean;
}

const css = (c: number, alpha = 1): string => `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${alpha})`;

/** Paints one disc into a cell of size `s` whose top-left corner is the context origin. */
export function paintPellet(ctx: CanvasRenderingContext2D, s: number, style: PelletStyle): void {
  if (drawSprite(ctx, "engines", style.texture, 0, 0, s, s)) {
    if (style.showMarks && style.mark) paintMark(ctx, s, style.mark);
    return;
  }
  const c = s / 2;
  const r = s * 0.42;
  const base = style.color;
  const dark = mix(base, 0x000000, 0.35);
  const light = mix(base, 0xffffff, 0.35);

  // Drop shadow and body.
  ctx.beginPath();
  ctx.arc(c, c + s * 0.03, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
  const body = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
  body.addColorStop(0, css(light));
  body.addColorStop(0.55, css(base));
  body.addColorStop(1, css(dark));
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();

  // Surface, clipped to the disc.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r * 0.96, 0, Math.PI * 2);
  ctx.clip();
  paintSurface(ctx, s, c, r, base, style.texture);
  ctx.restore();

  // Rim and gloss.
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.strokeStyle = css(mix(dark, 0x000000, 0.4), 0.9);
  ctx.stroke();
  const gloss = ctx.createLinearGradient(c, c - r, c, c);
  gloss.addColorStop(0, "rgba(255,255,255,0.38)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.ellipse(c, c - r * 0.42, r * 0.62, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fillStyle = gloss;
  ctx.fill();

  if (style.showMarks && style.mark) paintMark(ctx, s, style.mark);
}

function paintSurface(ctx: CanvasRenderingContext2D, s: number, c: number, r: number, base: number, texture: EnginesTexture): void {
  const dark = css(mix(base, 0x000000, 0.45), 0.45);
  const light = css(mix(base, 0xffffff, 0.6), 0.5);
  ctx.lineWidth = Math.max(0.8, s * 0.025);
  switch (texture) {
    case "weave": {
      // Canvas weave: two sets of fine threads, plus a stitched seam across the middle.
      const step = Math.max(2.5, s * 0.09);
      ctx.strokeStyle = dark;
      for (let x = c - r; x <= c + r; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, c - r);
        ctx.lineTo(x, c + r);
        ctx.stroke();
      }
      ctx.strokeStyle = light;
      for (let y = c - r; y <= c + r; y += step) {
        ctx.beginPath();
        ctx.moveTo(c - r, y);
        ctx.lineTo(c + r, y);
        ctx.stroke();
      }
      ctx.strokeStyle = css(mix(base, 0x000000, 0.6), 0.7);
      ctx.setLineDash([s * 0.06, s * 0.05]);
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath();
      ctx.moveTo(c - r, c + r * 0.1);
      ctx.lineTo(c + r, c - r * 0.1);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    case "coil": {
      // Coiled rope: concentric rings, each twisted with short diagonal strands.
      const rings = 3;
      for (let i = 0; i < rings; i++) {
        const rr = r * (0.28 + (i * 0.68) / rings);
        ctx.beginPath();
        ctx.arc(c, c, rr, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1.5, r * 0.16);
        ctx.strokeStyle = i % 2 ? dark : light;
        ctx.stroke();
        const n = 10 + i * 6;
        ctx.lineWidth = Math.max(0.8, s * 0.025);
        ctx.strokeStyle = css(mix(base, 0x000000, 0.55), 0.6);
        for (let k = 0; k < n; k++) {
          const a0 = (k / n) * Math.PI * 2;
          const a1 = a0 + 0.22;
          ctx.beginPath();
          ctx.moveTo(c + Math.cos(a0) * (rr - r * 0.07), c + Math.sin(a0) * (rr - r * 0.07));
          ctx.lineTo(c + Math.cos(a1) * (rr + r * 0.07), c + Math.sin(a1) * (rr + r * 0.07));
          ctx.stroke();
        }
      }
      return;
    }
    case "ripple": {
      // Sea: rolling waves with bright crests.
      const rows = 4;
      for (let i = 0; i < rows; i++) {
        const y = c - r * 0.7 + (i * 1.4 * r) / (rows - 1);
        for (const [color, dy] of [
          [dark, s * 0.03],
          [light, 0],
        ] as const) {
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, s * 0.035);
          for (let x = c - r; x <= c + r; x += 1) {
            const yy = y + dy + Math.sin(((x - c) / r) * Math.PI * 2 + i) * r * 0.08;
            if (x === c - r) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }
      }
      return;
    }
    case "speckle": {
      // Salt crust: scattered grains, deterministic so every bake matches.
      let seed = 7;
      const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * r * 0.85;
        const g = Math.max(0.8, s * (0.02 + rnd() * 0.03));
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, g, 0, Math.PI * 2);
        ctx.fillStyle = i % 3 ? light : dark;
        ctx.fill();
      }
      return;
    }
    default:
      return;
  }
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
