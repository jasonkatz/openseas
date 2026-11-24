import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  ASSEMBLY_CABLE,
  ASSEMBLY_CORE,
  ASSEMBLY_GIRDER,
  ASSEMBLY_STRUT,
  assemblyLegalFits,
  assemblyLegalSwaps,
  assemblyTrayString,
  assemblyViewString,
  assemblyWayBetween,
  createAssemblyGame,
  reduceAssembly,
  type AssemblyMove,
  type AssemblyState,
} from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, dragThrough, findSeed, hidePointer, openLab, padded, settled, still, tapAt, type Box } from "./lib.js";

const cfg = loadContent().puzzles.assembly.config;
const W = cfg.width;
const H = cfg.height;
const col = (cell: number): number => cell % W;
const row = (cell: number): number => Math.floor(cell / W);

const deal = (seed: string): AssemblyState => createAssemblyGame(seed, cfg);
const play = (s: AssemblyState, m: AssemblyMove): AssemblyState => reduceAssembly(s, m);
const shown = (s: AssemblyState): string => `${assemblyViewString(s.cells)}/${assemblyTrayString(s.tray)}`;
const ready = (s: AssemblyState): number => new Set(assemblyLegalFits(s).map((f) => f.slot)).size;

/** The bay with its strip and the tray, cut out of the canvas. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "assembly");
  const pad = Math.max(4, g.cell * 0.12) + 10;
  const strip = g.cell * 0.8;
  return padded({ x: g.ox, y: g.oy - strip, width: g.cell * W, height: g.cell * (H + 0.35 + 3.1) + strip }, pad, await canvasBox(page, "assembly"));
}

const centre = (g: { ox: number; oy: number; cell: number }, c: number): [number, number] => [g.ox + (col(c) + 0.5) * g.cell, g.oy + (row(c) + 0.5) * g.cell];

async function slotCentre(page: Page, slot: number): Promise<[number, number]> {
  const geom = (await page.getByTestId("assembly-canvas").getAttribute("data-tray-geom")) ?? "";
  const [x, y, w, h] = geom.split(";")[slot]!.split(",").map(Number) as [number, number, number, number];
  const box = await canvasBox(page, "assembly");
  return [box.x + x + w / 2, box.y + y + h / 2];
}

/** Drag a part onto its neighbour. */
async function swapOnPage(page: Page, a: number, b: number, ms = 220): Promise<void> {
  const g = await boardGeom(page, "assembly");
  const [x0, y0] = centre(g, a);
  const [x1, y1] = centre(g, b);
  await dragThrough(page, [[x0, y0], [x0 + (x1 - x0) * 0.8, y0 + (y1 - y0) * 0.8]], ms);
}

/** Tap a blueprint in the tray, then the bay where it goes: the box centres on the tap. */
async function fitOnPage(page: Page, s: AssemblyState, slot: number, cell: number): Promise<void> {
  const g = await boardGeom(page, "assembly");
  const bp = s.tray[slot]!;
  const [sx, sy] = await slotCentre(page, slot);
  await tapAt(page, sx, sy);
  await page.waitForTimeout(120);
  await tapAt(page, g.ox + (col(cell) + bp.width / 2) * g.cell, g.oy + (row(cell) + bp.height / 2) * g.cell);
}

/** Play moves planned in Node on the page, and check the page ends on the engine's bay each time. */
async function replay(page: Page, seed: string, log: readonly AssemblyMove[]): Promise<AssemblyState> {
  let s = deal(seed);
  for (const m of log) {
    if (m.type === "swap") await swapOnPage(page, m.a, m.b, 40);
    else if (m.type === "fit") await fitOnPage(page, s, m.slot, m.cell);
    s = play(s, m);
    await expect(page.getByTestId("hud-moves").first()).toHaveText(String(s.moveCount));
    await settled(page, "assembly");
    expect(await boardString(page, "assembly")).toBe(shown(s));
  }
  return s;
}

test("assembly: the board", async ({ page }) => {
  // Both opening cores away from the edges.
  const { seed } = findSeed("assembly-hero", (s) => {
    const cores = deal(s).cells.flatMap((p, i) => (p.kind === ASSEMBLY_CORE ? [i] : []));
    return cores.length >= 2 && cores.every((c) => col(c) >= 1 && col(c) <= W - 2 && row(c) >= 1 && row(c) <= H - 2) ? true : null;
  });
  await openLab(page, "assembly", { seed });
  await hidePointer(page);
  await still(page, "assembly", "board", { region: await region(page) });
});

test("assembly: a first fit", async ({ page }) => {
  // A three-part blueprint that fits on the opening bay, with no core under it.
  const { seed, found } = findSeed("assembly-first", (s) => {
    const g = deal(s);
    for (const f of assemblyLegalFits(g)) {
      const r = play(g, { type: "fit", ...f }).lastMove!.fit!;
      if (r.taken.length === 3 && r.cores === 0 && row(f.cell) >= 2) return f;
    }
    return null;
  });
  await openLab(page, "assembly", { seed });
  const s = deal(seed);
  const [sx, sy] = await slotCentre(page, found.slot);
  await page.mouse.move(sx - 30, sy - 20);
  await clip(page, "assembly", "first-fit", async () => {
    await fitOnPage(page, s, found.slot, found.cell);
    await settled(page, "assembly");
  }, { region: await region(page) });
});

test("assembly: each part its own way", async ({ page }) => {
  // A girder that swaps sideways, then a strut up or down, then a cable corner to corner, one after another.
  const { seed, found } = findSeed("assembly-ways", (s) => {
    let g = deal(s);
    const moves: AssemblyMove[] = [];
    for (const [kind, way] of [[ASSEMBLY_GIRDER, "side"], [ASSEMBLY_STRUT, "up"], [ASSEMBLY_CABLE, "diagonal"]] as const) {
      const sw = assemblyLegalSwaps(g).find(
        (m) => (g.cells[m.a]!.kind === kind || g.cells[m.b]!.kind === kind) && assemblyWayBetween(g.config, m.a, m.b) === way && row(m.a) >= 1 && row(m.b) >= 1,
      );
      if (!sw) return null;
      const from = g.cells[sw.a]!.kind === kind ? sw.a : sw.b;
      const m: AssemblyMove = { type: "swap", a: from, b: from === sw.a ? sw.b : sw.a };
      moves.push(m);
      g = play(g, m);
    }
    return moves;
  });
  await openLab(page, "assembly", { seed });
  await clip(page, "assembly", "ways", async () => {
    for (const m of found) {
      if (m.type !== "swap") continue;
      await swapOnPage(page, m.a, m.b);
      await settled(page, "assembly");
      await page.waitForTimeout(350);
    }
  }, { region: await region(page) });
});

/**
 * Plain set-up play: the swap that readies the most blueprints, until three are ready, then the
 * three fits top first that keep the others ready. Null when that does not come within a few swaps.
 */
function planChain(seed: string): { setup: AssemblyMove[]; fits: AssemblyMove[] } | null {
  let s = deal(seed);
  const setup: AssemblyMove[] = [];
  for (let n = 0; n < 8 && ready(s) < 3; n++) {
    let best: AssemblyMove | null = null;
    let top = ready(s);
    for (const m of assemblyLegalSwaps(s)) {
      const v = ready(play(s, { type: "swap", ...m }));
      if (v > top) {
        top = v;
        best = { type: "swap", ...m };
      }
    }
    if (!best) return null;
    setup.push(best);
    s = play(s, best);
  }
  if (ready(s) < 3) return null;
  const fits: AssemblyMove[] = [];
  for (let k = 0; k < 3; k++) {
    // The highest fit first, so the clip reads top to bottom.
    const options = assemblyLegalFits(s).sort((a, b) => row(a.cell) - row(b.cell));
    const f = options.find((o) => ready(play(s, { type: "fit", ...o })) >= 2 - k);
    if (!f) return null;
    const m: AssemblyMove = { type: "fit", ...f };
    fits.push(m);
    s = play(s, m);
  }
  return { setup, fits };
}

test("assembly: a chain", async ({ page }) => {
  const { seed, found } = findSeed("assembly-chain", planChain, 2000);
  await openLab(page, "assembly", { seed });
  let s = await replay(page, seed, found.setup);
  await clip(page, "assembly", "chain", async () => {
    for (const m of found.fits) {
      if (m.type !== "fit") continue;
      await fitOnPage(page, s, m.slot, m.cell);
      s = play(s, m);
      await settled(page, "assembly");
    }
  }, { tailMs: 1000, leadMs: 300, region: await region(page) });
});

test("assembly: a core stands in", async ({ page }) => {
  // A fit on the opening bay with a core under one of its squares.
  const { seed, found } = findSeed("assembly-core", (s) => {
    const g = deal(s);
    for (const f of assemblyLegalFits(g)) if (play(g, { type: "fit", ...f }).lastMove!.fit!.cores > 0) return f;
    return null;
  });
  await openLab(page, "assembly", { seed });
  const s = deal(seed);
  await clip(page, "assembly", "core", async () => {
    await fitOnPage(page, s, found.slot, found.cell);
    await settled(page, "assembly");
  }, { tailMs: 1100, region: await region(page) });
});
