import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content bay: seven by seven. */
const W = 7;
const H = 7;

/** Columns and rows a flick steps by, and its arrow key: up, right, down, left. */
const DIRS = [
  { dx: 0, dy: -1, key: "ArrowUp" },
  { dx: 1, dy: 0, key: "ArrowRight" },
  { dx: 0, dy: 1, key: "ArrowDown" },
  { dx: -1, dy: 0, key: "ArrowLeft" },
] as const;

async function boardString(page: Page): Promise<string> {
  const board = await page.getByTestId("tug-board").getAttribute("data-board");
  if (!board || board.indexOf("|") !== W * H) throw new Error(`unexpected board ${board}`);
  return board;
}

/** A pod with a free cell beside it and the way to it, read off the board string: a flick the engine will take. */
function freeFlick(board: string, skipPod = -1): { pod: number; cell: number; dir: (typeof DIRS)[number] } {
  for (let cell = 0; cell < W * H; cell++) {
    const ch = board[cell]!;
    if (!/\d/.test(ch) || Number(ch) === skipPod) continue;
    for (const dir of DIRS) {
      const col = (cell % W) + dir.dx;
      const row = Math.floor(cell / W) + dir.dy;
      if (col >= 0 && col < W && row >= 0 && row < H && board[row * W + col] === ".") return { pod: Number(ch), cell, dir };
    }
  }
  throw new Error(`no pod can move on ${board}`);
}

test("Tug plays alone on /play: a round flicks a pod by key and by swipe", async ({ page }) => {
  await page.goto("/play/tug");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("tug-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "tug");

  // Keyboard: pick a pod by its number and flick it with an arrow.
  const byKey = freeFlick(await boardString(page));
  await page.keyboard.press(String(byKey.pod + 1));
  await expect(canvas).toHaveAttribute("data-selected", String(byKey.pod));
  await page.keyboard.press(byKey.dir.key);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "tug");

  // Pointer: swipe from another pod the way it can go.
  const bySwipe = freeFlick(await boardString(page), byKey.pod);
  const { ox, oy, cell } = await boardGeom(page, "tug");
  const x = ox + ((bySwipe.cell % W) + 0.5) * cell;
  const y = oy + (Math.floor(bySwipe.cell / W) + 0.5) * cell;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + bySwipe.dir.dx * cell * 0.8, y + bySwipe.dir.dy * cell * 0.8, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expect(canvas).toHaveAttribute("data-selected", String(bySwipe.pod));
  await expectViewMatchesState(page, "tug");
});

test("a Tug clamp delivered at par scores clean, and a skip costs its penalty", async ({ page }) => {
  // A pinned lab seed: the first clamp wants pod 1 of 4 on a cell it reaches in two flicks, with pod 2
  // parked first as its stop. A second clamp is lit beside it, for pod 3.
  await page.goto("/play/tug?seed=tug-2&start=lab");
  const canvas = page.getByTestId("tug-canvas");
  await expect(canvas).toBeVisible();
  await expectViewMatchesState(page, "tug");
  await expect(page.getByTestId("tug-board")).toHaveAttribute("data-board", /\|30:0\|21:2$/);
  await page.keyboard.press("2");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await page.keyboard.press("1");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  // Par two is worth 25, doubled for a clean delivery; another clamp lights.
  await expect(page.getByTestId("hud-score")).toHaveText("50");
  await expect(page.getByTestId("tug-board")).not.toHaveAttribute("data-board", /\|30:0\|21:2$/);
  await expectViewMatchesState(page, "tug");
  // Skipping takes 15, gives up both lit clamps and makes no flick.
  await page.keyboard.press("x");
  await expect(page.getByTestId("hud-score")).toHaveText("35");
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expectViewMatchesState(page, "tug");
});

test("a Tug delivery that hands off: the clamp left lit comes closer and still pays as it lit", async ({ page }) => {
  // A pinned lab seed with pairs: pod 0 is flicked across to the wall, where it stops pod 1 on its
  // clamp (par two), and the delivery leaves pod 0 a flick above its own clamp, lit at par two.
  await page.goto("/play/tug?seed=tug-44&start=lab");
  const canvas = page.getByTestId("tug-canvas");
  await expect(canvas).toBeVisible();
  const hud = page.getByTestId("hud-clamp");
  await expect(page.getByTestId("tug-board")).toHaveAttribute("data-board", /\|40:1\|48:0$/);
  await expect(hud).toHaveAttribute("data-clamps", "1:2:2|0:2:2");
  await page.keyboard.press("1");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await page.keyboard.press("2");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-score")).toHaveText("50");
  // The handoff: pod 0's clamp is now par one, and pays as the par two it lit at.
  await expect(hud).toHaveAttribute("data-clamps", /^0:1:2\|/);
  await expect(page.getByTestId("tug-board")).toHaveAttribute("data-board", /\|48:0\|\d+:\d$/);
  await expectViewMatchesState(page, "tug");
  // The board picked pod 0 for its nearer clamp: one flick down delivers it, clean, as a par two with the streak.
  await expect(canvas).toHaveAttribute("data-selected", "0");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("hud-score")).toHaveText(/^107/);
  await expectViewMatchesState(page, "tug");
});

test("a Tug stage before pairs plays from its address with one clamp (ADR 0066)", async ({ page }) => {
  await page.goto("/play/tug?stage=stops");
  await expect(page.getByTestId("stage-intro")).toHaveAttribute("data-stage", "stops");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("tug-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-stage").first()).toHaveAttribute("data-stage", "stops");
  await expect(page.getByTestId("tug-board")).toHaveAttribute("data-board", /^[^|]*\|\d+:\d$/);
  await expect(page.getByTestId("hud-clamp")).toHaveAttribute("data-clamps", /^\d:\d:\d$/);
  const flick = freeFlick(await boardString(page));
  await page.keyboard.press(String(flick.pod + 1));
  await page.keyboard.press(flick.dir.key);
  await expect(page.getByTestId("hud-moves").first()).toHaveText("1");
  await expectViewMatchesState(page, "tug");
});
