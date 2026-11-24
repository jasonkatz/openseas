import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import { createPouringGame, pouringBestPour, pouringViewString, reducePouring, type PouringMove, type PouringState } from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, glide, hidePointer, openLab, padded, settled, still, tapAt, type Box } from "./lib.js";

const cfg = loadContent().puzzles.pouring.config;
const N = cfg.size;
const col = (cell: number): number => cell % N;
const row = (cell: number): number => Math.floor(cell / N);

const deal = (seed: string): PouringState => createPouringGame(seed, cfg);

/** Plain play: the pour the careful rating likes best, or the first drink when nothing fits. */
function plain(s: PouringState): PouringMove {
  const b = pouringBestPour(s, 0);
  return b ? { type: "pour", slot: b.slot, cell: b.cell } : { type: "drink", slot: 0 };
}

/** Plain play until the next plain move shows the idea: the moves on the way, and the one that shows it. */
function playUntil(seed: string, shows: (next: PouringState, s: PouringState, m: PouringMove) => boolean): { log: PouringMove[]; move: PouringMove } | null {
  let s = deal(seed);
  const log: PouringMove[] = [];
  while (!s.finished) {
    const m = plain(s);
    const next = reducePouring(s, m);
    if (shows(next, s, m)) return { log, move: m };
    log.push(m);
    s = next;
  }
  return null;
}

/** The bar with the rivals over it and the hand under it, cut out of the canvas. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "pouring");
  const pad = Math.max(4, g.cell * 0.12) + 10;
  return padded({ x: g.ox, y: g.oy - g.cell * 1.25, width: g.cell * N, height: g.cell * (N + 1.25 + 2.15) }, pad, await canvasBox(page, "pouring"));
}

const centre = (g: { ox: number; oy: number; cell: number }, c: number): [number, number] => [g.ox + (col(c) + 0.5) * g.cell, g.oy + (row(c) + 0.5) * g.cell];

/** Make one move on the page as a player would: pick the drink by its key, then tap its square, or tap it twice to drink. */
async function play(page: Page, m: PouringMove, ms = 260): Promise<void> {
  if (m.type === "end") return;
  await page.keyboard.press(String(m.slot + 1));
  if (m.type === "drink") {
    await page.keyboard.press("x");
    return;
  }
  const g = await boardGeom(page, "pouring");
  const [x, y] = centre(g, m.cell);
  await glide(page, x, y, ms);
  await tapAt(page, x, y);
}

/** Play moves planned in Node on the page, quickly, and check the page ends on the engine's bar. */
async function replay(page: Page, seed: string, log: readonly PouringMove[]): Promise<void> {
  let s = deal(seed);
  for (const m of log) {
    await play(page, m, 40);
    s = reducePouring(s, m);
    // The HUD reads turns taken of the round's turns.
    await expect(page.getByTestId("hud-moves")).toHaveText(new RegExp(`^${s.seats[0]!.turns}(/|$)`));
    await settled(page, "pouring");
    expect(await boardString(page, "pouring")).toBe(pouringViewString(s.cells));
  }
}

test("pouring: the board", async ({ page }) => {
  // A few turns in: drinks and rings of every pirate on the bar, and no line served yet.
  const { seed, found } = findSeed("pouring-hero", (s) => {
    let st = deal(s);
    const log: PouringMove[] = [];
    for (let i = 0; i < 5; i++) {
      const m = plain(st);
      log.push(m);
      st = reducePouring(st, m);
    }
    const seats = new Set(st.rings.filter((r) => r >= 0));
    return seats.size === st.seats.length && st.seats.every((x) => x.lines === 0) ? log : null;
  });
  await openLab(page, "pouring", { seed });
  await replay(page, seed, found);
  await hidePointer(page);
  await still(page, "pouring", "board", { region: await region(page) });
});

test("pouring: a first pour", async ({ page }) => {
  const seed = "pouring-first";
  await openLab(page, "pouring", { seed });
  await clip(page, "pouring", "first-pour", async () => {
    await play(page, plain(deal(seed)), 420);
    await settled(page, "pouring");
  }, { tailMs: 1200, region: await region(page) });
});

test("pouring: a line served clean", async ({ page }) => {
  const { seed, found } = findSeed("pouring-serve", (s) => playUntil(s, (next) => next.lastMove!.acts[0]!.lines.length === 1 && next.lastMove!.acts[0]!.clean), 400);
  await openLab(page, "pouring", { seed });
  await replay(page, seed, found.log);
  await clip(page, "pouring", "serve", async () => {
    await play(page, found.move, 420);
    await settled(page, "pouring");
  }, { tailMs: 1300, region: await region(page) });
});

test("pouring: a rival serves the line you left", async ({ page }) => {
  // A pour that serves nothing and leaves a line one short, which the rival after it serves.
  const { seed, found } = findSeed(
    "pouring-steal",
    (s) => playUntil(s, (next) => next.lastMove!.acts[0]!.lines.length === 0 && next.lastMove!.acts[1]?.seat === 1 && next.lastMove!.acts[1].lines.length > 0),
    400,
  );
  await openLab(page, "pouring", { seed });
  await replay(page, seed, found.log);
  await clip(page, "pouring", "steal", async () => {
    await play(page, found.move, 420);
    await settled(page, "pouring");
  }, { tailMs: 1500, region: await region(page) });
});
