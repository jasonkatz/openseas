import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  SALVAGE_COUPLER,
  SALVAGE_CRATE,
  createSalvageGame,
  reduceSalvage,
  salvageCanClose,
  salvageCanLink,
  salvageViewString,
  type SalvageState,
} from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.salvage.config;
const W = cfg.width;
const H = cfg.height;
const col = (cell: number): number => cell % W;
const row = (cell: number): number => Math.floor(cell / W);

const NEIGHBOURS: number[][] = Array.from({ length: W * H }, (_, cell) => {
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const c = col(cell) + dc;
      const r = row(cell) + dr;
      if ((dc !== 0 || dr !== 0) && c >= 0 && c < W && r >= 0 && r < H) out.push(r * W + c);
    }
  return out;
});

/**
 * The longest line and the longest line that can close, by a bounded depth-first search from every
 * piece. The engine's own hint stops at the first loop it finds; a picture wants the best one.
 */
function lines(s: SalvageState, cap = 99): { open: number[]; loop: number[] } {
  let open: number[] = [];
  let loop: number[] = [];
  const path: number[] = [];
  const on = new Set<number>();
  let budget = 0;
  const walk = (cell: number): void => {
    path.push(cell);
    on.add(cell);
    if (path.length > open.length) open = path.slice();
    if (path.length > loop.length && salvageCanClose(s, path)) loop = path.slice();
    if (path.length < cap)
      for (const next of NEIGHBOURS[cell]!) {
        if (budget <= 0) break;
        if (on.has(next) || !salvageCanLink(s.cells[cell]!, s.cells[next]!)) continue;
        budget--;
        walk(next);
      }
    path.pop();
    on.delete(cell);
  };
  for (let cell = 0; cell < W * H; cell++) {
    if (s.cells[cell]!.kind === SALVAGE_CRATE) continue;
    budget = 2500;
    walk(cell);
  }
  return { open, loop };
}

const deal = (seed: string): SalvageState => createSalvageGame(seed, cfg);
const cratesOf = (s: SalvageState): number[] => s.cells.flatMap((p, i) => (p.kind === SALVAGE_CRATE ? [i] : []));
const haul = (s: SalvageState, cells: readonly number[], loop = false): SalvageState => reduceSalvage(s, { type: "tether", cells, loop });
/** True when no crate has a piece of the line under it: the haul leaves every crate where it is. */
const leavesCrates = (s: SalvageState, cells: readonly number[]): boolean => cratesOf(s).every((crate) => cells.every((c) => col(c) !== col(crate) || row(c) < row(crate)));

/** The field with its strip and frame, cut out of the canvas. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "salvage");
  const pad = Math.max(4, g.cell * 0.12) + 10;
  const strip = g.cell * 0.95;
  return padded({ x: g.ox, y: g.oy - strip, width: g.cell * W, height: g.cell * H + strip }, pad, await canvasBox(page, "salvage"));
}

const centre = (g: { ox: number; oy: number; cell: number }, c: number): [number, number] => [g.ox + (col(c) + 0.5) * g.cell, g.oy + (row(c) + 0.5) * g.cell];

/** Rest the pointer beside a line's first piece, so a clip opens with the hand already there. */
async function hover(page: Page, cells: readonly number[]): Promise<void> {
  const g = await boardGeom(page, "salvage");
  const [x, y] = centre(g, cells[0]!);
  await page.mouse.move(x - g.cell * 0.3, y - g.cell * 0.3, { steps: 4 });
}

/**
 * Drag the tether through the cells, `stepMs` a piece; `close` brings it back onto the first piece.
 * Paced by the clock, not by a count of steps: on a busy machine the hand takes fewer, longer steps
 * and the drag still lasts as long as it should.
 */
async function draw(page: Page, cells: readonly number[], close = false, stepMs = 150): Promise<void> {
  const g = await boardGeom(page, "salvage");
  const points = cells.map((c) => centre(g, c));
  if (close) points.push(centre(g, cells[0]!));
  let [x, y] = points[0]!;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(Math.min(90, stepMs));
  for (const [tx, ty] of points.slice(1)) {
    const start = Date.now();
    for (;;) {
      const f = Math.min(1, (Date.now() - start + 16) / stepMs);
      await page.mouse.move(x + (tx - x) * f, y + (ty - y) * f);
      if (f >= 1) break;
    }
    [x, y] = [tx, ty];
  }
  await page.waitForTimeout(Math.min(120, stepMs));
  await page.mouse.up();
}

/** Play hauls planned in Node on the page, quickly, and check the page ends on the engine's field. */
async function replay(page: Page, seed: string, moves: ReadonlyArray<{ cells: number[]; loop: boolean }>): Promise<void> {
  let s = deal(seed);
  for (const m of moves) {
    await draw(page, m.cells, m.loop, 1);
    s = haul(s, m.cells, m.loop);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(s.moveCount));
    await settled(page, "salvage");
    expect(await boardString(page, "salvage")).toBe(salvageViewString(s.cells));
  }
}

test("salvage: the board", async ({ page }) => {
  // Two crates in the middle of the field, apart, with debris over and under each.
  const { seed } = findSeed("salvage-hero", (s) => {
    const [a, b] = cratesOf(deal(s));
    if (a === undefined || b === undefined) return null;
    const mid = (c: number): boolean => row(c) >= 1 && row(c) <= 4 && col(c) >= 1 && col(c) <= W - 2;
    return mid(a) && mid(b) && Math.abs(col(a) - col(b)) >= 2 && row(a) !== row(b) ? true : null;
  });
  await openLab(page, "salvage", { seed });
  await hidePointer(page);
  await still(page, "salvage", "board", { region: await region(page) });
});

test("salvage: a first line", async ({ page }) => {
  // The longest line on the opening is exactly five, it takes a diagonal step, and no crate moves.
  const { seed, found } = findSeed("salvage-first", (s) => {
    const g = deal(s);
    const { open } = lines(g);
    if (open.length !== 5 || !leavesCrates(g, open)) return null;
    const diagonal = open.some((c, i) => i > 0 && col(c) !== col(open[i - 1]!) && row(c) !== row(open[i - 1]!));
    return diagonal && open.every((c) => row(c) >= 2) ? open : null;
  });
  await openLab(page, "salvage", { seed });
  await hover(page, found);
  await clip(page, "salvage", "first-line", async () => {
    await draw(page, found, false, 260);
    await settled(page, "salvage");
  }, { region: await region(page) });
});

test("salvage: a long haul", async ({ page }) => {
  // One line of ten on the opening field: 100 points where three threes would be 27.
  const { seed, found } = findSeed("salvage-long", (s) => {
    const g = deal(s);
    const { open } = lines(g);
    return open.length === 10 && leavesCrates(g, open) && open.every((c) => g.cells[c]!.kind !== SALVAGE_COUPLER) ? open : null;
  });
  await openLab(page, "salvage", { seed });
  await hover(page, found);
  await clip(page, "salvage", "long-haul", async () => {
    await draw(page, found, false, 200);
    await settled(page, "salvage");
  }, { tailMs: 1100, region: await region(page) });
});

test("salvage: a net", async ({ page }) => {
  // The smallest net there is: four of a kind in a two by two block, with both opening crates adrift.
  const { seed, found } = findSeed("salvage-net", (s) => {
    const g = deal(s);
    if (cratesOf(g).length !== 2) return null;
    for (let cell = 0; cell < W * H; cell++) {
      if (col(cell) >= W - 1 || row(cell) < 2 || row(cell) >= H - 1) continue;
      const block = [cell, cell + 1, cell + W + 1, cell + W];
      const kind = g.cells[cell]!.kind;
      if (kind < cfg.kinds && block.every((c) => g.cells[c]!.kind === kind) && cratesOf(g).every((c) => row(c) >= 1 && Math.abs(col(c) - col(cell)) >= 1)) return block;
    }
    return null;
  });
  await openLab(page, "salvage", { seed });
  await hover(page, found);
  await clip(page, "salvage", "net", async () => {
    await draw(page, found, true, 300);
    await settled(page, "salvage");
  }, { tailMs: 1200, region: await region(page) });
});

test("salvage: a crate lost to the floor", async ({ page }) => {
  // A crate two rows off the floor, and a line that takes both pieces under it: the crate sinks and is taken for the floor price.
  const { seed, found } = findSeed("salvage-floor", (s) => {
    const g = deal(s);
    for (const crate of cratesOf(g)) {
      if (row(crate) !== H - 3) continue;
      const under = [crate + W, crate + 2 * W];
      const { open } = lines(g, 5);
      // Any short line through both cells under the crate.
      const path: number[] = [];
      const walk = (cell: number): number[] | null => {
        path.push(cell);
        if (path.length >= 3 && path.length <= 4 && under.every((u) => path.includes(u))) return path.slice();
        if (path.length < 4)
          for (const next of NEIGHBOURS[cell]!) {
            if (path.includes(next) || !salvageCanLink(g.cells[cell]!, g.cells[next]!)) continue;
            const hit = walk(next);
            if (hit) return hit;
          }
        path.pop();
        return null;
      };
      for (let cell = 0; cell < W * H; cell++) {
        if (g.cells[cell]!.kind >= cfg.kinds || under.includes(cell)) continue;
        path.length = 0;
        const line = walk(cell);
        if (line && open.length >= 3 && haul(g, line).lastMove!.rounds.some((r) => r.floor.length === 1)) return line;
      }
    }
    return null;
  });
  await openLab(page, "salvage", { seed });
  await hover(page, found);
  await clip(page, "salvage", "floor", async () => {
    await draw(page, found, false, 300);
    await settled(page, "salvage");
  }, { tailMs: 1200, region: await region(page) });
});

/** Longest lines, one after another, until `stop` returns something to show; the hauls made on the way and that. */
function playUntil<T>(seed: string, limit: number, stop: (s: SalvageState) => T | null): { log: { cells: number[]; loop: boolean }[]; found: T } | null {
  let s = deal(seed);
  const log: { cells: number[]; loop: boolean }[] = [];
  for (let n = 0; n <= limit; n++) {
    const found = n > 0 ? stop(s) : null;
    if (found !== null) return { log, found };
    const { open } = lines(s);
    if (open.length < cfg.streakMin) return null;
    log.push({ cells: open, loop: false });
    s = haul(s, open);
  }
  return null;
}

test("salvage: a coupler joins two kinds", async ({ page }) => {
  // A few hauls in, a coupler has drifted in and the longest line crosses it from one kind to another.
  const { seed, found } = findSeed("salvage-coupler", (s) =>
    playUntil(s, 8, (g) => {
      const { open } = lines(g);
      const at = open.findIndex((c) => g.cells[c]!.kind === SALVAGE_COUPLER);
      if (open.length < 9 || open.length > 11 || at < 3 || at > open.length - 4) return null;
      if (open.filter((c) => g.cells[c]!.kind === SALVAGE_COUPLER).length !== 1) return null;
      return g.cells[open[0]!]!.kind !== g.cells[open[open.length - 1]!]!.kind && leavesCrates(g, open) ? open : null;
    }),
  );
  await openLab(page, "salvage", { seed, seconds: 600 });
  await replay(page, seed, found.log);
  await hover(page, found.found);
  await page.waitForTimeout(500);
  await clip(page, "salvage", "coupler", async () => {
    await draw(page, found.found, false, 220);
    await settled(page, "salvage");
  }, { tailMs: 1100, region: await region(page) });
});

test("salvage: three crates netted at full streak", async ({ page }) => {
  // Long lines until the streak is at its last step and three crates are adrift, then a loop of five or more: it builds the streak and nets all three.
  const full = cfg.streakPercent.length;
  const { seed, found } = findSeed("salvage-three", (s) =>
    playUntil(s, 22, (g) => {
      if (cratesOf(g).length < cfg.maxCrates) return null;
      // Three adrift and no good loop yet: this seed is not the picture.
      const { loop } = lines(g);
      if (g.combo < full - 1 || loop.length < cfg.streakMin || loop.length > 8) return null;
      return cratesOf(g).every((c) => !loop.includes(c) && row(c) >= 1) && loop.every((c) => row(c) >= 1) ? loop : null;
    }),
  );
  await openLab(page, "salvage", { seed, seconds: 600 });
  await replay(page, seed, found.log);
  await page.waitForTimeout(500);
  await hidePointer(page);
  await still(page, "salvage", "three-adrift", { region: await region(page) });
  await hover(page, found.found);
  await clip(page, "salvage", "net-three", async () => {
    await draw(page, found.found, true, 300);
    await settled(page, "salvage");
  }, { tailMs: 1500, region: await region(page) });
});
