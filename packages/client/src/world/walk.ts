/**
 * Walking (ADR 0032): a grid over a place's ground saying where a pirate may stand, a shortest
 * path across it, and a walker that follows one. The outpost and the deck each build a grid from
 * what they put down; every client builds the same one, so a walk target sent by one pirate is
 * walked the same way on everyone's screen. Cosmetic only: nothing here decides anything.
 */

export interface Spot {
  x: number;
  z: number;
}

/** A blocked circle or an oriented box in the grid's frame. */
export type Obstacle = { kind: "circle"; x: number; z: number; r: number } | { kind: "box"; x: number; z: number; hw: number; hd: number; angle: number };

const SQRT2 = Math.SQRT2;

export class WalkGrid {
  readonly cols: number;
  readonly rows: number;
  readonly open: Uint8Array;

  constructor(
    readonly x0: number,
    readonly z0: number,
    x1: number,
    z1: number,
    readonly cell: number,
  ) {
    this.cols = Math.ceil((x1 - x0) / cell);
    this.rows = Math.ceil((z1 - z0) / cell);
    this.open = new Uint8Array(this.cols * this.rows);
  }

  /** Open every cell whose center passes `test`. */
  fill(test: (x: number, z: number) => boolean): this {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (test(this.cx(c), this.cz(r))) this.open[r * this.cols + c] = 1;
    return this;
  }

  /** Close the cells an obstacle covers, grown by `pad` so a walker's body clears it. */
  block(o: Obstacle, pad: number): this {
    const reach = o.kind === "circle" ? o.r + pad : Math.hypot(o.hw, o.hd) + pad;
    const c0 = Math.max(0, Math.floor((o.x - reach - this.x0) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.ceil((o.x + reach - this.x0) / this.cell));
    const r0 = Math.max(0, Math.floor((o.z - reach - this.z0) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.ceil((o.z + reach - this.z0) / this.cell));
    const cos = o.kind === "box" ? Math.cos(o.angle) : 1;
    const sin = o.kind === "box" ? Math.sin(o.angle) : 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = this.cx(c) - o.x;
        const dz = this.cz(r) - o.z;
        let inside: boolean;
        if (o.kind === "circle") inside = dx * dx + dz * dz <= (o.r + pad) ** 2;
        else {
          // Into the box's own frame: its angle turns local x toward world z.
          const lx = dx * cos + dz * sin;
          const lz = -dx * sin + dz * cos;
          inside = Math.abs(lx) <= o.hw + pad && Math.abs(lz) <= o.hd + pad;
        }
        if (inside) this.open[r * this.cols + c] = 0;
      }
    }
    return this;
  }

  isOpen(x: number, z: number): boolean {
    const i = this.index(x, z);
    return i >= 0 && this.open[i] === 1;
  }

  /** The open cell nearest a spot, within `maxDist`, or null. */
  nearestOpen(x: number, z: number, maxDist: number): Spot | null {
    if (this.isOpen(x, z)) return { x, z };
    const c = Math.floor((x - this.x0) / this.cell);
    const r = Math.floor((z - this.z0) / this.cell);
    const rings = Math.ceil(maxDist / this.cell);
    let best: Spot | null = null;
    let bestD = Infinity;
    for (let ring = 1; ring <= rings; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows || !this.open[rr * this.cols + cc]) continue;
          const px = this.cx(cc);
          const pz = this.cz(rr);
          const d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x: px, z: pz };
          }
        }
      }
      // A ring further out can still hold a nearer cell on its diagonal; one more ring settles it.
      if (best && ring * this.cell > Math.sqrt(bestD) + this.cell) break;
    }
    return best && Math.sqrt(bestD) <= maxDist ? best : null;
  }

  /**
   * The shortest walk from `a` to `b` over open cells (A*, eight ways, no cutting a blocked
   * corner), pulled taut so it runs straight wherever the way is clear. The last point is `b`
   * itself. Null when `b` cannot be reached.
   */
  path(a: Spot, b: Spot): Spot[] | null {
    const start = this.nearestOpen(a.x, a.z, this.cell * 6);
    const goal = this.nearestOpen(b.x, b.z, this.cell * 3);
    if (!start || !goal) return null;
    if (this.clear(start, goal)) return [goal];
    const n = this.cols * this.rows;
    const si = this.index(start.x, start.z);
    const gi = this.index(goal.x, goal.z);
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const gc = gi % this.cols;
    const gr = Math.floor(gi / this.cols);
    const h = (i: number): number => {
      const dc = Math.abs((i % this.cols) - gc);
      const dr = Math.abs(Math.floor(i / this.cols) - gr);
      return Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr);
    };
    g[si] = 0;
    heap.push(si, h(si));
    let found = false;
    while (heap.size) {
      const i = heap.pop();
      if (i === gi) {
        found = true;
        break;
      }
      if (closed[i]) continue;
      closed[i] = 1;
      const c = i % this.cols;
      const r = Math.floor(i / this.cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows) continue;
          const j = rr * this.cols + cc;
          if (!this.open[j] || closed[j]) continue;
          if (dr && dc && (!this.open[r * this.cols + cc] || !this.open[rr * this.cols + c])) continue;
          const cost = g[i]! + (dr && dc ? SQRT2 : 1);
          if (cost < g[j]!) {
            g[j] = cost;
            from[j] = i;
            heap.push(j, cost + h(j));
          }
        }
      }
    }
    if (!found) return null;
    const cells: Spot[] = [];
    for (let i = gi; i !== -1; i = from[i]!) cells.push({ x: this.cx(i % this.cols), z: this.cz(Math.floor(i / this.cols)) });
    cells.reverse();
    cells[0] = start;
    cells[cells.length - 1] = goal;
    // Pull the string: from each kept point, skip ahead to the furthest point still in plain sight.
    const out: Spot[] = [];
    let at = 0;
    while (at < cells.length - 1) {
      let next = at + 1;
      for (let k = cells.length - 1; k > next; k--) {
        if (this.clear(cells[at]!, cells[k]!)) {
          next = k;
          break;
        }
      }
      out.push(cells[next]!);
      at = next;
    }
    return out;
  }

  /** Whether the straight line between two spots stays on open ground. */
  clear(a: Spot, b: Spot): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.4)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.isOpen(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  private cx(c: number): number {
    return this.x0 + (c + 0.5) * this.cell;
  }
  private cz(r: number): number {
    return this.z0 + (r + 0.5) * this.cell;
  }
  private index(x: number, z: number): number {
    const c = Math.floor((x - this.x0) / this.cell);
    const r = Math.floor((z - this.z0) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }
}

class MinHeap {
  private readonly ids: number[] = [];
  private readonly keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.ids.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}

/** A pirate's feet on a grid: where they stand, which way they face, and the path they are on. */
export class Walker {
  x: number;
  z: number;
  /** The way they face, as an angle in the grid's x-z plane (0 faces +x). */
  heading: number;
  private path: Spot[] = [];
  private speed = 0;
  private arrive: (() => void) | null = null;
  /** The walk's end, once one is set; the heading to turn to on arrival, if any. */
  goal: Spot | null = null;
  private faceOnArrival: number | null = null;

  constructor(
    at: Spot,
    heading = 0,
    /** Ground covered a second at an easy walk. */
    readonly pace: number,
    /** The longest any walk may take, in seconds: a long one is hurried so the place never drags. */
    readonly maxSeconds: number,
  ) {
    this.x = at.x;
    this.z = at.z;
    this.heading = heading;
  }

  get moving(): boolean {
    return this.path.length > 0;
  }

  /** Stand somewhere at once, dropping any walk. */
  place(at: Spot, heading?: number): void {
    this.x = at.x;
    this.z = at.z;
    if (heading !== undefined) this.heading = heading;
    this.path = [];
    this.goal = null;
    this.arrive = null;
  }

  /**
   * Walk to `to` across `grid`. Returns false when there is no way there; the walker then stays
   * put. `face` turns them on arrival (toward a counter, a vent); `arrive` runs once they are there.
   */
  walkTo(grid: WalkGrid, to: Spot, opts: { face?: number; arrive?: () => void } = {}): boolean {
    const path = grid.path({ x: this.x, z: this.z }, to);
    if (!path) return false;
    // The path ends on the nearest open cell; finish on the spot asked for when it is open too.
    if (grid.isOpen(to.x, to.z)) path[path.length - 1] = { x: to.x, z: to.z };
    let length = 0;
    let px = this.x;
    let pz = this.z;
    for (const p of path) {
      length += Math.hypot(p.x - px, p.z - pz);
      px = p.x;
      pz = p.z;
    }
    this.path = length < 1e-4 ? [] : path;
    this.speed = Math.max(this.pace, length / this.maxSeconds);
    this.goal = path[path.length - 1]!;
    this.faceOnArrival = opts.face ?? null;
    this.arrive = opts.arrive ?? null;
    if (!this.path.length) this.finish();
    return true;
  }

  /**
   * Walk straight through `spots`, off the grid: through a doorway, where the grid is shut. Slower
   * than a walk, as a pirate slows to step over a threshold.
   */
  stepThrough(spots: Spot[], opts: { face?: number; arrive?: () => void } = {}): void {
    this.path = spots.map((p) => ({ x: p.x, z: p.z }));
    this.speed = this.pace * 0.6;
    this.goal = spots[spots.length - 1] ?? null;
    this.faceOnArrival = opts.face ?? null;
    this.arrive = opts.arrive ?? null;
    if (!this.path.length) this.finish();
  }

  /** Step along the path. Returns how fast the walker is going now, 0 when standing. */
  update(dt: number): number {
    if (!this.path.length) {
      if (this.faceOnArrival !== null) this.heading = turnToward(this.heading, this.faceOnArrival, dt * 8);
      return 0;
    }
    let budget = this.speed * dt;
    while (budget > 0 && this.path.length) {
      const p = this.path[0]!;
      const dx = p.x - this.x;
      const dz = p.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) this.heading = turnToward(this.heading, Math.atan2(dz, dx), dt * 14);
      if (d <= budget) {
        this.x = p.x;
        this.z = p.z;
        budget -= d;
        this.path.shift();
      } else {
        this.x += (dx / d) * budget;
        this.z += (dz / d) * budget;
        budget = 0;
      }
    }
    if (!this.path.length) this.finish();
    return this.speed;
  }

  private finish(): void {
    const arrive = this.arrive;
    this.arrive = null;
    arrive?.();
  }
}

/** Turn from one angle toward another by at most `step`, the short way round. */
export function turnToward(from: number, to: number, step: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= step) return to;
  return from + Math.sign(d) * step;
}
