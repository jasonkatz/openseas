import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  createRacksGame,
  racksCrateFits,
  racksCrateWouldShip,
  racksHint,
  racksMoveIllegalReason,
  racksTopGroup,
  racksViewString,
  racksWouldShip,
  reduceRacks,
  type RacksMove,
  type RacksState,
} from "@openseas/engine";
import { boardGeom, boardString, canvasAttr, canvasBox, clip, findSeed, hidePointer, openLab, padded, settled, still, type Box } from "./lib.js";

const cfg = loadContent().puzzles.racks.config;
const R = cfg.racks;
/** Lab rounds run long, so the moves that lead up to a picture never meet the end of the round. */
const SECONDS = 300;

type Act = Extract<RacksMove, { type: "move" | "call" }>;

const deal = (seed: string): RacksState => createRacksGame(seed, cfg);
const view = (s: RacksState): string => racksViewString(s.racks, s.crate);
const shipsIn = (s: RacksState): number => s.lastMove?.events.filter((e) => e.type === "ship").length ?? 0;
const did = (s: RacksState, type: "land" | "spill"): boolean => s.lastMove?.events.some((e) => e.type === type) ?? false;
const pure = (s: RacksState, rack: number): boolean => s.racks[rack]!.every((c) => c.kind === s.racks[rack]![0]!.kind);

/** Every move the engine takes, and the call when the crate has room. */
function acts(s: RacksState): Act[] {
  const out: Act[] = [];
  for (let from = 0; from < R; from++) for (let to = 0; to < R; to++) if (racksMoveIllegalReason(s, from, to) === null) out.push({ type: "move", from, to });
  if (racksCrateFits(s)) out.push({ type: "call" });
  return out;
}

interface Spot<T> {
  /** The tidy play that leads to the board in the picture. */
  pre: Act[];
  plan: T;
}

/**
 * The boards a tidy round passes through: the engine's own hint played from the deal, `from` to
 * `to` actions in. The first one `probe` likes, with the play that reaches it.
 */
function along<T>(seed: string, from: number, to: number, probe: (s: RacksState) => T | null): Spot<T> | null {
  let s = deal(seed);
  const pre: Act[] = [];
  for (let k = 0; k <= to; k++) {
    if (k >= from) {
      const plan = probe(s);
      if (plan !== null) return { pre, plan };
    }
    const h = racksHint(s);
    if (!h) return null;
    pre.push(h);
    s = reduceRacks(s, h);
  }
  return null;
}

// ---- driving the page

/** The panel: the strip of words, the crate on its rail and the racks, without the canvas's empty sides. */
async function region(page: Page): Promise<Box> {
  const g = await boardGeom(page, "racks");
  const canvas = await canvasBox(page, "racks");
  return padded({ x: g.ox, y: canvas.y, width: g.cell * R, height: canvas.height }, 14, canvas);
}

/** A point on a rack's column, inside the rack. `boardGeom`'s cell is the pitch between racks here. */
async function rackPoint(page: Page, rack: number): Promise<[number, number]> {
  const g = await boardGeom(page, "racks");
  return [g.ox + (rack + 0.5) * g.cell, g.oy + g.cell * 1.5];
}

/** The hanging crate, from the point the canvas publishes for it. */
async function cratePoint(page: Page): Promise<[number, number]> {
  await expect.poll(() => canvasAttr(page, "racks", "data-crate")).toMatch(/^\d+,\d+$/);
  const [x, y] = (await canvasAttr(page, "racks", "data-crate")).split(",").map(Number) as [number, number];
  const box = await canvasBox(page, "racks");
  return [box.x + x, box.y + y];
}

/** Wait for the page to hold the board Node expects, and for its animation to land. */
async function sync(page: Page, s: RacksState): Promise<void> {
  await expect.poll(() => boardString(page, "racks"), { timeout: 15_000 }).toBe(view(s));
  await settled(page, "racks");
}

/** Play the lead-up with plain clicks, off camera. */
async function lead(page: Page, seed: string, pre: readonly Act[]): Promise<RacksState> {
  let s = deal(seed);
  await sync(page, s);
  for (const a of pre) {
    if (a.type === "call") await page.mouse.click(...(await cratePoint(page)));
    else {
      await page.mouse.click(...(await rackPoint(page, a.from)));
      await page.mouse.click(...(await rackPoint(page, a.to)));
    }
    s = reduceRacks(s, a);
    await sync(page, s);
  }
  return s;
}

/** Where the pointer is, so a glide is paced by the clock and a busy machine cannot stretch it. */
let at: [number, number] = [0, 0];

async function park(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  at = [x, y];
}

async function glideTo(page: Page, x: number, y: number, ms = 240): Promise<void> {
  const [x0, y0] = at;
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    const e = k * k * (3 - 2 * k);
    await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
    if (k >= 1) break;
  }
  at = [x, y];
}

async function press(page: Page, x: number, y: number): Promise<void> {
  await glideTo(page, x, y);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

/** One action with the pointer, as a player makes it: tap a rack and tap another, or tap the crate. */
async function play(page: Page, s: RacksState, a: Act, liftMs = 240): Promise<RacksState> {
  if (a.type === "call") await press(page, ...(await cratePoint(page)));
  else {
    await press(page, ...(await rackPoint(page, a.from)));
    await page.waitForTimeout(liftMs);
    await press(page, ...(await rackPoint(page, a.to)));
  }
  const next = reduceRacks(s, a);
  await sync(page, next);
  return next;
}

/** Open the seed, play the lead-up and rest the pointer under the racks. */
async function open(page: Page, seed: string, pre: readonly Act[]): Promise<RacksState> {
  await openLab(page, "racks", { seed, seconds: SECONDS });
  const s = await lead(page, seed, pre);
  const g = await boardGeom(page, "racks");
  await park(page, g.ox + g.cell * R * 0.5, g.oy + g.cell * 2.6);
  return s;
}

test("racks: the board", async ({ page }) => {
  // A round a little way in: two racks sorted, every kind on show, a crate that fits.
  const { seed, found } = findSeed("racks-hero", (seed) =>
    along(seed, 6, 20, (s) => {
      const sorted = s.racks.filter((r, i) => r.length >= 3 && pure(s, i)).length;
      const cells = s.racks.reduce((n, r) => n + r.length, 0);
      const kinds = new Set(s.racks.flatMap((r) => r.map((c) => c.kind))).size;
      const crateKinds = new Set(s.crate.cells.map((c) => c.kind)).size;
      const ok = sorted >= 2 && cells >= 13 && cells <= 17 && kinds === cfg.kinds && crateKinds >= 2 && s.crate.lands === 3;
      return ok && racksCrateFits(s) && !racksCrateWouldShip(s) && s.racks[s.crate.rack]!.length >= 1 ? true : null;
    }),
  );
  await open(page, seed, found.pre);
  await hidePointer(page);
  await still(page, "racks", "board", { region: await region(page) });
});

test("racks: a shipment", async ({ page }) => {
  // Two or more cells lifted as one group fill a rack with one kind. The crate is elsewhere and does not land.
  const { seed, found } = findSeed("racks-ship", (seed) =>
    along(seed, 3, 24, (s) => {
      const h = racksHint(s);
      if (!h || h.type !== "move" || !racksWouldShip(s, h.from, h.to)) return null;
      const group = racksTopGroup(s.racks[h.from]!)!;
      const clear = s.crate.lands >= 2 && s.crate.rack !== h.from && s.crate.rack !== h.to && racksCrateFits(s);
      return group.count >= 2 && group.count === s.racks[h.from]!.length && clear ? h : null;
    }),
  );
  let s = await open(page, seed, found.pre);
  await clip(page, "racks", "ship", async () => {
    s = await play(page, s, found.plan, 650);
  }, { leadMs: 800, tailMs: 1200, region: await region(page) });
});

test("racks: no room under the crate", async ({ page }) => {
  // The crate has no room and two moves are left. The first lifts the marked rack's top onto its own
  // kind and makes room; the crate lands with the second and smashes nothing.
  const { seed, found } = findSeed("racks-room", (seed) =>
    along(seed, 3, 30, (s) => {
      // No chain is running, so the strip speaks of the crate.
      if (racksCrateFits(s) || s.crate.lands !== 2 || s.combo > 0) return null;
      const a = racksHint(s);
      if (!a || a.type !== "move" || a.from !== s.crate.rack) return null;
      const onto = racksTopGroup(s.racks[a.to]!);
      if (!onto || onto.kind !== racksTopGroup(s.racks[a.from]!)!.kind) return null;
      const s1 = reduceRacks(s, a);
      const b = racksHint(s1);
      if (!racksCrateFits(s1) || shipsIn(s1) > 0 || !b || b.type !== "move" || b.from === s.crate.rack || b.to === s.crate.rack) return null;
      const s2 = reduceRacks(s1, b);
      // The crate hung next has room too, so the picture ends with the red gone.
      return did(s2, "land") && !did(s2, "spill") && shipsIn(s2) === 0 && racksCrateFits(s2) ? [a, b] : null;
    }),
  );
  let s = await open(page, seed, found.pre);
  await still(page, "racks", "no-room", { region: await region(page) });
  await clip(page, "racks", "make-room", async () => {
    s = await play(page, s, found.plan[0]!);
    await page.waitForTimeout(450);
    s = await play(page, s, found.plan[1]!);
  }, { leadMs: 700, tailMs: 1200, region: await region(page) });
});

test("racks: calling the crate", async ({ page }) => {
  // The racks are in order and the crate is one kind, the kind on top of the rack under it, with
  // three moves or more still on its count. The tidy play is to call it.
  const { seed, found } = findSeed("racks-call", (seed) =>
    along(seed, 3, 30, (s) => {
      const h = racksHint(s);
      if (!h || h.type !== "call" || s.crate.lands < 3 || racksCrateWouldShip(s)) return null;
      const under = s.racks[s.crate.rack]!;
      const joins = under.length >= 2 && pure(s, s.crate.rack) && s.crate.cells.every((c) => c.kind === under[0]!.kind);
      // The crate hung next has room as well.
      return joins && racksCrateFits(reduceRacks(s, h)) ? h : null;
    }),
  );
  let s = await open(page, seed, found.pre);
  await clip(page, "racks", "call", async () => {
    s = await play(page, s, found.plan);
  }, { leadMs: 700, tailMs: 1200, region: await region(page) });
});

test("racks: one more move before the shipment", async ({ page }) => {
  // A rack can ship now, and nothing that starts with that shipment ships twice in three actions.
  // One tidy move first, like onto like or onto an empty rack, and then two racks ship back to back.
  const { seed, found } = findSeed("racks-hold", (seed) =>
    along(seed, 4, 30, (tidy) => {
      // A crate has just been called down, so the next hangs with a full count and stays up for the
      // whole line. It is no part of it: it has room before and after.
      if (!racksCrateFits(tidy)) return null;
      const s = reduceRacks(tidy, { type: "call" });
      if (shipsIn(s) > 0 || !racksCrateFits(s) || racksCrateWouldShip(s)) return null;
      const now = acts(s).filter((a) => a.type === "move" && racksWouldShip(s, a.from, a.to));
      if (now.length === 0) return null;
      for (const a of now) {
        const s1 = reduceRacks(s, a);
        for (const b of acts(s1)) {
          const s2 = reduceRacks(s1, b);
          if (shipsIn(s2) > 0) return null;
          if (acts(s2).some((c) => shipsIn(reduceRacks(s2, c)) > 0)) return null;
        }
      }
      for (const x of acts(s)) {
        if (x.type !== "move") continue;
        const onto = racksTopGroup(s.racks[x.to]!);
        const group = racksTopGroup(s.racks[x.from]!)!;
        if (onto && onto.kind !== group.kind) continue;
        const sx = reduceRacks(s, x);
        if (shipsIn(sx) > 0) continue;
        for (const a of acts(sx)) {
          if (a.type !== "move") continue;
          const s1 = reduceRacks(sx, a);
          if (shipsIn(s1) !== 1) continue;
          for (const b of acts(s1)) if (b.type === "move" && shipsIn(reduceRacks(s1, b)) === 1 && racksCrateFits(reduceRacks(s1, b))) return [x, a, b];
        }
      }
      return null;
    }),
  );
  let s = await open(page, seed, [...found.pre, { type: "call" }]);
  await clip(page, "racks", "hold", async () => {
    s = await play(page, s, found.plan[0]!);
    await page.waitForTimeout(300);
    s = await play(page, s, found.plan[1]!);
    s = await play(page, s, found.plan[2]!);
  }, { leadMs: 700, tailMs: 1200, region: await region(page) });
});

test("racks: a chain of three with the crate as a link", async ({ page }) => {
  // Three shipments on three actions in a row, one of them the crate that hangs there now, called
  // down onto the rack it completes. Nothing else lands and nothing is smashed.
  const { seed, found } = findSeed("racks-three", (seed) =>
    along(seed, 4, 36, (s) => {
      const chain = (st: RacksState, line: Act[], called: boolean): Act[] | null => {
        if (line.length === 3) return called ? line : null;
        for (const a of acts(st)) {
          if (a.type === "call" && called) continue;
          const next = reduceRacks(st, a);
          if (shipsIn(next) !== 1 || did(next, "spill")) continue;
          // The crate comes down only when it is called.
          if (a.type === "move" && did(next, "land")) continue;
          if (a.type === "move" && called) {
            // After the call a new crate hangs: the last link must not lean on it.
            if (next.crate.lands === cfg.landEvery) continue;
          }
          const out = chain(next, [...line, a], called || a.type === "call");
          if (out) return out;
        }
        return null;
      };
      return chain(s, [], false);
    }),
  );
  let s = await open(page, seed, found.pre);
  await clip(page, "racks", "three", async () => {
    for (const a of found.plan) {
      s = await play(page, s, a);
      await page.waitForTimeout(150);
    }
  }, { leadMs: 700, tailMs: 1200, region: await region(page) });
});
