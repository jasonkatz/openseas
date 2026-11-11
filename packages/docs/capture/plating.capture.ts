import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  createPlatingGame,
  platingBreachIndex,
  platingCheckPlacement,
  platingEffectiveBrush,
  platingExtent,
  platingOrient,
  reducePlating,
  type Breach,
  type PlatingState,
} from "@openseas/engine";
import { canvasAttr, canvasBox, canvasOf, clip, findSeed, hidePointer, openLab, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.plating.config;
const W = cfg.width;
const H = cfg.height;
/** The tray under the hull, in cells: the renderer's own layout. */
const TRAY_ROWS = 3.1;

/** One way to lay a tray plate wholly on the hull, and what it would do. */
interface Lay {
  slot: number;
  rot: number;
  flip: boolean;
  col: number;
  row: number;
  w: number;
  h: number;
  breachId: number;
  /** Open cells of its breach it covers. */
  fresh: number;
  waste: number;
  /** Its brushing runs across once turned this way. */
  across: boolean;
}

const deal = (seed: string): PlatingState => createPlatingGame(seed, cfg);
const place = (s: PlatingState, m: Lay): PlatingState => reducePlating(s, { type: "place", slot: m.slot, rot: m.rot, flip: m.flip, col: m.col, row: m.row });
const breach = (s: PlatingState, id: number): Breach | undefined => s.breaches.find((b) => b.id === id);
const pristine = (b: Breach): boolean => !b.grown && b.waste === 0;

/** Every placement of the tray's plates that sits wholly on the hull, each footprint once. */
function lays(s: PlatingState, slots: readonly number[] = [0, 1, 2]): Lay[] {
  const breachOf = platingBreachIndex(s);
  const out: Lay[] = [];
  for (const slot of slots) {
    const piece = s.slots[slot]!;
    const seen = new Set<string>();
    for (const flip of [false, true])
      for (let rot = 0; rot < 4; rot++) {
        const cells = platingOrient(piece.shape, rot, flip);
        const across = platingEffectiveBrush(piece.brush, rot) === "h";
        const key = `${JSON.stringify(cells)}${across}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const { w, h } = platingExtent(cells);
        for (let row = 0; row + h <= H; row++)
          for (let col = 0; col + w <= W; col++) {
            const check = platingCheckPlacement(s, slot, rot, flip, col, row, breachOf);
            if (!check.legal || check.breachId === null) continue;
            const waste = check.wasteCells.length + check.overhang;
            out.push({ slot, rot, flip, col, row, w, h, breachId: check.breachId, fresh: check.cells.length - (check.wasteCells.length - (5 - check.cells.length)), waste, across });
          }
      }
  }
  return out;
}

/**
 * The ways to seal one untouched breach flawlessly with plates that are in the tray right now: a
 * list of plate sequences, each from different slots.
 */
function sureSeals(s: PlatingState, id: number, slots: readonly number[] = [0, 1, 2]): Lay[][] {
  const out: Lay[][] = [];
  for (const m of lays(s, slots)) {
    if (m.breachId !== id || m.waste !== 0) continue;
    const next = place(s, m);
    const sealed = next.lastMove!.sealed;
    if (sealed) {
      if (sealed.rating === "flawless") out.push([m]);
      continue;
    }
    for (const rest of sureSeals(next, id, slots.filter((x) => x !== m.slot))) out.push([m, ...rest]);
  }
  return out;
}

// ---- driving the page

interface Geom {
  ox: number;
  oy: number;
  cell: number;
}

/** Where the hull's grid sits on the page, from the `data-geometry` the canvas publishes. */
async function geom(page: Page): Promise<Geom> {
  const known = geoms.get(page);
  if (known) return known;
  const canvas = canvasOf(page, "plating");
  await expect(canvas).toHaveAttribute("data-geometry", /^-?\d+,-?\d+,[\d.]+$/);
  const [gx, gy, cell] = (await canvasAttr(page, "plating", "data-geometry")).split(",").map(Number) as [number, number, number];
  const box = await canvasBox(page, "plating");
  const g = { ox: box.x + gx, oy: box.y + gy, cell };
  geoms.set(page, g);
  return g;
}

/** A page's board does not move once it is drawn, so its place is read once. */
const geoms = new WeakMap<Page, Geom>();

/** The hull and the tray under it, without the canvas's empty margins. */
async function region(page: Page): Promise<Box> {
  const g = await geom(page);
  const box = await canvasBox(page, "plating");
  const pad = 10;
  const y = Math.max(box.y, g.oy - pad);
  const bottom = Math.min(box.y + box.height, g.oy + g.cell * (H + TRAY_ROWS) + pad);
  return { x: g.ox - pad, y, width: g.cell * W + pad * 2, height: bottom - y };
}

/** The engine's board as the page publishes it. */
function boardOf(s: PlatingState): string {
  const open = platingBreachIndex(s);
  return s.covered.map((n, c) => (n > 0 ? String(n) : open.has(c) ? "h" : ".")).join("");
}

/**
 * Move the pointer there over `ms` of real time. Each step waits for the page, so the steps are as
 * many as the machine has time for: smooth when it is idle, fewer when it is busy, never slower.
 */
async function sweep(page: Page, from: readonly [number, number], to: readonly [number, number], ms: number): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    const e = 1 - (1 - k) ** 2;
    await page.mouse.move(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
    if (k >= 1) return;
  }
}

/** Where the pointer was left, so the next plate's travel starts there. */
let hand: [number, number] = [640, 430];

/** Take a plate from the tray, carry it over its spot and turn it there, as a mouse player does. The ghost is left showing. */
async function aim(page: Page, m: Lay): Promise<void> {
  const g = await geom(page);
  const canvas = canvasOf(page, "plating");
  // The tray's three slots split the hull's width.
  const slotW = (g.cell * W * 0.96) / 3;
  const sx = g.ox + m.slot * (slotW + g.cell * W * 0.02) + slotW / 2;
  const sy = g.oy + g.cell * (H + 0.3) + (g.cell * (TRAY_ROWS - 0.3)) / 2;
  await sweep(page, hand, [sx, sy], 380);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await expect(canvas).toHaveAttribute("data-orient", `${m.slot},0,0`);
  const x = g.ox + (m.col + m.w / 2) * g.cell;
  const y = g.oy + (m.row + m.h / 2) * g.cell;
  await sweep(page, [sx, sy], [x, y + 1], 560);
  hand = [x, y];
  // F flips, a right click turns a quarter.
  if (m.flip) {
    await page.waitForTimeout(160);
    await page.keyboard.press("f");
    await page.waitForTimeout(320);
  }
  for (let i = 0; i < m.rot; i++) {
    await page.waitForTimeout(220);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
  }
  await expect(canvas).toHaveAttribute("data-orient", `${m.slot},${m.rot},${m.flip ? 1 : 0}`);
  await page.waitForTimeout(160);
  await page.mouse.move(x, y, { steps: 2 });
  await expect(canvas).toHaveAttribute("data-ghost", `${m.col},${m.row},${m.w},${m.h}`);
}

/** Aim a plate and weld it down; `after` is the engine's state once it lands. */
async function weld(page: Page, m: Lay, after: PlatingState): Promise<void> {
  await aim(page, m);
  await page.waitForTimeout(260);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await expect(page.getByTestId("plating-board")).toHaveAttribute("data-board", boardOf(after));
  await settled(page, "plating");
}

/** Play a line of plates from a dealt seed, on the page and in Node together. */
async function play(page: Page, start: PlatingState, line: readonly Lay[]): Promise<PlatingState> {
  let s = start;
  for (const m of line) {
    s = place(s, m);
    await weld(page, m, s);
  }
  return s;
}

// ---- the pictures

test("plating: the board", async ({ page }) => {
  // One breach of each size, and three different plates in the tray.
  const { seed } = findSeed("plate-hero", (seed) => {
    const s = deal(seed);
    const sizes = s.breaches.map((b) => b.cells.length).sort((a, b) => a - b);
    return sizes.join() === "5,10,15" && new Set(s.slots.map((p) => p.shape)).size === 3 ? true : null;
  });
  await openLab(page, "plating", { seed });
  await hidePointer(page);
  await still(page, "plating", "board", { region: await region(page) });
});

test("plating: a first plate", async ({ page }) => {
  // A one-plate breach whose plate is in the tray and needs a single quarter turn.
  const { seed, found } = findSeed("plate-first", (seed) => {
    const s = deal(seed);
    const m = lays(s).find((m) => m.waste === 0 && m.rot === 1 && !m.flip && breach(s, m.breachId)!.cells.length === 5);
    return m ?? null;
  });
  const s = deal(seed);
  await openLab(page, "plating", { seed });
  await clip(page, "plating", "first-plate", async () => {
    await play(page, s, [found]);
  }, { tailMs: 1500, region: await region(page) });
});

test("plating: waste", async ({ page }) => {
  // A plate held half over a breach and half over sound hull: three cells in, two wasted.
  const { seed, found } = findSeed("plate-waste", (seed) => {
    const s = deal(seed);
    return lays(s).find((m) => m.fresh === 3 && m.waste === 2 && m.rot === 0 && !m.flip && m.row >= 2 && m.row + m.h <= H - 2) ?? null;
  });
  await openLab(page, "plating", { seed });
  await aim(page, found);
  await hidePointer(page);
  await page.waitForTimeout(300);
  await still(page, "plating", "waste", { region: await region(page) });
});

test("plating: solid work, brushed true", async ({ page }) => {
  // A one-plate breach nothing in the tray fits. Two plates laid across cover it: one plate over,
  // so Solid work, and both brushed across, so the bonus.
  const { seed, found } = findSeed("plate-solid", (seed) => {
    const s = deal(seed);
    for (const b of s.breaches) {
      if (b.cells.length !== 5) continue;
      const on = lays(s).filter((m) => m.breachId === b.id);
      if (on.some((m) => m.waste === 0)) continue;
      for (const first of on) {
        if (!first.across || first.fresh < 3) continue;
        const mid = place(s, first);
        const second = lays(mid, [0, 1, 2].filter((x) => x !== first.slot)).find((m) => {
          if (m.breachId !== b.id || !m.across) return false;
          const sealed = place(mid, m).lastMove!.sealed;
          return sealed !== null && sealed.rating === "solid" && sealed.brushBonus;
        });
        if (second) return [first, second];
      }
    }
    return null;
  });
  const s = deal(seed);
  await openLab(page, "plating", { seed });
  await clip(page, "plating", "solid-brushed", async () => {
    await play(page, s, found);
  }, { tailMs: 1500, region: await region(page) });
});

test("plating: a flawless from the tray", async ({ page }) => {
  // A two-plate breach that two plates already in the tray fill exactly.
  const { seed, found } = findSeed("plate-pair", (seed) => {
    const s = deal(seed);
    for (const b of s.breaches) {
      if (b.cells.length !== 10) continue;
      const line = sureSeals(s, b.id).find((line) => {
        let t = s;
        for (const m of line) t = place(t, m);
        return !t.lastMove!.sealed!.brushBonus && line.some((m) => m.rot > 0);
      });
      if (line) return line;
    }
    return null;
  });
  const s = deal(seed);
  await openLab(page, "plating", { seed });
  await clip(page, "plating", "pair", async () => {
    await play(page, s, found);
  }, { tailMs: 1500, region: await region(page) });
});

test("plating: three flawless in a row", async ({ page }) => {
  // Three breaches sealed flawlessly back to back, each from plates in the tray when it was begun.
  // The first two are played before the clip; the clip is the third, a two-plate breach or smaller.
  const { seed, found } = findSeed("plate-streak", (seed) => {
    const run = (s: PlatingState, done: Lay[][]): Lay[][] | null => {
      if (done.length === 3) return done;
      for (const b of s.breaches) {
        if (!pristine(b) || b.pieces > 0) continue;
        if (done.length === 2 && b.cells.length > 10) continue;
        for (const line of sureSeals(s, b.id)) {
          let t = s;
          for (const m of line) t = place(t, m);
          const all = run(t, [...done, line]);
          if (all) return all;
        }
      }
      return null;
    };
    const lines = run(deal(seed), []);
    return lines && lines.flat().length <= 6 ? lines : null;
  }, 6000);
  let s = deal(seed);
  await openLab(page, "plating", { seed });
  s = await play(page, s, [...found[0]!, ...found[1]!]);
  await page.waitForTimeout(700);
  await clip(page, "plating", "streak", async () => {
    await play(page, s, found[2]!);
  }, { tailMs: 1700, region: await region(page) });
});

test("plating: a breach widens", async ({ page }) => {
  // One breach is left alone while plates go elsewhere. The clip is the plate that widens it.
  const { seed, found } = findSeed("plate-widen", (seed) => {
    let s = deal(seed);
    const target = s.breaches.find((b) => b.cells.length === 10);
    if (!target) return null;
    const line: Lay[] = [];
    for (let n = 0; n < cfg.growAfterMoves; n++) {
      const options = lays(s).filter((m) => m.breachId !== target.id);
      if (options.length === 0) return null;
      const m = options.reduce((best, o) => (o.fresh * 10 - o.waste > best.fresh * 10 - best.waste ? o : best));
      s = place(s, m);
      line.push(m);
      const grown = s.lastMove!.grown;
      if (n < cfg.growAfterMoves - 1 && grown) return null;
      if (n === cfg.growAfterMoves - 1) return grown?.breachId === target.id && !s.lastMove!.sealed ? line : null;
    }
    return null;
  });
  let s = deal(seed);
  await openLab(page, "plating", { seed });
  s = await play(page, s, found.slice(0, -1));
  await page.waitForTimeout(700);
  await clip(page, "plating", "widen", async () => {
    await play(page, s, found.slice(-1));
  }, { leadMs: 1400, tailMs: 1700, region: await region(page) });
});
