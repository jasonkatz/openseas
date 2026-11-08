import { drawSprite, paintSprite, spriteRevision } from "../sprites/atlas.js";
import type { Graphics } from "pixi.js";

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
  /** The color's mark badge, drawn when the player turns marks on. */
  mark: string | null;
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
    if (p.mark) paintMark(g, x, y, r * 0.3, p.mark, p.hollow ? p.color : 0x0b1526, alpha);
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
  if (p.mark) paintMark(g, x, y, r * 0.3, p.mark, p.hollow ? p.color : 0x0b1526, alpha);
}

/** The marks vocabulary shared with the tile art: circle, square, triangle, diamond, hexagon, star. */
export function paintMark(g: Graphics, x: number, y: number, r: number, mark: string, color: number, alpha = 1): void {
  const regular = (n: number, rot: number): number[] => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(x + r * Math.cos(rot + (i * Math.PI * 2) / n), y + r * Math.sin(rot + (i * Math.PI * 2) / n));
    return pts;
  };
  switch (mark) {
    case "circle":
      g.circle(x, y, r * 0.85);
      break;
    case "square":
      g.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
      break;
    case "triangle":
      g.poly(regular(3, -Math.PI / 2));
      break;
    case "diamond":
      g.poly(regular(4, -Math.PI / 2));
      break;
    case "hexagon":
      g.poly(regular(6, 0));
      break;
    default:
      g.circle(x, y, r * 0.5);
  }
  g.fill({ color, alpha: 0.9 * alpha });
}
