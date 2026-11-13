import { test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  DX,
  DY,
  GunneryKind,
  createGunneryGame,
  gunneryCellAt,
  gunneryNextHeading,
  predictGunneryPath,
  reduceGunnery,
  type Dir,
  type GunneryEvent,
  type GunneryState,
} from "@openseas/engine";
import { boardGeom, boardString, canvasBox, clip, findSeed, hidePointer, openLab, padded, stepClock, still, toggleClock, type Box } from "./lib.js";

/**
 * Gunnery is ticked (ADR 0015): the deck moves on the round's clock, so a capture cannot just click
 * and wait. Every picture here is planned as a list of `Act`s (an arrow laid, turned or lifted at a
 * tick) that Node plays through the engine first. The page then plays the same list twice over:
 *
 * - the lead-up with the lab clock paused, stepped a tick at a time, so each act lands on exactly
 *   its tick however busy the machine is; the page's board is then checked against Node's;
 * - the clip itself with the clock running, where each act has a window of ticks in which it does
 *   the same thing (after the last piece left the tile, before the next one arrives). The plan is
 *   proven in Node at both ends of every window, so a late click changes nothing.
 */
const cfg = loadContent().puzzles.gunnery.config;
const { Cell, Sabot, Slug, Coolant } = GunneryKind;
const RIGHT: Dir = 0;
const LEFT: Dir = 2;

/** An arrow laid or turned (`dir`), or lifted (`null`), at `tick`; it does the same any time up to `by`. */
interface Act {
  tick: number;
  by: number;
  col: number;
  row: number;
  dir: Dir | null;
}

interface Played {
  state: GunneryState;
  events: GunneryEvent[];
}

/** Play `acts` through the engine up to `until`, each `late` ticks into its window. Null if an act would change nothing. */
function run(seed: string, acts: readonly Act[], until: number, late = 0): Played | null {
  let state = createGunneryGame(seed, cfg);
  const events: GunneryEvent[] = [];
  const timed = acts.map((a) => ({ ...a, at: Math.min(a.by, a.tick + late) })).filter((a) => a.at <= until);
  timed.sort((a, b) => a.at - b.at);
  for (const a of timed) {
    const there = state.arrows.find((x) => x.col === a.col && x.row === a.row);
    state = reduceGunnery(state, { type: "wait", tick: a.at });
    events.push(...state.lastMove!.events);
    if ((there?.dir ?? null) === a.dir) return null;
    state = reduceGunnery(state, a.dir === null ? { type: "remove", col: a.col, row: a.row, tick: a.at } : { type: "arrow", col: a.col, row: a.row, dir: a.dir, tick: a.at });
  }
  state = reduceGunnery(state, { type: "wait", tick: until });
  events.push(...state.lastMove!.events);
  return { state, events };
}

/** The same in every window position a click could land in, or null if they disagree on what the turrets took. */
function proven(seed: string, acts: readonly Act[], until: number): Played | null {
  const on = run(seed, acts, until, 0);
  if (!on) return null;
  const story = (p: Played): string => p.events.filter((e) => e.type !== "spawn" && e.type !== "exit" && e.type !== "fire" && e.type !== "broadside").map((e) => `${e.type}:${e.turret}:${e.pieceId}`).join(",");
  for (const late of [2, 4, 99]) {
    const other = run(seed, acts, until, late);
    if (!other || story(other) !== story(on)) return null;
  }
  return on;
}

interface Drop {
  id: number;
  kind: number;
  tick: number;
}

/** What the feeder drops and when, left alone: arrows that keep the deck from filling up do not change it. */
function drops(seed: string, until: number): Drop[] {
  return run(seed, [], until)!.events.filter((e) => e.type === "spawn").map((e) => ({ id: e.pieceId!, kind: e.kind!, tick: e.tick }));
}

/** A tile on the unsteered stream level with a turret: one arrow there sends a piece straight in. */
interface Switch {
  col: number;
  row: number;
  /** Ticks from the drop to this tile. */
  dist: number;
  /** The turret an arrow pointing left sends a piece into, and how many tiles away it is. */
  left: { turret: number; run: number } | null;
  right: { turret: number; run: number } | null;
}

function switches(state: GunneryState): Switch[] {
  const { deck } = state;
  const stream = [{ col: deck.drop.col, row: deck.drop.row }, ...predictGunneryPath(state, { id: 0, kind: Cell, ...deck.drop }, 60, []).cells];
  const out: Switch[] = [];
  stream.forEach((c, dist) => {
    const side = (dx: number): Switch["left"] => {
      let col = c.col + dx;
      let n = 0;
      while (gunneryCellAt(deck, col, c.row) === "deck") {
        col += dx;
        n++;
      }
      if (n === 0 || gunneryCellAt(deck, col, c.row) !== "turret") return null;
      return { turret: deck.turrets.findIndex((t) => t.col === col && t.row === c.row), run: n + 1 };
    };
    const left = side(-1);
    const right = side(1);
    if (left || right) out.push({ ...c, dist, left, right });
  });
  return out;
}

/** Where a piece goes: into a turret by a switch, out a hatch (null), or wherever the switches already point ("any"). */
type Want = { sw: number; dir: Dir } | null | "any";

/**
 * The switch flips that send each drop where it is wanted. A flip for one piece may land any time
 * after the piece before it rolled off the tile and before this one rolls onto it.
 */
function schedule(sws: readonly Switch[], dropped: readonly Drop[], wants: readonly Want[]): Act[] {
  const acts: Act[] = [];
  const now: (Dir | null)[] = sws.map(() => null);
  wants.forEach((want, i) => {
    for (let k = 0; k < sws.length; k++) {
      const sw = sws[k]!;
      if (want === "any") {
        if (now[k] !== null) break;
        continue;
      }
      const dir = want !== null && want.sw === k ? want.dir : null;
      if (now[k] !== dir) {
        acts.push({ tick: i === 0 ? 0 : dropped[i - 1]!.tick + sw.dist + 1, by: dropped[i]!.tick + sw.dist, col: sw.col, row: sw.row, dir });
        now[k] = dir;
      }
      if (dir !== null) break;
    }
  });
  return acts;
}

const deal = (seed: string): GunneryState => createGunneryGame(seed, cfg);
const count = (p: Played, type: GunneryEvent["type"]): number => p.events.filter((e) => e.type === type).length;

// ---- the page

/** What the page publishes as `data-board`, built from Node's state: the two must agree. */
function view(state: GunneryState): string {
  const pieces = [...state.pieces].sort((a, b) => a.id - b.id).map((p) => `${p.id}:${p.kind}:${p.col}:${p.row}`);
  const turrets = state.turrets.map((c) => `${c.loaded}${c.jammed ? "f" : ""}`);
  const arrows = [...state.arrows].sort((a, b) => a.row - b.row || a.col - b.col).map((a) => `${a.col}.${a.row}.${a.dir}`);
  return `t${state.tick}|${pieces.join(",")}|${turrets.join(",")}|${arrows.join(",")}`;
}

/** A point on a deck tile: its centre, or toward the edge an arrow should point at. */
async function spot(page: Page, col: number, row: number, dir: Dir | null = null): Promise<[number, number]> {
  const g = await boardGeom(page, "gunnery");
  const lean = dir === null ? 0 : 0.3;
  return [g.ox + (col + 0.5 + (dir === null ? 0 : DX[dir]!) * lean) * g.cell, g.oy + (row + 0.5 + (dir === null ? 0 : DY[dir]!) * lean) * g.cell];
}

/** The deck with its rails and the feeder's queue above it. */
async function region(page: Page): Promise<Box> {
  const box = await canvasBox(page, "gunnery");
  const g = await boardGeom(page, "gunnery");
  const w = cfg.decks[0]![0]!.length;
  return padded({ x: g.ox, y: box.y, width: w * g.cell, height: box.height }, 10, box);
}

/** A lab round with its clock stopped at the start. */
async function open(page: Page, seed: string): Promise<{ ticks: number }> {
  await openLab(page, "gunnery", { seed, paused: true });
  return { ticks: -1 };
}

/** Step the stopped clock to `tick`. The first step only starts the round: the board shows one tick behind the clock. */
async function stepTo(page: Page, clock: { ticks: number }, tick: number): Promise<void> {
  const n = tick - clock.ticks;
  if (n <= 0) return;
  await stepClock(page, n);
  clock.ticks = tick;
}

/** Play the acts before `until` on the stopped clock, each on its own tick, and check the page against Node. */
async function leadUp(page: Page, seed: string, acts: readonly Act[], until: number): Promise<{ ticks: number }> {
  const clock = await open(page, seed);
  const before = acts.filter((a) => a.tick < until).sort((a, b) => a.tick - b.tick);
  for (const a of before) {
    await stepTo(page, clock, a.tick);
    const [x, y] = await spot(page, a.col, a.row, a.dir);
    // A click toward an edge lays or turns the arrow; a right click lifts it.
    await page.mouse.click(x, y, a.dir === null ? { button: "right" } : {});
  }
  await stepTo(page, clock, until);
  await hidePointer(page);
  const want = view(run(seed, before.map((a) => ({ ...a, by: a.tick })), until)!.state);
  const deadline = Date.now() + 6000;
  let shown = "";
  while (Date.now() < deadline) {
    shown = await boardString(page, "gunnery");
    if (shown === want) return clock;
    await page.waitForTimeout(60);
  }
  throw new Error(`gunnery ${seed}: the page shows ${shown}, the engine says ${want}`);
}

async function tickShown(page: Page): Promise<number> {
  return Number(/^t(\d+)/.exec(await boardString(page, "gunnery"))?.[1] ?? -1);
}

async function waitTick(page: Page, tick: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  while ((await tickShown(page)) < tick) {
    if (Date.now() > deadline) throw new Error(`gunnery: tick ${tick} never came`);
    await page.waitForTimeout(25);
  }
}

/** Somewhere near a tile that is not deck, to rest the pointer: over a deck tile it draws a ghost arrow. */
function restNear(state: GunneryState, col: number, row: number): { col: number; row: number } {
  let best = { col: 0, row: 0 };
  let bestD = Infinity;
  for (let r = 0; r < state.deck.height; r++)
    for (let c = 0; c < state.deck.width; c++) {
      const cell = gunneryCellAt(state.deck, c, r);
      if (cell === "deck" || cell === "turret") continue;
      const d = Math.hypot(c - col, r - row) + (r < row ? 0 : 0.5);
      if (d < bestD) {
        bestD = d;
        best = { col: c, row: r };
      }
    }
  return best;
}

/**
 * The clock runs and the hand plays the acts from `from` to `until`. The pointer goes to the next
 * tile ahead of time and waits there, as a player's does (the board draws the arrow it would lay),
 * and presses as the act's window opens. A tile's arrow is laid or turned by clicking toward an
 * edge and lifted by clicking the same way again. The clock is stopped again at `until`.
 */
async function live(page: Page, seed: string, acts: readonly Act[], from: number, until: number): Promise<void> {
  const state = deal(seed);
  const mine = acts.filter((a) => a.tick >= from && a.tick <= until).sort((a, b) => a.tick - b.tick);
  const dirs = new Map<string, Dir>();
  for (const a of acts.filter((x) => x.tick < from).sort((x, y) => x.tick - y.tick)) {
    if (a.dir === null) dirs.delete(`${a.col},${a.row}`);
    else dirs.set(`${a.col},${a.row}`, a.dir);
  }
  // A few big steps, not a smooth glide: every step is a round trip to the browser, and the clock is running.
  const move = (x: number, y: number): Promise<void> => page.mouse.move(x, y, { steps: 4 });
  const hover = async (a: Act): Promise<void> => {
    const [x, y] = await spot(page, a.col, a.row, a.dir ?? dirs.get(`${a.col},${a.row}`) ?? null);
    await move(x, y);
  };
  const toggle = (): Promise<void> => toggleClock(page);
  if (mine[0]) await hover(mine[0]);
  await toggle();
  for (let i = 0; i < mine.length; i++) {
    const a = mine[i]!;
    await waitTick(page, a.tick);
    await page.mouse.down();
    await page.mouse.up();
    const key = `${a.col},${a.row}`;
    const leaned = a.dir ?? dirs.get(key) ?? null;
    if (a.dir === null) dirs.delete(key);
    else dirs.set(key, a.dir);
    const next = mine[i + 1];
    if (next && next.col === a.col && next.row === a.row) {
      // The same tile again: the hand stays on it, and leans the other way if the arrow is to turn.
      if ((next.dir ?? dirs.get(key) ?? null) !== leaned) await hover(next);
      continue;
    }
    // Off the tile, so the arrow is seen as it lies, then on to the next one.
    const rest = restNear(state, a.col, a.row);
    const [rx, ry] = await spot(page, rest.col, rest.row);
    await move(rx, ry);
    if (next) {
      await waitTick(page, Math.min(next.tick - 3, a.by + 1));
      await hover(next);
    }
  }
  await waitTick(page, until);
  await toggle();
}

/** After a clip: the clock is stopped at `until` or just past it, and the turrets hold what Node says they should. */
async function expectTurrets(page: Page, seed: string, acts: readonly Act[], until: number): Promise<void> {
  await page.waitForTimeout(300);
  const shown = await boardString(page, "gunnery");
  const tick = Number(/^t(\d+)/.exec(shown)?.[1] ?? 0);
  const want = view(run(seed, acts.filter((a) => a.tick <= until), tick)!.state).split("|")[2];
  if (shown.split("|")[2] !== want) throw new Error(`gunnery ${seed}: at tick ${tick} the page's turrets are ${shown.split("|")[2]}, the engine's ${want}`);
}

// ---- the pictures

test("gunnery: the board", async ({ page }) => {
  // Mid-round on a deck with no easy lanes: arrows laid around the crates, a piece on a lit route,
  // the four turrets at different stages and a lamp lit. A bot steers every piece by the shortest
  // way to a turret that wants it, turning it with an arrow under it; the page replays its arrows.
  const { seed, found } = findSeed("gun-hero", (s) => {
    const game = deal(s);
    if (switches(game).length > 0) return null;
    const acts = steer(s, 400);
    for (let tick = 200; tick <= 400; tick += 3) {
      const p = run(s, acts, tick);
      if (!p) return null;
      const st = p.state;
      if (count(p, "jam") > 0) return null;
      const lit = st.pieces.filter((x) => {
        const path = predictGunneryPath(st, x, 12);
        return path.end?.type === "turret" && (path.end.outcome === "load" || path.end.outcome === "loaded") && path.cells.length >= 3;
      });
      const stages = new Set(st.turrets.map((t) => t.loaded));
      if (lit.length >= 1 && st.pieces.length >= 3 && stages.size >= 3 && st.turrets.every((t) => t.loaded < 3) && st.firedSince.some(Boolean) && st.arrows.length >= 3 && st.arrows.length <= 9) return { acts, tick };
    }
    return null;
  }, 600);
  await leadUp(page, seed, found.acts, found.tick);
  await page.waitForTimeout(700);
  await still(page, "gunnery", "board", { region: await region(page) });
});

/** Arrows that take every piece to a turret that wants it (nearest first), each laid under the piece as it turns. */
function steer(seed: string, until: number): Act[] {
  let s = deal(seed);
  const W = s.deck.width;
  const fields = s.deck.turrets.map((T) => {
    const f = new Map<number, { d: number; dir: Dir }>();
    let frontier: [number, number][] = [];
    for (const d of [0, 1, 2, 3] as Dir[]) {
      const c = T.col - DX[d]!;
      const r = T.row - DY[d]!;
      if (gunneryCellAt(s.deck, c, r) === "deck") {
        f.set(r * W + c, { d: 1, dir: d });
        frontier.push([c, r]);
      }
    }
    while (frontier.length) {
      const next: [number, number][] = [];
      for (const [c, r] of frontier)
        for (const d of [0, 1, 2, 3] as Dir[]) {
          const pc = c - DX[d]!;
          const pr = r - DY[d]!;
          if (gunneryCellAt(s.deck, pc, pr) !== "deck" || f.has(pr * W + pc)) continue;
          f.set(pr * W + pc, { d: f.get(r * W + c)!.d + 1, dir: d });
          next.push([pc, pr]);
        }
      frontier = next;
    }
    return f;
  });
  const target = new Map<number, number>();
  const acts: Act[] = [];
  while (s.tick < until) {
    for (const p of s.pieces) {
      if (target.has(p.id)) continue;
      const fits = s.deck.turrets
        .map((_, t) => t)
        .filter((t) => p.kind !== Coolant && (s.turrets[t]!.loaded + s.pieces.filter((q) => target.get(q.id) === t).length) % 3 === p.kind)
        .sort((a, b) => fields[a]!.get(p.row * W + p.col)!.d - fields[b]!.get(p.row * W + p.col)!.d);
      target.set(p.id, fits[0] ?? -1);
    }
    for (const p of s.pieces) {
      const t = target.get(p.id)!;
      const arrow = s.arrows.find((a) => a.col === p.col && a.row === p.row);
      let dir: Dir | null | undefined;
      if (t < 0) dir = arrow ? null : undefined;
      else {
        const want = fields[t]!.get(p.row * W + p.col)!.dir;
        if (arrow?.dir !== want && (arrow || gunneryNextHeading(s, p) !== want)) dir = want;
      }
      if (dir === undefined) continue;
      acts.push({ tick: s.tick, by: s.tick, col: p.col, row: p.row, dir });
      s = reduceGunnery(s, dir === null ? { type: "remove", col: p.col, row: p.row, tick: s.tick } : { type: "arrow", col: p.col, row: p.row, dir, tick: s.tick });
    }
    s = reduceGunnery(s, { type: "wait", tick: s.tick + 1 });
  }
  return acts;
}

test("gunnery: one arrow, one load", async ({ page }) => {
  // The round opens with a cell, a sabot and a slug in that order, on a deck where one arrow on the
  // stream points straight into a turret. Lay it and all three roll in; the turret fires.
  const { seed, found } = findSeed("gun-first", (s) => {
    const game = deal(s);
    const sws = switches(game);
    const k = sws.findIndex((sw) => sw.dist >= 2 && sw.dist <= 5 && sw.left);
    if (k < 0) return null;
    const d = drops(s, 40);
    if (d[0]?.kind !== Cell || d[1]?.kind !== Sabot || d[2]?.kind !== Slug || (d[3]?.kind !== Cell && d[3]?.kind !== Coolant)) return null;
    const acts = schedule(sws, d.slice(0, 1), [{ sw: k, dir: LEFT }]);
    const until = d[2]!.tick + sws[k]!.dist + sws[k]!.left!.run + cfg.fireAfterTicks + 2;
    const p = proven(s, acts, until);
    return p && count(p, "fire") === 1 && count(p, "jam") === 0 ? { acts, until } : null;
  });
  await leadUp(page, seed, [], 0);
  await clip(page, "gunnery", "first-load", () => live(page, seed, found.acts, 0, found.until), { region: await region(page), tailMs: 700, leadMs: 250 });
  await expectTurrets(page, seed, found.acts, found.until);
});

test("gunnery: lift the arrow for a wrong piece", async ({ page }) => {
  // A turret far down the stream, so a piece is seen coming. It has its cell; a slug is next, then
  // the sabot it wants. The slug's route shows red: the arrow comes up, the slug rolls on and out,
  // the arrow goes back for the sabot.
  const { seed, found } = findSeed("gun-gate", (s) => {
    const game = deal(s);
    const sws = switches(game);
    const k = sws.findIndex((sw) => sw.dist >= 8 && sw.left && sw.right);
    if (k < 0) return null;
    const d = drops(s, 90);
    for (let j = 0; j <= 3; j++) {
      if (d[j]?.kind !== Cell || d[j + 1]?.kind !== Slug || d[j + 2]?.kind !== Sabot) continue;
      const wants: Want[] = d.slice(0, j + 3).map((_, i) => (i === j || i === j + 2 ? { sw: k, dir: LEFT } : null));
      const acts = schedule(sws, d, wants);
      const sw = sws[k]!;
      const from = d[j]!.tick + sw.dist + 1;
      const until = d[j + 2]!.tick + sw.dist + sw.left!.run + 2;
      const p = proven(s, acts, until);
      if (p && count(p, "load") === 2 && count(p, "jam") === 0) return { acts, from, until };
    }
    return null;
  });
  await leadUp(page, seed, found.acts, found.from);
  await clip(page, "gunnery", "gate", () => live(page, seed, found.acts, found.from, found.until), { region: await region(page), tailMs: 700, leadMs: 250 });
  await expectTurrets(page, seed, found.acts, found.until);
});

test("gunnery: one tile, two turrets", async ({ page }) => {
  // Two turrets face each other across the stream. The left one has its cell, so the next cell is
  // turned right and the sabot after it left: one tile, turned twice, and nothing is wasted.
  const { seed, found } = findSeed("gun-switch", (s) => {
    const game = deal(s);
    if (game.deckIndex === 0) return null;
    const sws = switches(game);
    const k = sws.findIndex((sw) => sw.dist <= 5 && sw.left && sw.right);
    if (k < 0) return null;
    const d = drops(s, 90);
    for (let j = 0; j <= 3; j++) {
      if (d[j]?.kind !== Cell || d[j + 1]?.kind !== Cell || d[j + 2]?.kind !== Sabot) continue;
      const wants: Want[] = d.slice(0, j + 3).map((_, i) => (i === j || i === j + 2 ? { sw: k, dir: LEFT } : i === j + 1 ? { sw: k, dir: RIGHT } : null));
      const acts = schedule(sws, d, wants);
      const sw = sws[k]!;
      const from = d[j]!.tick + sw.dist + 1;
      const until = d[j + 2]!.tick + sw.dist + sw.left!.run + 2;
      const p = proven(s, acts, until);
      if (p && count(p, "load") === 3 && count(p, "jam") === 0) return { acts, from, until };
    }
    return null;
  });
  await leadUp(page, seed, found.acts, found.from);
  await clip(page, "gunnery", "switch", () => live(page, seed, found.acts, found.from, found.until), { region: await region(page), tailMs: 700, leadMs: 250 });
  await expectTurrets(page, seed, found.acts, found.until);
});

test("gunnery: a broadside", async ({ page }) => {
  // A whole opening played the way the guide teaches, on a deck with a switch tile for each pair of
  // turrets: every piece goes to a turret that wants it, an unlit one first. The clip is the last
  // slug of the round's first broadside: three lamps are lit, it loads the fourth turret, and the
  // ship fires.
  const { seed, found } = findSeed("gun-broadside", (s) => {
    const game = deal(s);
    const sws = switches(game).filter((sw) => sw.left && sw.right);
    if (sws.length < 2) return null;
    const d = drops(s, 330);
    const stage = game.turrets.map(() => 0);
    const lit = game.turrets.map(() => false);
    const wants: Want[] = [];
    let last = -1;
    for (let i = 0; i < d.length && last < 0; i++) {
      const kind = d[i]!.kind;
      if (kind === Coolant) {
        wants.push(null);
        continue;
      }
      const homes = sws.flatMap((sw, k) => [
        { sw: k, dir: LEFT, turret: sw.left!.turret },
        { sw: k, dir: RIGHT, turret: sw.right!.turret },
      ]);
      const fits = homes.filter((h) => stage[h.turret] === kind).sort((a, b) => Number(lit[a.turret]) - Number(lit[b.turret]));
      const home = fits[0];
      if (!home) {
        wants.push(null);
        continue;
      }
      wants.push({ sw: home.sw, dir: home.dir });
      stage[home.turret] = (stage[home.turret]! + 1) % 3;
      if (kind === Slug) {
        lit[home.turret] = true;
        if (lit.every(Boolean)) last = i;
      }
    }
    if (last < 0) return null;
    const acts = schedule(sws, d, wants);
    const home = wants[last] as { sw: number; dir: Dir };
    const sw = sws[home.sw]!;
    // The lower pair: the slug is seen rolling the length of the deck.
    if (sw.dist < 8) return null;
    const mine = acts.filter((a) => a.by >= d[last]!.tick && a.tick <= d[last]!.tick + sw.dist);
    const from = Math.min(d[last]!.tick - 3, ...mine.map((a) => a.tick));
    const until = d[last]!.tick + sw.dist + sw.left!.run + cfg.fireAfterTicks + 5;
    const p = proven(s, acts, until);
    if (!p || count(p, "jam") > 0 || count(p, "broadside") !== 1) return null;
    // Nothing else may fire in the clip: the broadside is the one thing it is about.
    const fires = p.events.filter((e) => e.type === "fire" && e.tick >= from);
    return fires.length === 1 ? { acts, from, until } : null;
  }, 3000);
  await leadUp(page, seed, found.acts, found.from);
  await clip(page, "gunnery", "broadside", () => live(page, seed, found.acts, found.from, found.until), { region: await region(page), tailMs: 1300, leadMs: 250 });
  await expectTurrets(page, seed, found.acts, found.until);
});

test("gunnery: hold a piece until its turret wants it", async ({ page }) => {
  // The left turret has its cell and the feeder brings the slug before the sabot. Two arrows facing
  // each other on the right-hand lane make a pen: the slug is turned into it and rolls back and
  // forth while the sabot goes left. Lifting the pen's near arrow lets the slug out, across the
  // stream and into the turret, which fires.
  const { seed, found } = findSeed("gun-hold", (s) => {
    const game = deal(s);
    const sws = switches(game);
    const k = sws.findIndex((sw) => sw.dist <= 5 && sw.left && sw.right && sw.right.run >= 4);
    if (k < 0) return null;
    const sw = sws[k]!;
    const d = drops(s, 110);
    for (let j = 0; j <= 4; j++) {
      if (d[j]?.kind !== Cell || d[j + 1]?.kind !== Slug || d[j + 2]?.kind !== Sabot || !d[j + 3]) continue;
      // Nothing is planned for the piece after the sabot: the search keeps a seed where it does no harm.
      const wants: Want[] = d.slice(0, j + 3).map((_, i) => (i === j || i === j + 2 ? { sw: k, dir: LEFT } : i === j + 1 ? { sw: k, dir: RIGHT } : null));
      const near = { col: sw.col + 1, row: sw.row };
      const far = { col: sw.col + sw.right!.run - 1, row: sw.row };
      const out = d[j + 2]!.tick + sw.dist + 1;
      const acts: Act[] = [
        // The pen, laid before anything is sent into it.
        { tick: 0, by: 0, ...near, dir: RIGHT },
        { tick: 0, by: 0, ...far, dir: LEFT },
        // The sabot has gone left: let the slug out behind it.
        { tick: out, by: out + 8, ...near, dir: null },
        ...schedule([sw], d, wants.map((w) => (w && w !== "any" ? { sw: 0, dir: w.dir } : null))),
      ];
      // Wherever in its window the release lands, the held slug is what fills the turret, and nothing jams before it fires.
      const horizon = out + 8 + 2 * sw.right!.run + sw.left!.run + cfg.fireAfterTicks + 6;
      let until = 0;
      for (const late of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
        const p = run(s, acts, horizon, late);
        const loaded = p?.events.find((e) => e.type === "loaded");
        const fired = (loaded?.tick ?? 0) + cfg.fireAfterTicks + 1;
        if (!p || loaded?.pieceId !== d[j + 1]!.id || p.events.some((e) => e.type === "jam" && e.tick <= fired + 3)) {
          until = -1;
          break;
        }
        until = Math.max(until, fired);
      }
      if (until < 0) continue;
      const from = d[j]!.tick + sw.dist + 1;
      return { acts, from, until };
    }
    return null;
  }, 3000);
  await leadUp(page, seed, found.acts, found.from);
  await clip(page, "gunnery", "hold", () => live(page, seed, found.acts, found.from, found.until), { region: await region(page), tailMs: 900, leadMs: 250 });
  // Nothing is jammed. What the turret holds by now depends on when in its window the release landed.
  const turrets = (await boardString(page, "gunnery")).split("|")[2]!;
  if (turrets.includes("f")) throw new Error(`gunnery ${seed}: a turret jammed (${turrets})`);
});
