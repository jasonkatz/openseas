import { test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import { Special, createCoolingGame, reduceCooling, type CoolingState } from "@openseas/engine";
import { canvasBox, clip, dragThrough, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.cooling.config;
const W = cfg.width;
const H = cfg.height;

/** Every swap on a board with what it would do. */
function swaps(state: CoolingState) {
  const out: { col: number; row: number; groups: number; chains: number; points: number; cleared: number }[] = [];
  for (let row = 0; row < H; row++)
    for (let col = 0; col < W - 1; col++) {
      const a = state.cells[row * W + col]!.kind;
      const b = state.cells[row * W + col + 1]!.kind;
      if (a >= 100 || b >= 100) continue;
      const r = reduceCooling(state, { type: "swap", col, row }).lastMove!;
      out.push({ col, row, groups: r.rounds[0]?.groups.length ?? 0, chains: r.rounds.length, points: r.points, cleared: r.rounds[0]?.groups.reduce((n, g) => n + g.cells.length, 0) ?? 0 });
    }
  return out;
}

const deal = (seed: string): CoolingState => createCoolingGame(seed, cfg);
const has = (s: CoolingState, kind: number): number => s.cells.findIndex((p) => p.kind === kind);

/** The board inside its canvas, with its frame. */
async function region(page: Page): Promise<Box> {
  const box = await canvasBox(page, "cooling");
  const cell = Math.min(box.width / W, box.height / H);
  return padded({ x: box.x + (box.width - cell * W) / 2, y: box.y + (box.height - cell * H) / 2, width: cell * W, height: cell * H }, 12, box);
}

/** Drag the piece at (col,row) onto its right neighbour, as a thumb would. Rows count from the bottom. */
async function swap(page: Page, col: number, row: number): Promise<void> {
  const box = await canvasBox(page, "cooling");
  const cell = Math.min(box.width / W, box.height / H);
  const ox = box.x + (box.width - cell * W) / 2;
  const oy = box.y + (box.height - cell * H) / 2;
  const y = oy + (H - 1 - row + 0.5) * cell;
  await dragThrough(page, [[ox + (col + 0.5) * cell, y], [ox + (col + 1.3) * cell, y]], 220);
}

test("cooling: the board", async ({ page }) => {
  // An opening with a charge and a magnet on it. Slag never comes with the deal.
  const { seed } = findSeed("cool-hero", (s) => {
    const g = deal(s);
    return has(g, Special.Charge) >= 0 && has(g, Special.Magnet) >= 0 ? true : null;
  });
  await openLab(page, "cooling", { seed });
  await hidePointer(page);
  await still(page, "cooling", "board", { region: await region(page) });
});

test("cooling: a first match", async ({ page }) => {
  // A plain run of three high on the board, nothing else going off.
  const { seed, found } = findSeed("cool-first", (s) => swaps(deal(s)).find((m) => m.groups === 1 && m.cleared === 3 && m.chains === 1 && m.row >= 7) ?? null);
  await openLab(page, "cooling", { seed });
  await clip(page, "cooling", "first-match", async () => {
    await swap(page, found.col, found.row);
    await settled(page, "cooling");
  }, { region: await region(page) });
});

test("cooling: a double", async ({ page }) => {
  // One swap, two runs: each half of the swap finishes a run of its own.
  const { seed, found } = findSeed("cool-double", (s) => swaps(deal(s)).find((m) => m.groups === 2 && m.row >= 5) ?? null);
  await openLab(page, "cooling", { seed });
  await clip(page, "cooling", "double", async () => {
    await swap(page, found.col, found.row);
    await settled(page, "cooling");
  }, { region: await region(page) });
});

test("cooling: a cascade", async ({ page }) => {
  const { seed, found } = findSeed("cool-chain", (s) => swaps(deal(s)).find((m) => m.chains >= 3 && m.row >= 4) ?? null);
  await openLab(page, "cooling", { seed });
  await clip(page, "cooling", "cascade", async () => {
    await swap(page, found.col, found.row);
    await settled(page, "cooling");
  }, { tailMs: 1200, region: await region(page) });
});

test("cooling: the specials", async ({ page }) => {
  // A magnet beside the kind the board holds most of.
  const magnet = findSeed("cool-magnet", (s) => {
    const g = deal(s);
    const i = has(g, Special.Magnet);
    if (i < 0 || i % W === W - 1 || Math.floor(i / W) < 5) return null;
    const kind = g.cells[i + 1]!.kind;
    if (kind >= 100) return null;
    return g.cells.filter((p) => p.kind === kind).length >= 13 ? { col: i % W, row: Math.floor(i / W) } : null;
  });
  await openLab(page, "cooling", { seed: magnet.seed });
  await clip(page, "cooling", "magnet", async () => {
    await swap(page, magnet.found.col, magnet.found.row);
    await settled(page, "cooling");
  }, { tailMs: 1200, region: await region(page) });

  const charge = findSeed("cool-charge", (s) => {
    const g = deal(s);
    const i = has(g, Special.Charge);
    const col = i % W;
    const row = Math.floor(i / W);
    if (i < 0 || col < 1 || col > W - 3 || row < 5 || row > H - 2) return null;
    return g.cells[i + 1]!.kind < 100 ? { col, row } : null;
  });
  await openLab(page, "cooling", { seed: charge.seed });
  await clip(page, "cooling", "charge", async () => {
    await swap(page, charge.found.col, charge.found.row);
    await settled(page, "cooling");
  }, { tailMs: 1200, region: await region(page) });
});

test("cooling: two slag lifted together", async ({ page }) => {
  // The board keeps its own heat here (`shipHeat` off), so the heat line is a pure function of the
  // moves and Node can play the same round ahead of the page. A simple bot plays until one swap
  // lifts two slag pieces over the line at once; the page replays its moves and the clip is the last.
  const own = { ...cfg, shipHeat: false, specialChancePerMille: { ...cfg.specialChancePerMille, slag: 60 } };
  const { seed, found } = findSeed("cool-slag", (s) => {
    let g = createCoolingGame(s, own);
    const log: { col: number; row: number }[] = [];
    for (let n = 0; n < 14; n++) {
      let lift: { col: number; row: number } | null = null;
      let best: { col: number; row: number; points: number } | null = null;
      for (let row = 0; row < H; row++)
        for (let col = 0; col < W - 1; col++) {
          const a = g.cells[row * W + col]!.kind;
          const b = g.cells[row * W + col + 1]!.kind;
          if (a >= 100 || b >= 100) continue;
          const r = reduceCooling(g, { type: "swap", col, row }).lastMove!;
          const slagTogether = Math.max(0, ...r.rounds.map((x) => x.groups.filter((q) => q.cause === "slag").length));
          const anySlag = r.rounds.some((x) => x.groups.some((q) => q.cause === "slag"));
          if (slagTogether >= 2 && r.rounds.length <= 3 && row >= 3) lift = { col, row };
          // Otherwise score high on the board and leave the slag where it is.
          if (!anySlag && r.points > 0 && row >= 6 && (!best || r.points > best.points)) best = { col, row, points: r.points };
        }
      if (lift) return n >= 1 ? { log, lift } : null;
      if (!best) return null;
      log.push(best);
      g = reduceCooling(g, { type: "swap", col: best.col, row: best.row });
    }
    return null;
  }, 4000);
  await openLab(page, "cooling", { seed, config: { shipHeat: false, "specialChancePerMille.slag": 60 } });
  for (const m of found.log) {
    await swap(page, m.col, m.row);
    await settled(page, "cooling");
  }
  await page.waitForTimeout(600);
  await still(page, "cooling", "slag-before", { region: await region(page) });
  await clip(page, "cooling", "slag-pair", async () => {
    await swap(page, found.lift.col, found.lift.row);
    await settled(page, "cooling");
  }, { tailMs: 1400, region: await region(page) });
});
