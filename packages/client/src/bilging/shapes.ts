import { Graphics } from "pixi.js";

/**
 * Every ordinary kind has its own silhouette, so the board reads without color (CLAUDE.md rule 6).
 * Specials have silhouettes nothing else uses. Shapes are drawn centered at (0,0) for a cell of
 * size `s`.
 */
export function drawShape(g: Graphics, shape: string, s: number, color: number): void {
  const r = s * 0.36;
  g.clear();
  switch (shape) {
    case "circle":
      g.circle(0, 0, r).fill(color);
      g.circle(-r * 0.3, -r * 0.3, r * 0.22).fill({ color: 0xffffff, alpha: 0.35 });
      break;
    case "square":
      g.roundRect(-r, -r, r * 2, r * 2, r * 0.2).fill(color);
      g.rect(-r * 0.75, -r * 0.1, r * 1.5, r * 0.12).fill({ color: 0x000000, alpha: 0.18 });
      g.rect(-r * 0.75, r * 0.35, r * 1.5, r * 0.12).fill({ color: 0x000000, alpha: 0.18 });
      break;
    case "triangle":
      g.poly([0, -r * 1.05, r * 1.05, r * 0.75, -r * 1.05, r * 0.75]).fill(color);
      break;
    case "diamond":
      g.poly([0, -r * 1.15, r * 0.85, 0, 0, r * 1.15, -r * 0.85, 0]).fill(color);
      g.poly([0, -r * 1.15, r * 0.85, 0, 0, -r * 0.1]).fill({ color: 0xffffff, alpha: 0.25 });
      break;
    case "hexagon":
      g.regularPoly(0, 0, r * 1.05, 6, Math.PI / 6).fill(color);
      break;
    case "star":
      g.star(0, 0, 5, r * 1.15, r * 0.55, -Math.PI / 2).fill(color);
      break;
    case "gear": {
      // A cog: toothed ring with a hole.
      const teeth = 8;
      const pts: number[] = [];
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rad = i % 2 === 0 ? r * 1.15 : r * 0.85;
        pts.push(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      g.poly(pts).fill(color);
      g.circle(0, 0, r * 0.35).cut();
      break;
    }
    case "keg":
      // Powder keg: a barrel with brass bands and a fuse.
      g.roundRect(-r * 0.8, -r * 0.9, r * 1.6, r * 1.8, r * 0.35).fill(color);
      g.rect(-r * 0.8, -r * 0.45, r * 1.6, r * 0.14).fill(0xd4a548);
      g.rect(-r * 0.8, r * 0.3, r * 1.6, r * 0.14).fill(0xd4a548);
      g.moveTo(0, -r * 0.9).quadraticCurveTo(r * 0.5, -r * 1.4, r * 0.9, -r * 1.1).stroke({ width: Math.max(2, s * 0.05), color: 0xf2f0e6 });
      g.circle(r * 0.9, -r * 1.1, r * 0.2).fill(0xf0604d);
      break;
    case "ink":
      // Ink cloud: a lumpy blob with a lighter core.
      g.circle(-r * 0.4, -r * 0.2, r * 0.75).fill(color);
      g.circle(r * 0.45, -r * 0.3, r * 0.65).fill(color);
      g.circle(0, r * 0.4, r * 0.8).fill(color);
      g.circle(r * 0.1, 0, r * 0.3).fill({ color: 0xc084fc, alpha: 0.5 });
      break;
    case "barnacle":
      // Barnacle: a cluster of cones.
      g.poly([-r, r * 0.9, -r * 0.5, -r * 0.4, 0, r * 0.9]).fill(color);
      g.poly([-r * 0.2, r * 0.9, r * 0.35, -r * 0.95, r * 0.9, r * 0.9]).fill(color);
      g.poly([0.1 * r, r * 0.9, r * 0.6, 0, r * 1.05, r * 0.9]).fill(color);
      g.rect(-r, r * 0.85, r * 2.05, r * 0.15).fill(0x4b5563);
      break;
    default:
      g.rect(-r, -r, r * 2, r * 2).fill(color);
  }
}
