/** Axial hex coordinates, pointy-top orientation. */
export interface Hex { q: number; r: number }

/** Six headings: 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE (counter-clockwise). */
export const HEX_DIRS: readonly Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export const HEADING_NAMES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'] as const;

export function hexEq(a: Hex, b: Hex): boolean { return a.q === b.q && a.r === b.r; }
export function hexKey(h: Hex): string { return `${h.q},${h.r}`; }
export function hexAdd(a: Hex, b: Hex): Hex { return { q: a.q + b.q, r: a.r + b.r }; }
export function hexNeighbor(h: Hex, dir: number): Hex { return hexAdd(h, HEX_DIRS[((dir % 6) + 6) % 6] as Hex); }
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export function turnLeft(h: number): number { return (h + 1) % 6; }
export function turnRight(h: number): number { return (h + 5) % 6; }

export function hexNeighbors(h: Hex): Hex[] { return HEX_DIRS.map((d) => hexAdd(h, d)); }

/** Pixel centre for a pointy-top hex of given size. */
export function hexToPixel(h: Hex, size: number): { x: number; y: number } {
  return { x: size * (Math.sqrt(3) * h.q + (Math.sqrt(3) / 2) * h.r), y: size * 1.5 * h.r };
}

export function pixelToHex(x: number, y: number, size: number): Hex {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

export function hexRound(qf: number, rf: number): Hex {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** Linear interpolation path between two hexes (inclusive of both ends). */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [a];
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const q = a.q + (b.q - a.q) * t + 1e-6;
    const r = a.r + (b.r - a.r) * t + 1e-6;
    out.push(hexRound(q, r));
  }
  return out;
}

/** All hexes within radius n of centre. */
export function hexRange(c: Hex, n: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -n; q <= n; q++) {
    for (let r = Math.max(-n, -q - n); r <= Math.min(n, -q + n); r++) out.push({ q: c.q + q, r: c.r + r });
  }
  return out;
}

/**
 * Breadth-first path on a hex grid avoiding blocked cells. Returns the list of
 * hexes from start (exclusive) to goal (inclusive), or null if unreachable.
 */
export function hexPath(start: Hex, goal: Hex, blocked: (h: Hex) => boolean, maxNodes = 20000): Hex[] | null {
  if (hexEq(start, goal)) return [];
  const came = new Map<string, string | null>();
  const nodes = new Map<string, Hex>();
  const sk = hexKey(start);
  came.set(sk, null);
  nodes.set(sk, start);
  const queue: Hex[] = [start];
  let qi = 0;
  while (qi < queue.length && came.size < maxNodes) {
    const cur = queue[qi++] as Hex;
    for (const nb of hexNeighbors(cur)) {
      const k = hexKey(nb);
      if (came.has(k)) continue;
      if (!hexEq(nb, goal) && blocked(nb)) continue;
      came.set(k, hexKey(cur));
      nodes.set(k, nb);
      if (hexEq(nb, goal)) {
        const path: Hex[] = [];
        let c: string | null = k;
        while (c && c !== sk) { path.push(nodes.get(c) as Hex); c = came.get(c) ?? null; }
        return path.reverse();
      }
      queue.push(nb);
    }
  }
  return null;
}
