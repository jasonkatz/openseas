import { Container, FillGradient, Graphics, Text } from "pixi.js";

/**
 * Tiles are colored rounded squares. With marks on, each ordinary kind also carries a symbol so
 * kinds stay distinguishable without color (CLAUDE.md rule 6). Specials are dark squares with an
 * icon and a label. Everything is drawn centered at (0,0) inside a cell of size `s`; the renderer
 * bakes each kind to a texture once per layout.
 */
export interface TileStyle {
  color: number;
  mark: string | null;
  special: "keg" | "ink" | "barnacle" | null;
  label: string;
  showMarks: boolean;
}

const BRASS = 0xd4a548;
const INK = 0x0b1526;

export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function vertical(top: number, mid: number, bottom: number): FillGradient {
  return new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: top },
      { offset: 0.55, color: mid },
      { offset: 1, color: bottom },
    ],
    textureSpace: "local",
  });
}

export function buildTile(s: number, style: TileStyle): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const half = s * 0.44;
  const r = s * 0.16;
  const lip = s * 0.05;

  // Contact shadow, then the body with a darker underside so tiles read as raised blocks.
  g.roundRect(-half, -half + lip * 1.4, half * 2, half * 2, r).fill({ color: 0x000000, alpha: 0.38 });
  g.roundRect(-half, -half + lip, half * 2, half * 2, r).fill(mix(style.color, 0x000000, style.special ? 0.35 : 0.32));
  g.roundRect(-half, -half, half * 2, half * 2, r).fill(
    vertical(mix(style.color, 0xffffff, 0.22), style.color, mix(style.color, 0x000000, 0.1)),
  );
  // Gloss along the top and a thin inner rim.
  g.roundRect(-half + s * 0.07, -half + s * 0.05, half * 2 - s * 0.14, half * 0.62, r * 0.75).fill({ color: 0xffffff, alpha: 0.2 });
  g.roundRect(-half + 1, -half + 1, half * 2 - 2, half * 2 - 2, r).stroke({ width: Math.max(1, s * 0.022), color: 0xffffff, alpha: 0.16 });

  if (style.special) {
    g.roundRect(-half, -half, half * 2, half * 2, r).stroke({ width: Math.max(1.5, s * 0.045), color: BRASS, alpha: 0.95 });
    drawSpecialIcon(g, s, style.special);
    if (s >= 36) {
      const label = new Text({
        text: style.label,
        style: {
          fontFamily: "Atkinson Hyperlegible, Avenir Next, sans-serif",
          fontSize: Math.max(7, s * 0.15),
          fontWeight: "700",
          fill: 0xf2f0e6,
          letterSpacing: 0.8,
        },
        resolution: 3,
      });
      label.anchor.set(0.5, 1);
      label.position.set(0, half - s * 0.04);
      root.addChild(label);
    }
    return root;
  }
  if (style.showMarks && style.mark) drawMark(g, s, style.mark);
  return root;
}

/** The white shape flashed over a tile as it clears. */
export function buildFlash(s: number): Graphics {
  const half = s * 0.44;
  return new Graphics().roundRect(-half, -half, half * 2, half * 2, s * 0.16).fill(0xffffff);
}

/** Symbols for the marks setting, drawn in dark ink so they work on every tile color. */
function drawMark(g: Graphics, s: number, mark: string): void {
  const r = s * 0.14;
  const ink = { color: INK, alpha: 0.72 };
  switch (mark) {
    case "circle":
      g.circle(0, 0, r).fill(ink);
      break;
    case "square":
      g.rect(-r, -r, r * 2, r * 2).fill(ink);
      break;
    case "triangle":
      g.poly([0, -r * 1.1, r * 1.1, r * 0.8, -r * 1.1, r * 0.8]).fill(ink);
      break;
    case "diamond":
      g.poly([0, -r * 1.25, r * 1.25, 0, 0, r * 1.25, -r * 1.25, 0]).fill(ink);
      break;
    case "hexagon":
      g.regularPoly(0, 0, r * 1.15, 6, Math.PI / 6).fill(ink);
      break;
    case "star":
      g.star(0, 0, 5, r * 1.3, r * 0.6, -Math.PI / 2).fill(ink);
      break;
    case "gear":
      g.circle(0, 0, r * 1.1).fill(ink);
      g.circle(0, 0, r * 0.45).cut();
      break;
    default:
      g.circle(0, 0, r).fill(ink);
  }
}

function drawSpecialIcon(g: Graphics, s: number, special: "keg" | "ink" | "barnacle"): void {
  const r = s * 0.16;
  const cy = s >= 36 ? -s * 0.07 : 0;
  switch (special) {
    case "keg":
      // Bomb: ball, fuse, spark.
      g.circle(0, cy + r * 0.3, r).fill(0xf2f0e6);
      g.circle(-r * 0.35, cy, r * 0.3).fill({ color: 0xffffff, alpha: 0.9 });
      g.rect(-r * 0.3, cy - r * 0.9, r * 0.6, r * 0.5).fill(0xf2f0e6);
      g.moveTo(0, cy - r * 0.9).quadraticCurveTo(r * 0.6, cy - r * 1.5, r * 1.1, cy - r * 1.2).stroke({ width: Math.max(1.5, s * 0.04), color: 0xf2f0e6 });
      g.circle(r * 1.15, cy - r * 1.2, r * 0.42).fill({ color: 0xffb347, alpha: 0.45 });
      g.circle(r * 1.15, cy - r * 1.2, r * 0.26).fill(0xffd27a);
      break;
    case "ink":
      // Splat: three overlapping drops.
      g.circle(-r * 0.6, cy, r * 0.7).fill(0xc084fc);
      g.circle(r * 0.5, cy - r * 0.3, r * 0.6).fill(0xc084fc);
      g.circle(0, cy + r * 0.5, r * 0.75).fill(0xc084fc);
      g.circle(r * 0.2, cy - r * 1.2, r * 0.25).fill(0xc084fc);
      g.circle(-r * 0.75, cy - r * 0.2, r * 0.22).fill({ color: 0xffffff, alpha: 0.6 });
      break;
    case "barnacle":
      // Up chevron over ridges: it climbs.
      g.poly([0, cy - r * 1.3, r * 1.2, cy, r * 0.6, cy, 0, cy - r * 0.6, -r * 0.6, cy, -r * 1.2, cy]).fill(0xf2f0e6);
      g.rect(-r * 1.1, cy + r * 0.35, r * 2.2, r * 0.22).fill({ color: 0xf2f0e6, alpha: 0.7 });
      g.rect(-r * 0.8, cy + r * 0.8, r * 1.6, r * 0.22).fill({ color: 0xf2f0e6, alpha: 0.45 });
      break;
  }
}
