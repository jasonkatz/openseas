import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content core: four by four. */
const SIZE = 4;
/** The key and the pointer step for each direction: 0 up, 1 right, 2 down, 3 left. */
const KEYS = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"] as const;
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** A way the core will take a swipe right now, from the list the board publishes. */
async function legalDir(page: Page): Promise<number> {
  const board = page.getByTestId("reactor-board");
  await expect(board).toHaveAttribute("data-legal", /^[0-3]+$/);
  return Number(((await board.getAttribute("data-legal")) ?? "0")[0]);
}

test("home links to Reactor and an unrated round swipes by key and by pointer", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tile-reactor").click();
  await expect(page).toHaveURL(/\/reactor$/);
  await page.getByTestId("start-unrated").click();
  const canvas = page.getByTestId("reactor-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  // Two rods in the core and two ports on the rim, drawn as the engine holds them.
  await expect(page.getByTestId("reactor-board")).toHaveAttribute("data-board", /^[.1]{16}\|[0-3]\d,[0-3]\d$/);
  await expectViewMatchesState(page, "reactor");

  // Keyboard: an arrow swipes the core.
  await page.keyboard.press(KEYS[await legalDir(page)]!);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "reactor");

  // Pointer: a drag from the middle of the core swipes it.
  const dir = await legalDir(page);
  const { ox, oy, cell } = await boardGeom(page, "reactor");
  const cx = ox + (SIZE / 2) * cell;
  const cy = oy + (SIZE / 2) * cell;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + STEPS[dir]![0] * cell, cy + STEPS[dir]![1] * cell, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expectViewMatchesState(page, "reactor");
});

test("a Reactor hot rod pushed against its port is discharged", async ({ page }) => {
  // A pinned lab seed and the eight swipes that cook its first hot rod and push it out a port.
  await page.goto("/reactor?seed=port-1&start=lab");
  const canvas = page.getByTestId("reactor-canvas");
  await expect(canvas).toBeVisible();
  const board = page.getByTestId("reactor-board");
  await expect(board).toHaveAttribute("data-board", ".....1....1.....|10,23");
  await expectViewMatchesState(page, "reactor");
  const swipes = [0, 2, 0, 0, 2, 0, 1, 1];
  for (let i = 0; i < swipes.length; i++) {
    await page.keyboard.press(KEYS[swipes[i]!]!);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(i + 1));
  }
  // Seven fusions on the way (28 points) and one discharge at 100. The port it left by has moved.
  await expect(page.getByTestId("hud-score")).toHaveText("128");
  await expect(board).toHaveAttribute("data-board", "1.............21|23,33");
  await expectViewMatchesState(page, "reactor");
});
