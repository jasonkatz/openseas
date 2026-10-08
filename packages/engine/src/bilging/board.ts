import { isSpecial, type BilgingConfig, type Piece } from "./types.js";

export const idx = (cfg: BilgingConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: BilgingConfig, i: number): number => i % cfg.width;
export const rowOf = (cfg: BilgingConfig, i: number): number => Math.floor(i / cfg.width);

/**
 * Find every run of 3+ ordinary pieces of the same kind, horizontally or vertically.
 * Returns the set of matched cell indices grouped into connected components (an L or a cross made
 * of two intersecting runs counts as one group, which is what makes big shapes worth more).
 */
export function findMatches(cfg: BilgingConfig, cells: ReadonlyArray<Piece | null>): number[][] {
  const { width, height } = cfg;
  const matched = new Uint8Array(cells.length);
  const kindAt = (c: number, r: number): number => {
    const p = cells[idx(cfg, c, r)];
    return p === null || p === undefined || isSpecial(p.kind) ? -1 : p.kind;
  };

  for (let r = 0; r < height; r++) {
    let start = 0;
    for (let c = 1; c <= width; c++) {
      if (c === width || kindAt(c, r) !== kindAt(start, r)) {
        if (c - start >= 3 && kindAt(start, r) >= 0) {
          for (let k = start; k < c; k++) matched[idx(cfg, k, r)] = 1;
        }
        start = c;
      }
    }
  }
  for (let c = 0; c < width; c++) {
    let start = 0;
    for (let r = 1; r <= height; r++) {
      if (r === height || kindAt(c, r) !== kindAt(c, start)) {
        if (r - start >= 3 && kindAt(c, start) >= 0) {
          for (let k = start; k < r; k++) matched[idx(cfg, c, k)] = 1;
        }
        start = r;
      }
    }
  }

  // Group matched cells into connected components of the same kind.
  const groups: number[][] = [];
  const seen = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    if (!matched[i] || seen[i]) continue;
    const kind = cells[i]!.kind;
    const group: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      group.push(cur);
      const c = colOf(cfg, cur);
      const r = rowOf(cfg, cur);
      const neighbors = [
        c > 0 ? cur - 1 : -1,
        c < width - 1 ? cur + 1 : -1,
        r > 0 ? cur - width : -1,
        r < height - 1 ? cur + width : -1,
      ];
      for (const n of neighbors) {
        if (n < 0 || seen[n] || !matched[n]) continue;
        if (cells[n]!.kind !== kind) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    group.sort((a, b) => a - b);
    groups.push(group);
  }
  groups.sort((a, b) => a[0]! - b[0]!);
  return groups;
}

/** Points for clearing a connected group of n pieces: 3 gives 3, 4 gives 8, 5 gives 15, 6 gives 24. */
export function groupPoints(n: number): number {
  return Math.max(0, n * (n - 2));
}
