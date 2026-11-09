/**
 * An AI pirate's hand. A scripted policy: every drop the pair can make is played out on a copy of
 * the board with the same rules the fight uses, and scored by what it broke, the slabs it left,
 * blocks of a color kept together, and how high the columns stand. Breakers are not wasted on
 * scraps while the board is low. The tier's `skill` is how often the best drop found is the one
 * made; the rest of the time it is one of the next best. Every roll comes from the fight's PRNG,
 * so an AI pirate replays exactly (ADR 0003).
 */

import { nextInt, type PrngState } from "../prng.js";
import { applyDrop, colHeight, colOf, entryBlocked, legalDrops, rowOf, spawnCol } from "./reduce.js";
import type { SwordBoard, SwordCell, SwordRotation, SwordfightConfig } from "./types.js";

/** How many of the best drops a less skilled pirate picks among. */
const TOP_N = 3;

const SCRATCH: PrngState = { a: 1, b: 2, c: 3, d: 4 };

export interface AiDrop {
  readonly col: number;
  readonly rot: SwordRotation;
}

function evaluate(cfg: SwordfightConfig, before: SwordBoard, after: ReadonlyArray<SwordCell | null>, slabs: ReadonlyArray<{ w: number; h: number }>, points: number, chain: number): number {
  let v = points * 4 + chain * chain * 30;
  let maxBefore = 0;
  for (let c = 0; c < cfg.width; c++) maxBefore = Math.max(maxBefore, colHeight(cfg, before.cells, c));
  const low = maxBefore < cfg.height / 2;
  // A small break while there is room is a breaker spent for nothing; a break when crowded is relief.
  if (points > 0 && low && points < cfg.cellPoints * 4) v -= 90;
  if (points > 0 && maxBefore >= cfg.height - 4) v += 160;
  if (entryBlocked(cfg, after)) v -= 100_000;
  for (let c = 0; c < cfg.width; c++) {
    const h = colHeight(cfg, after, c);
    v -= h * h * 3;
    if (c === spawnCol(cfg)) v -= h * h * 4;
    if (h >= cfg.height - 1) v -= 400;
  }
  for (const s of slabs) {
    const n = s.w * s.h;
    v += n * n * 3;
  }
  // Blocks of a color side by side or stacked are a slab or a break in the making.
  for (let i = 0; i < after.length; i++) {
    const c = after[i];
    if (!c || c.kind === "scrap") continue;
    const col = colOf(cfg, i);
    const row = rowOf(cfg, i);
    if (col + 1 < cfg.width) {
      const r = after[i + 1];
      if (r && r.kind !== "scrap" && r.color === c.color) v += c.kind === "block" && r.kind === "block" ? 10 : 4;
    }
    if (row + 1 < cfg.height) {
      const u = after[i + cfg.width];
      if (u && u.kind !== "scrap" && u.color === c.color) v += c.kind === "block" && u.kind === "block" ? 10 : 4;
    }
  }
  return v;
}

/** Pick the AI's drop for the pair in hand, or null when it has nowhere to put it. Spends only the PRNG it returns. */
export function chooseAiDrop(cfg: SwordfightConfig, board: SwordBoard, rng: PrngState): { drop: AiDrop | null; rng: PrngState } {
  const drops = legalDrops(cfg, board);
  if (drops.length === 0) return { drop: null, rng };
  const scored = drops.map((d) => {
    const r = applyDrop(cfg, board, 0, d.col, d.rot, 0, SCRATCH, 1, 1);
    return { drop: d, score: evaluate(cfg, board, r.cells, r.slabs, r.points, r.chain) };
  });
  scored.sort((p, q) => q.score - p.score || p.drop.rot - q.drop.rot || p.drop.col - q.drop.col);
  const skill = board.ai?.skill ?? 100;
  let r = nextInt(rng, 100);
  rng = r.state;
  let pick = scored[0]!;
  if (r.value >= skill && scored.length > 1) {
    r = nextInt(rng, Math.min(TOP_N, scored.length));
    rng = r.state;
    pick = scored[r.value]!;
  }
  return { drop: pick.drop, rng };
}
