import type { MarkName } from "@openseas/content";
import { drawSprite, paintSprite, spriteRevision } from "../sprites/atlas.js";
import type { Graphics } from "pixi.js";
import { drawMarkShape } from "../marks/pixi.js";

export type StarShapeName = "spark" | "star" | "comet";

/** Outline points for a star silhouette centered on (x, y) with outer radius r. */
export function starPolygon(shape: StarShapeName, x: number, y: number, r: number): number[] {
  const pts: number[] = [];
  if (shape === "spark") {
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? r : r * 0.32;
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      pts.push(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
  } else if (shape === "star") {
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * 0.48;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
  } else {
    // Comet: a round head with a tail sweeping down-left.
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI * 0.75 + (i / steps) * Math.PI * 1.5;
      pts.push(x + r * 0.62 * Math.cos(a), y + r * 0.62 * Math.sin(a));
    }
    pts.push(x - r * 1.0, y + r * 1.0);
  }
  return pts;
}

/** Same silhouettes as an SVG path string, for React legends. */
export function starPath(shape: StarShapeName, x: number, y: number, r: number): string {
  const p = starPolygon(shape, x, y, r);
  let d = "";
  for (let i = 0; i < p.length; i += 2) d += `${i === 0 ? "M" : "L"}${p[i]!.toFixed(2)} ${p[i + 1]!.toFixed(2)}`;
  return d + "Z";
}

export interface StarPaint {
  shape: StarShapeName;
  color: number;
  /** A hollow marker instead of a solid star. */
  hollow: boolean;
  /** The color's mark, drawn when the player turns marks on. */
  mark: MarkName | null;
  alpha?: number;
}

export function navigationSpriteName(shape: StarShapeName, color: number, hollow: boolean): string {
  const colorName = ({ [0xf5d021]: "gold", [0x7fd7ff]: "ice", [0xff6b5e]: "ember" } as Record<number, string>)[color];
  return hollow ? `marker-${shape}` : `${colorName}-${shape}`;
}

const iconCache = new Map<string, string>();
export function starSpriteUrl(shape: StarShapeName, color: number, px: number): string | undefined {
  const name = navigationSpriteName(shape, color, false);
  const key = `${name}/${px}/${spriteRevision()}`;
  let url = iconCache.get(key);
  if (!url) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.ceil(px * 3);
    const ctx = canvas.getContext("2d");
    if (!ctx || !drawSprite(ctx, "navigation", name, 0, 0, canvas.width, canvas.height)) return undefined;
    url = canvas.toDataURL();
    iconCache.set(key, url);
  }
  return url;
}

export function paintStar(g: Graphics, x: number, y: number, r: number, p: StarPaint): void {
  const alpha = p.alpha ?? 1;
  const name = navigationSpriteName(p.shape, p.color, p.hollow);
  if (paintSprite(g, "navigation", name, x - r * 1.12, y - r * 1.12, r * 2.24, r * 2.24, alpha, p.hollow ? p.color : 0xffffff)) {
    drawStarMark(g, x, y, r, p, alpha);
    return;
  }
  const poly = starPolygon(p.shape, x, y, r);
  if (p.hollow) {
    g.poly(poly).fill({ color: p.color, alpha: 0.1 * alpha });
    g.poly(poly).stroke({ width: Math.max(1.5, r * 0.14), color: p.color, alpha: 0.9 * alpha });
  } else {
    g.poly(starPolygon(p.shape, x, y + r * 0.08, r)).fill({ color: 0x000000, alpha: 0.35 * alpha });
    g.poly(poly).fill({ color: p.color, alpha });
    g.poly(poly).stroke({ width: Math.max(1, r * 0.08), color: 0xffffff, alpha: 0.55 * alpha });
    // A bright core gives the star some glow without a filter.
    g.circle(x, y, r * 0.22).fill({ color: 0xffffff, alpha: 0.75 * alpha });
  }
  drawStarMark(g, x, y, r, p, alpha);
}

/** The color's mark at the star's heart: dark on a solid star, in the color on a hollow marker. */
function drawStarMark(g: Graphics, x: number, y: number, r: number, p: StarPaint, alpha: number): void {
  if (p.mark) drawMarkShape(g, p.mark, x, y, r * 0.3, { fill: { color: p.hollow ? p.color : 0x0b1526, alpha: 0.9 * alpha } });
}
