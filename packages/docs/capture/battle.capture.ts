import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import {
  battleArcCells,
  battleManhattan,
  chooseRaiderPlan,
  createBattleGame,
  enumerateBattlePlans,
  previewBattleCourse,
  reduceBattle,
  resolveBattleTurn,
  type BattleConfig,
  type BattleEvent,
  type BattleOutcome,
  type BattlePlan,
  type BattleSegment,
  type BattleShip,
  type BattleState,
  type MoveToken,
  type Pose,
  type Side,
} from "@openseas/engine";
import { canvasAttr, canvasBox, clip, findSeed, hidePointer, openLab, still, type Box } from "./lib.js";

const cfg: BattleConfig = loadContent().puzzles.battle.config;
const SIDES: readonly Side[] = ["port", "starboard"];

// The lab's turn clock is set long, so a plot flies when the capture flies it and never before.
// The reducer never reads the clock, so Node plays the same fight ahead of the page.
const LAB = { seconds: 900, config: { turnSeconds: 300 } };

const deal = (seed: string): BattleState => createBattleGame(seed, cfg);
const fly = (s: BattleState, plan: BattlePlan): BattleState => reduceBattle(s, { type: "commit", ...plan });
const bears = (s: BattleState, from: Pose, on: Pose, side: Side): boolean => battleArcCells(s.board, from, side, cfg.turretRange).some((c) => c.x === on.x && c.y === on.y);
const bare = (moves: ReadonlyArray<MoveToken | null>): BattleSegment[] => moves.map((move) => ({ move, port: false, starboard: false }));

/** One way to fly the turn: the moves, a broadside wherever the raider will really be, and what comes of it. */
interface Line {
  plan: BattlePlan;
  /** The move slots that fire. */
  fires: number[];
  events: readonly BattleEvent[];
  outcome: BattleOutcome | null;
  ships: readonly [BattleShip, BattleShip];
  hits: number;
  shots: number;
  hitsTaken: number;
  /** Hull the captain's ship lost, shots and knocks together. */
  damageTaken: number;
}

/**
 * Every course the tokens allow, flown against the plot the raider is about to fly (her mind is in
 * the reducer, so Node knows it), with a load spent on each move she ends in the arc. This is the
 * captain who reads her perfectly: what the guide's tips are teaching toward.
 */
function lines(s: BattleState, grapple: boolean): Line[] {
  const her = chooseRaiderPlan(s, s.rng).plan;
  const out: Line[] = [];
  for (const moves of enumerateBattlePlans(s.ships[0].tokens, cfg.segments)) {
    // Courses that hold only after their last move. Today's board throws while it previews a hold
    // plotted ahead of a move (its ghost list is left with a hole), so a capture cannot plot one.
    if (moves.some((m, i) => m === null && moves.slice(i + 1).some((later) => later !== null))) continue;
    const trace = resolveBattleTurn(s.board, cfg, s.ships, [{ segments: bare(moves), grapple }, her]).trace;
    let loads = s.ships[0].loaded;
    const segments: BattleSegment[] = [];
    const fires: number[] = [];
    for (let i = 0; i < cfg.segments; i++) {
      const seg = { move: moves[i] ?? null, port: false, starboard: false };
      const at = trace[i];
      if (at && loads > 0) {
        for (const side of SIDES) {
          if (!bears(s, at[0], at[1], side)) continue;
          seg[side] = true;
          loads -= 1;
          fires.push(i);
          break;
        }
      }
      segments.push(seg);
    }
    while (segments.length && segments[segments.length - 1]!.move === null && !segments[segments.length - 1]!.port && !segments[segments.length - 1]!.starboard) segments.pop();
    const plan = { segments, grapple };
    const r = resolveBattleTurn(s.board, cfg, s.ships, [plan, her]);
    const mine = r.events.filter((e) => e.type === "shot" && e.ship === 0);
    out.push({
      plan,
      fires,
      events: r.events,
      outcome: r.outcome,
      ships: r.ships,
      hits: mine.filter((e) => e.type === "shot" && e.hit).length,
      shots: mine.length,
      hitsTaken: r.events.filter((e) => e.type === "shot" && e.ship === 1 && e.hit).length,
      damageTaken: r.ships[0].damage - s.ships[0].damage,
    });
  }
  return out;
}

/** The best of them: hits landed less hits taken, no hull thrown away, closing a little. */
function best(s: BattleState): Line {
  const worth = (l: Line): number =>
    (l.outcome === "boarded" || l.outcome === "crippled" ? 5000 : l.outcome ? -5000 : 0) + l.hits * 100 - l.hitsTaken * 120 - (l.damageTaken - l.hitsTaken * cfg.shotDamage) * 2 - battleManhattan(l.ships[0], l.ships[1]) * 6;
  return lines(s, true).reduce((a, b) => (worth(b) > worth(a) ? b : a));
}

/** A line as the reducer flies it: the plot, and the fight after it. */
interface Turn {
  plan: BattlePlan;
  after: BattleState;
}
const turn = (s: BattleState, l: Line): Turn => ({ plan: l.plan, after: fly(s, l.plan) });

// ---- the page

/** What the board publishes (`data-board`), from a state Node holds. */
const view = (s: BattleState): string => `${s.turn}:${s.ships.map((x) => `${x.x}.${x.y}.${x.heading}.${x.damage}.${x.loaded}`).join("|")}:${s.outcome ?? "-"}`;

/** How long the board takes to play a turn back, from the renderer's beats, with room for a busy machine. */
function playbackMs(s: BattleState): number {
  const events = s.lastTurn?.events ?? [];
  let ms = 0;
  for (let seg = 0; seg <= cfg.segments; seg++) {
    const here = events.filter((e) => e.seg === seg);
    if (here.some((e) => e.type === "move")) ms += 360;
    if (here.some((e) => e.type === "push")) ms += 260;
    if (here.some((e) => e.type === "spin")) ms += 220;
    if (here.some((e) => e.type === "shot")) ms += 320;
    ms += here.filter((e) => e.type === "grapple" || e.type === "ended").length * 900;
  }
  return Math.round(ms * 1.5) + 700;
}

const KEY: Record<MoveToken, string> = { left: "a", forward: "w", right: "d" };

/** Plot a plan by keyboard, slot after slot: a move or a hold, then its guns (Q and E arm the slot just plotted). */
async function plot(page: Page, plan: BattlePlan): Promise<void> {
  for (const seg of plan.segments) {
    await page.keyboard.press(seg.move ? KEY[seg.move] : "s");
    if (seg.port) await page.keyboard.press("q");
    if (seg.starboard) await page.keyboard.press("e");
  }
  if (plan.grapple) await page.keyboard.press("g");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", JSON.stringify(plan));
}

/** Wait for the page to hold the state Node expects, and for the board to finish playing the turn. */
async function flown(page: Page, after: BattleState): Promise<void> {
  await expect(page.getByTestId("battle-board")).toHaveAttribute("data-board", view(after));
  await page.waitForTimeout(playbackMs(after));
}

/** Fly turns unseen, to reach the position a picture starts from. */
async function prelude(page: Page, turns: readonly Turn[]): Promise<void> {
  for (const t of turns) {
    await plot(page, t.plan);
    await page.keyboard.press("Enter");
    await flown(page, t.after);
  }
}

/** The chart and the hulls above it, without the plot strip. */
async function chart(page: Page): Promise<Box> {
  const box = await canvasBox(page, "battle");
  const [, gy, cell] = (await canvasAttr(page, "battle", "data-geom")).split(",").map(Number) as [number, number, number];
  const rows = cfg.boards[0]!.length;
  return { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, gy + rows * cell + cell * 0.5 + 6) };
}

// ---- the pictures

test("battle: the board", async ({ page }) => {
  // The open rock field, with a course plotted that turns and fires: the ghosts and the shaded reach.
  const moves: MoveToken[] = ["forward", "right", "forward"];
  const { seed } = findSeed("battle-hero", (s) => {
    const g = deal(s);
    return g.boardIndex === 0 && previewBattleCourse(g, bare(moves)).every((step) => step.damage === 0 && step.blocked === null) ? true : null;
  });
  await openLab(page, "battle", { seed, ...LAB });
  await hidePointer(page);
  await plot(page, { segments: bare(moves).map((seg, i) => ({ ...seg, port: i === 2 })), grapple: false });
  await page.waitForTimeout(400);
  await still(page, "battle", "board");
});

test("battle: plotting a turn", async ({ page }) => {
  // Forward, forward, left, a broadside after the turn, and fly: a quiet first turn nobody is hit in.
  const plan: BattlePlan = { segments: [{ move: "forward", port: false, starboard: false }, { move: "forward", port: false, starboard: false }, { move: "left", port: false, starboard: true }], grapple: false };
  const { seed, found } = findSeed("battle-plot", (s) => {
    const g = deal(s);
    if (g.boardIndex !== 0) return null;
    const after = fly(g, plan);
    const t = after.lastTurn!;
    return t.hitsTaken === 0 && t.damageTaken === 0 && !t.events.some((e) => e.type === "move" && e.blocked) ? after : null;
  });
  await openLab(page, "battle", { seed, ...LAB });
  // Plotted by key, a beat apart: pointer moves over this canvas stall a busy machine's frames.
  await hidePointer(page);
  await clip(page, "battle", "plot", async () => {
    for (const key of ["w", "w", "a", "e"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(400);
    }
    await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", JSON.stringify(plan));
    await page.keyboard.press("Enter");
    await flown(page, found);
  }, { tailMs: 600 });
});

test("battle: a course that costs hull", async ({ page }) => {
  // Three moves, the last of them into an asteroid: the board rings it before it is flown.
  const { seed, found } = findSeed("battle-ring", (s) => {
    const g = deal(s);
    for (const moves of enumerateBattlePlans(g.ships[0].tokens, cfg.segments)) {
      if (moves.length !== 3 || moves.includes(null)) continue;
      const course = previewBattleCourse(g, bare(moves));
      if (course[2]!.blocked === "asteroid" && course[0]!.damage === 0 && course[1]!.damage === 0 && course[3]!.damage === 0) return moves;
    }
    return null;
  });
  await openLab(page, "battle", { seed, ...LAB });
  await hidePointer(page);
  await plot(page, { segments: bare(found), grapple: false });
  await page.waitForTimeout(400);
  await still(page, "battle", "ring", { region: await chart(page) });
});

test("battle: a broadside laid where she will be", async ({ page }) => {
  // The first turn: two broadsides over cells that are empty when they are plotted. She flies into both.
  const { seed, found } = findSeed("battle-lead", (s) => {
    const g = deal(s);
    const her: Pose = g.ships[1];
    for (const l of lines(g, false)) {
      if (l.hits !== 2 || l.shots !== 2 || l.hitsTaken !== 0 || l.damageTaken !== 0 || l.outcome) continue;
      if (l.plan.segments.filter((seg) => seg.move).length < 2) continue;
      // Nothing she could be hit by where she starts: every shot is a lead.
      const course = previewBattleCourse(g, l.plan.segments);
      if (l.fires.every((i) => SIDES.every((side) => !l.plan.segments[i]![side] || !bears(g, course[i]!.pose, her, side)))) return turn(g, l);
    }
    return null;
  });
  await openLab(page, "battle", { seed, ...LAB });
  await hidePointer(page);
  await plot(page, found.plan);
  await page.waitForTimeout(400);
  await clip(page, "battle", "lead", async () => {
    await page.waitForTimeout(700);
    await page.keyboard.press("Enter");
    await flown(page, found.after);
  }, { tailMs: 500, region: await chart(page) });
});

test("battle: the hit and the grapple in one move", async ({ page }) => {
  // She is not yet hurt enough to board. One move ends alongside, its broadside takes her past
  // half hull, and the grapple goes over before the next move.
  const { seed, found } = findSeed("battle-board", (s) => {
    let g = deal(s);
    const before: Turn[] = [];
    for (let n = 0; n < 3; n++) {
      const next = best(g);
      if (next.outcome === "boarded") {
        const grapple = next.events.find((e) => e.type === "grapple");
        const hit = next.events.find((e) => e.type === "shot" && e.ship === 0 && e.hit && e.seg === grapple?.seg);
        const clean = g.ships[1].damage < cfg.grappleDamage && next.hits === 1 && next.hitsTaken === 0 && next.plan.segments.some((seg) => seg.move);
        return n >= 1 && grapple && hit && clean ? { before, kill: turn(g, next) } : null;
      }
      if (next.outcome) return null;
      before.push(turn(g, next));
      g = before[before.length - 1]!.after;
    }
    return null;
  });
  await openLab(page, "battle", { seed, ...LAB });
  await hidePointer(page);
  await prelude(page, found.before);
  await plot(page, found.kill.plan);
  await page.waitForTimeout(400);
  // The harness lays its result card over the board the moment the fight ends. Keep it off the
  // picture, so the clip shows the board playing the last turn out.
  await page.addStyleTag({ content: ".board-veil,[data-testid=result]{display:none!important}" });
  await clip(page, "battle", "board-her", async () => {
    await page.waitForTimeout(700);
    await page.keyboard.press("Enter");
    await flown(page, found.kill.after);
  }, { tailMs: 700, region: await chart(page) });
});
