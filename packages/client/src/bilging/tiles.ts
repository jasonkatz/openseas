import { Graphics, Text } from "pixi.js";

/**
 * Tiles are colored rounded squares. With marks on, each ordinary kind also carries a symbol so
 * kinds stay distinguishable without color (CLAUDE.md rule 6). Specials are dark squares with an
 * icon and a label. Everything is drawn centered at (0,0) for a cell of size `s`.
 */
export interface TileStyle {
  color: number;
  mark: string | null;
  special: "keg" | "ink" | "barnacle" | null;
  label: string;
  showMarks: boolean;
}

export function drawTile(g: Graphics, s: number, style: TileStyle): void {
  const half = s * 0.42;
  g.clear();
  g.removeChildren().forEach((c) => c.destroy());
  g.roundRect(-half, -half, half * 2, half * 2, s * 0.14).fill(style.color);
  if (style.special) {
    g.roundRect(-half, -half, half * 2, half * 2, s * 0.14).stroke({ width: Math.max(1.5, s * 0.04), color: 0xd4a548, alpha: 0.9 });
    drawSpecialIcon(g, s, style.special);
    if (s >= 40) {
      const label = new Text({
        text: style.label,
        style: {
          fontFamily: "Atkinson Hyperlegible, Avenir Next, sans-serif",
          fontSize: Math.max(7, s * 0.15),
          fontWeight: "700",
          fill: 0xf2f0e6,
          letterSpacing: 0.5,
        },
      });
      label.anchor.set(0.5, 1);
      label.position.set(0, half - s * 0.05);
      g.addChild(label);
    }
    return;
  }
  // Soft bevel so tiles read as objects, not flat paint.
  g.roundRect(-half, -half, half * 2, half * 0.5, s * 0.14).fill({ color: 0xffffff, alpha: 0.14 });
  if (style.showMarks && style.mark) drawMark(g, s, style.mark);
}

/** Symbols for the marks setting, drawn in dark ink so they work on every tile color. */
function drawMark(g: Graphics, s: number, mark: string): void {
  const r = s * 0.14;
  const ink = { color: 0x0b1526, alpha: 0.75 };
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
  const cy = s >= 40 ? -s * 0.06 : 0;
  switch (special) {
    case "keg":
      // Bomb: ball, fuse, spark.
      g.circle(0, cy + r * 0.3, r).fill(0xf2f0e6);
      g.rect(-r * 0.3, cy - r * 0.9, r * 0.6, r * 0.5).fill(0xf2f0e6);
      g.moveTo(0, cy - r * 0.9).quadraticCurveTo(r * 0.6, cy - r * 1.5, r * 1.1, cy - r * 1.2).stroke({ width: Math.max(1.5, s * 0.04), color: 0xf2f0e6 });
      g.circle(r * 1.15, cy - r * 1.2, r * 0.3).fill(0xffb347);
      break;
    case "ink":
      // Splat: three overlapping drops.
      g.circle(-r * 0.6, cy, r * 0.7).fill(0xc084fc);
      g.circle(r * 0.5, cy - r * 0.3, r * 0.6).fill(0xc084fc);
      g.circle(0, cy + r * 0.5, r * 0.75).fill(0xc084fc);
      g.circle(r * 0.2, cy - r * 1.2, r * 0.25).fill(0xc084fc);
      break;
    case "barnacle":
      // Up chevron over ridges: it climbs.
      g.poly([0, cy - r * 1.3, r * 1.2, cy, r * 0.6, cy, 0, cy - r * 0.6, -r * 0.6, cy, -r * 1.2, cy]).fill(0xf2f0e6);
      g.rect(-r * 1.1, cy + r * 0.35, r * 2.2, r * 0.22).fill({ color: 0xf2f0e6, alpha: 0.7 });
      g.rect(-r * 0.8, cy + r * 0.8, r * 1.6, r * 0.22).fill({ color: 0xf2f0e6, alpha: 0.45 });
      break;
  }
}
