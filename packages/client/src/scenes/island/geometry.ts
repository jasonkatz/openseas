import type { Building, Island } from '@tidebound/shared';
import { rngFromSeed, rngNext } from '@tidebound/shared';

/** Axis-aligned rectangle in world px. */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

/**
 * The island's coastline: a superellipse (boxier than an ellipse so the building
 * layout fits comfortably) with seeded outward-only bumps. Everything that needs
 * to know "is this land?" goes through `landValue`, and the polygon used for
 * drawing is produced by `coastPoint`, so the two can never disagree.
 */
export interface Coast {
  cx: number; cy: number;
  rx: number;
  /** Vertical radius above / below the centre (the top margin is tighter). */
  ryTop: number; ryBottom: number;
  /** Superellipse exponent. */
  n: number;
  bumps: { k: number; amp: number; phase: number }[];
}

export function makeCoast(island: Island): Coast {
  let rng = rngFromSeed(island.seed ^ 0x5bd1e995);
  const bumps: Coast['bumps'] = [];
  const ks = [3, 5, 7, 11];
  for (const k of ks) {
    let a: number, p: number;
    [rng, a] = rngNext(rng);
    [rng, p] = rngNext(rng);
    bumps.push({ k, amp: 0.012 + a * 0.022, phase: p * Math.PI * 2 });
  }
  return { cx: island.width / 2, cy: island.height * 0.47, rx: island.width * 0.48, ryTop: 440, ryBottom: 450, n: 3, bumps };
}

/** Radius multiplier (>= 1) at geometric angle phi. Suppressed near the bottom so the harbour stays open water. */
function bumpAt(c: Coast, phi: number): number {
  let r = 1;
  for (let i = 0; i < c.bumps.length; i++) {
    const b = c.bumps[i]!;
    r += b.amp * (1 + Math.sin(b.k * phi + b.phase));
  }
  const s = Math.sin(phi);
  if (s > 0) r = 1 + (r - 1) * (1 - 0.9 * s * s);
  return r;
}

/** < 0.93 ground, 0.93..1 sand, 1..1.1 shallows, beyond: open sea. */
export function landValue(c: Coast, x: number, y: number): number {
  const dx = (x - c.cx) / c.rx;
  const dy = (y - c.cy) / (y < c.cy ? c.ryTop : c.ryBottom);
  const d = Math.pow(Math.pow(Math.abs(dx), c.n) + Math.pow(Math.abs(dy), c.n), 1 / c.n);
  return d / bumpAt(c, Math.atan2(dy, dx));
}

/** Point on the coast polygon at geometric angle phi, scaled about the centre. */
export function coastPoint(c: Coast, phi: number, scale: number, out: Pt): Pt {
  const cs = Math.cos(phi), sn = Math.sin(phi);
  const t = (bumpAt(c, phi) * scale) / Math.pow(Math.pow(Math.abs(cs), c.n) + Math.pow(Math.abs(sn), c.n), 1 / c.n);
  out.x = c.cx + t * c.rx * cs;
  out.y = c.cy + t * (sn < 0 ? c.ryTop : c.ryBottom) * sn;
  return out;
}

export function traceCoast(ctx: CanvasRenderingContext2D, c: Coast, scale: number, segments = 180): void {
  const p = { x: 0, y: 0 };
  ctx.beginPath();
  for (let i = 0; i < segments; i++) {
    coastPoint(c, (i / segments) * Math.PI * 2, scale, p);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

/** The wooden pier: a jetty down from the harbour office and a long quay the ships moor against. */
export interface Pier { jetty: Rect; quay: Rect; shipRow: { y: number; x0: number; x1: number } }

export function makePier(island: Island): Pier {
  const dock = island.buildings.find((b) => b.kind === 'dock');
  const dx = dock ? dock.door.x : island.width / 2;
  const top = dock ? dock.y + dock.h : island.height - 120;
  const quayY = island.height - 64;
  return {
    jetty: { x: dx - 18, y: top, w: 36, h: quayY - top + 12 },
    quay: { x: dx - 280, y: quayY, w: 560, h: 24 },
    shipRow: { y: island.height - 18, x0: dx - 250, x1: dx + 250 },
  };
}

export function inRect(r: Rect, x: number, y: number, pad = 0): boolean {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}

/** Cobblestone street network. Assumes the shared layout (dock at the bottom, civic buildings up the hill). */
export interface Paths { lines: Pt[][]; plaza: Pt; plazaR: number }

export function makePaths(island: Island): Paths {
  const by = new Map<string, Building>(island.buildings.map((b) => [b.kind, b]));
  const plaza = { x: island.width / 2, y: 650 };
  const lines: Pt[][] = [];
  const door = (k: string): Pt | undefined => by.get(k)?.door;
  const tavern = door('tavern'), ship = door('shipwright'), market = door('market'), bank = door('bank'), palace = door('palace'), dock = door('dock');
  const dockB = by.get('dock');
  // Waterfront walkway around the harbour office, joined to the plaza on both sides.
  if (dock && dockB) {
    const wy = dockB.y + dockB.h + 25;
    const l = dockB.x - 30, r = dockB.x + dockB.w + 30;
    lines.push([{ x: plaza.x, y: plaza.y }, { x: plaza.x, y: 740 }, { x: l, y: 740 }, { x: l, y: wy }, { x: r, y: wy }, { x: r, y: 740 }, { x: plaza.x, y: 740 }]);
  }
  if (tavern) lines.push([tavern, { x: tavern.x, y: plaza.y }, plaza]);
  if (ship) lines.push([ship, { x: ship.x, y: 740 }, { x: plaza.x, y: 740 }]);
  if (market) lines.push([market, { x: market.x, y: plaza.y }, plaza]);
  if (bank) lines.push([bank, { x: bank.x, y: 500 }, { x: 930, y: 500 }, { x: 930, y: plaza.y }, plaza]);
  if (palace) lines.push([palace, { x: palace.x, y: plaza.y }, plaza]);
  return { lines, plaza, plazaR: 70 };
}

/** Distance from a point to a polyline. */
export function distToPaths(p: Paths, x: number, y: number): number {
  let best = Math.hypot(x - p.plaza.x, y - p.plaza.y) - p.plazaR;
  for (const line of p.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const d = segDist(x, y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
  }
  return best;
}

export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : ((px - ax) * vx + (py - ay) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/** Everything the scene needs to answer "can a pirate stand here?". */
export interface Walkable { coast: Coast; pier: Pier; blockers: Rect[]; width: number; height: number }

export function makeWalkable(island: Island): Walkable {
  return {
    coast: makeCoast(island),
    pier: makePier(island),
    blockers: island.buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
    width: island.width,
    height: island.height,
  };
}

export function canStand(w: Walkable, x: number, y: number): boolean {
  if (x < 8 || y < 8 || x > w.width - 8 || y > w.height - 8) return false;
  for (let i = 0; i < w.blockers.length; i++) if (inRect(w.blockers[i]!, x, y, 6)) return false;
  if (inRect(w.pier.jetty, x, y, -4) || inRect(w.pier.quay, x, y, -4)) return true;
  return landValue(w.coast, x, y) < 0.995;
}

/** Moves `pos` by (dx, dy) with axis-separated sliding against anything that is not standable. Returns true if it moved at all. */
export function slideMove(w: Walkable, pos: Pt, dx: number, dy: number): boolean {
  let moved = false;
  if (dx !== 0 && canStand(w, pos.x + dx, pos.y)) { pos.x += dx; moved = true; }
  if (dy !== 0 && canStand(w, pos.x, pos.y + dy)) { pos.y += dy; moved = true; }
  return moved;
}
