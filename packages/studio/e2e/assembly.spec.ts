import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content bay: six wide, six tall. */
const W = 6;
const H = 6;
const CORE = "@";
/** The way each kind moves by itself: girder sideways, strut up or down, cable corner to corner. */
const WAY: Record<string, "side" | "up" | "diagonal" | undefined> = { "1": "side", "2": "up", "3": "diagonal" };

interface Print {
  w: number;
  h: number;
  parts: Array<{ dc: number; dr: number; kind: string }>;
}

/** The bay and the tray, read off the string the page publishes (`bay/tray`, the engine's own). */
async function read(page: Page): Promise<{ bay: string; tray: Print[] }> {
  const board = await page.getByTestId("assembly-board").getAttribute("data-board");
  const [bay, tray] = (board ?? "").split("/") as [string, string];
  if (bay.length !== W * H) throw new Error(`unexpected board ${board}`);
  return {
    bay,
    tray: tray.split("|").map((s) => {
      const w = Number(s[0]);
      const h = Number(s[1]);
      const parts: Print["parts"] = [];
      for (let i = 0; i < w * h; i++) if (s[2 + i] !== ".") parts.push({ dc: i % w, dr: Math.floor(i / w), kind: s[2 + i]! });
      return { w, h, parts };
    }),
  };
}

function wayBetween(a: number, b: number): "side" | "up" | "diagonal" | null {
  const dc = (b % W) - (a % W);
  const dr = Math.floor(b / W) - Math.floor(a / W);
  if (Math.abs(dc) > 1 || Math.abs(dr) > 1 || (dc === 0 && dr === 0)) return null;
  return dr === 0 ? "side" : dc === 0 ? "up" : "diagonal";
}

function legalSwap(bay: string, a: number, b: number): boolean {
  if (b < 0 || b >= W * H) return false;
  const way = wayBetween(a, b);
  const p = bay[a]!;
  const q = bay[b]!;
  return way !== null && p !== CORE && q !== CORE && p !== q && (WAY[p] === way || WAY[q] === way);
}

function fits(bay: string, print: Print, anchor: number): boolean {
  const col = anchor % W;
  const row = Math.floor(anchor / W);
  if (col + print.w > W || row + print.h > H) return false;
  return print.parts.every((p) => {
    const k = bay[(row + p.dr) * W + col + p.dc]!;
    return k === CORE || k === p.kind;
  });
}

function findFit(bay: string, tray: Print[]): { slot: number; anchor: number } | null {
  for (let slot = 0; slot < tray.length; slot++) for (let a = 0; a < W * H; a++) if (fits(bay, tray[slot]!, a)) return { slot, anchor: a };
  return null;
}

const swapped = (bay: string, a: number, b: number): string => {
  const s = bay.split("");
  [s[a], s[b]] = [s[b]!, s[a]!];
  return s.join("");
};

/** A legal swap that moves a part of `kind` its own way, the swap that readies a fit first if there is one. */
function findSwap(bay: string, tray: Print[], kind?: string): { a: number; b: number } {
  const all: Array<{ a: number; b: number }> = [];
  for (let a = 0; a < W * H; a++) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const c = (a % W) + dc;
      const r = Math.floor(a / W) + dr;
      if (c < 0 || c >= W || r < 0 || r >= H) continue;
      const b = r * W + c;
      if (!legalSwap(bay, a, b)) continue;
      if (kind !== undefined && (bay[a] !== kind || WAY[kind] !== wayBetween(a, b))) continue;
      all.push({ a, b });
    }
  }
  const ready = all.find((s) => findFit(swapped(bay, s.a, s.b), tray) !== null);
  const pick = ready ?? all[0];
  if (!pick) throw new Error(`no swap on ${bay}`);
  return pick;
}

async function centre(page: Page, cell: number): Promise<[number, number]> {
  const { ox, oy, cell: size } = await boardGeom(page, "assembly");
  return [ox + ((cell % W) + 0.5) * size, oy + (Math.floor(cell / W) + 0.5) * size];
}

async function drag(page: Page, a: number, b: number): Promise<void> {
  const [x0, y0] = await centre(page, a);
  const [x1, y1] = await centre(page, b);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + (x1 - x0) * 0.8, y0 + (y1 - y0) * 0.8, { steps: 6 });
  await page.mouse.up();
}

/** The middle of a tray slot, in page pixels, from the slots the canvas publishes. */
async function slotCentre(page: Page, slot: number): Promise<[number, number]> {
  const canvas = page.getByTestId("assembly-canvas");
  const geom = (await canvas.getAttribute("data-tray-geom")) ?? "";
  const [x, y, w, h] = geom.split(";")[slot]!.split(",").map(Number) as [number, number, number, number];
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  return [box.x + x + w / 2, box.y + y + h / 2];
}

/** Tap a blueprint in the tray, then tap the bay where its box's top left goes (the box centres on a tap). */
async function tapFit(page: Page, print: Print, slot: number, anchor: number): Promise<void> {
  const [sx, sy] = await slotCentre(page, slot);
  await page.mouse.click(sx, sy);
  const { ox, oy, cell } = await boardGeom(page, "assembly");
  await page.mouse.click(ox + ((anchor % W) + print.w / 2) * cell, oy + (Math.floor(anchor / W) + print.h / 2) * cell);
}

async function cursorTo(page: Page, cell: number): Promise<void> {
  const [col, row] = ((await page.getByTestId("assembly-canvas").getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  for (let c = col; c < cell % W; c++) await page.keyboard.press("ArrowRight");
  for (let c = col; c > cell % W; c--) await page.keyboard.press("ArrowLeft");
  for (let r = row; r < Math.floor(cell / W); r++) await page.keyboard.press("ArrowDown");
  for (let r = row; r > Math.floor(cell / W); r--) await page.keyboard.press("ArrowUp");
}

/** A swap that readies a fit, made on the page, when nothing fits yet. Returns the moves made. */
async function readyAFit(page: Page, moves: number): Promise<number> {
  let n = moves;
  for (let i = 0; i < 6; i++) {
    const { bay, tray } = await read(page);
    if (findFit(bay, tray)) return n;
    const s = findSwap(bay, tray);
    await drag(page, s.a, s.b);
    n++;
    await expect(page.getByTestId("hud-moves").first()).toHaveText(String(n));
    await expectViewMatchesState(page, "assembly");
  }
  throw new Error("no fit readied");
}

test("Assembly plays alone on /play: swaps and fits by key and by pointer", async ({ page }) => {
  await page.goto("/play/assembly?seed=smoke-1");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("assembly-canvas")).toBeVisible();
  await expect(page.getByTestId("hud-moves").first()).toHaveText("0");
  await expectViewMatchesState(page, "assembly");
  let moves = 0;

  // Keyboard: hold a girder and swap it sideways.
  {
    const { bay, tray } = await read(page);
    const s = findSwap(bay, tray, "1");
    await cursorTo(page, s.a);
    await page.keyboard.press(" ");
    await page.keyboard.press(s.b > s.a ? "ArrowRight" : "ArrowLeft");
    await expect(page.getByTestId("hud-moves").first()).toHaveText(String(++moves));
    await expectViewMatchesState(page, "assembly");
  }

  // Pointer: drag a strut up or down onto its neighbour.
  {
    const { bay, tray } = await read(page);
    const s = findSwap(bay, tray, "2");
    await drag(page, s.a, s.b);
    await expect(page.getByTestId("hud-moves").first()).toHaveText(String(++moves));
    await expectViewMatchesState(page, "assembly");
  }

  // Pointer: one drag carries a part two cells its own way, swapping as it goes, with no lift between.
  {
    const { bay } = await read(page);
    const at = (c: number, dc: number, dr: number): number => {
      const col = (c % W) + dc;
      const row = Math.floor(c / W) + dr;
      return col >= 0 && col < W && row >= 0 && row < H ? row * W + col : -1;
    };
    let path: [number, number, number] | null = null;
    for (let c = 0; c < W * H && !path; c++) {
      const kind = bay[c]!;
      const dirs = kind === "1" ? [[1, 0], [-1, 0]] : kind === "2" ? [[0, 1], [0, -1]] : kind === "3" ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : [];
      for (const [dc, dr] of dirs as Array<[number, number]>) {
        const b1 = at(c, dc, dr);
        const b2 = at(c, 2 * dc, 2 * dr);
        const ok = (k: number): boolean => k >= 0 && bay[k] !== kind && bay[k] !== CORE;
        if (ok(b1) && ok(b2)) {
          path = [c, b1, b2];
          break;
        }
      }
    }
    expect(path, `a part with room to go two cells on ${bay}`).not.toBeNull();
    const [a, , end] = path!;
    const kind = bay[a]!;
    const [x0, y0] = await centre(page, a);
    const [x2, y2] = await centre(page, end);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 24 });
    await page.mouse.up();
    moves += 2;
    await expect(page.getByTestId("hud-moves").first()).toHaveText(String(moves));
    await expectViewMatchesState(page, "assembly");
    expect((await read(page)).bay[end]).toBe(kind);
  }

  // Pointer: tap a blueprint, then tap the bay where it fits.
  moves = await readyAFit(page, moves);
  {
    const { bay, tray } = await read(page);
    const f = findFit(bay, tray)!;
    await tapFit(page, tray[f.slot]!, f.slot, f.anchor);
    await expect(page.getByTestId("hud-moves").first()).toHaveText(String(++moves));
    await expect(page.getByTestId("hud-score").first()).not.toHaveText("0");
    await expectViewMatchesState(page, "assembly");
  }

  // Keyboard: a number picks a blueprint, the arrows place it, enter fits it.
  moves = await readyAFit(page, moves);
  {
    const { bay, tray } = await read(page);
    const f = findFit(bay, tray)!;
    await page.keyboard.press(String(f.slot + 1));
    await cursorTo(page, f.anchor);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("hud-moves").first()).toHaveText(String(++moves));
    await expectViewMatchesState(page, "assembly");
  }
});

test("an Assembly stage plays from its address: its name in the HUD, its card on the start card, its numbers on the board (ADR 0066)", async ({ page }) => {
  await page.goto("/play/assembly?stage=parts&seed=smoke-2");
  await expect(page.getByTestId("stage-intro")).toHaveAttribute("data-stage", "parts");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("assembly-canvas")).toBeVisible();
  await expect(page.getByTestId("hud-stage").first()).toHaveAttribute("data-stage", "parts");
  // The first stage deals no core and runs a minute.
  await expect(page.getByTestId("assembly-board")).toHaveAttribute("data-board", /^[0-3]+\//);
  await expect(page.getByTestId("hud-time").first()).toHaveText(/^(2:00|1:5\d)$/);
  const { bay, tray } = await read(page);
  const s = findSwap(bay, tray);
  await drag(page, s.a, s.b);
  await expect(page.getByTestId("hud-moves").first()).toHaveText("1");
  await expectViewMatchesState(page, "assembly");
});
