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

test("Reactor plays alone on /play: a round swipes by key and by pointer", async ({ page }) => {
  await page.goto("/play/reactor");
  await page.getByTestId("play-start").click();
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
  await page.goto("/play/reactor?seed=port-1&start=lab");
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

test("the Reactor pressure gauge is the engine's, warns a swipe before its limit, and scrams the core on its own word", async ({ page }) => {
  // A core that cooks fast: every rod enters at grade 2 and grade 3 is hot, so hot rods pile up.
  // The lamps hold nine, so the gauge, at four, is what scrams it.
  await page.goto("/play/reactor?seed=press-1&c.hotGrade=3&c.fusePoints=[2,8]&c.twoPermille=1000&c.criticalHot=9&c.pressureLimit=4&start=1");
  const canvas = page.getByTestId("reactor-canvas");
  await expect(canvas).toBeVisible();
  const board = page.getByTestId("reactor-board");
  const hud = page.getByTestId("hud-pressure");
  await expect(hud).toHaveAttribute("data-pressure", "0:4");
  await expect(canvas).toHaveAttribute("data-pressure", "0:4");
  // A fusion that makes a third hot rod can jump the gauge past its warning, so play on until a
  // warning has been seen and a scram on pressure has followed.
  let warned = false;
  let scrammed = false;
  for (let n = 1; n <= 40 && !(warned && scrammed); n++) {
    await page.keyboard.press(KEYS[await legalDir(page)]!);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(n));
    const reading = (await board.getAttribute("data-pressure"))!;
    await expect(hud).toHaveAttribute("data-pressure", reading);
    // The canvas draws the same reading once the swipe has played, with a w while it warns.
    await expect(canvas).toHaveAttribute("data-pressure", new RegExp(`^${reading}w?$`));
    if ((await canvas.getAttribute("data-pressure"))!.endsWith("w")) {
      warned = true;
      await expect(hud).toHaveText(/vent now/);
    }
    scrammed = warned && (await board.getAttribute("data-scram")) === "pressure";
  }
  expect(warned).toBe(true);
  expect(scrammed).toBe(true);
  await expect(board).toHaveAttribute("data-pressure", "0:4");
  await expectViewMatchesState(page, "reactor");
});

test("a Reactor stage before the whole puzzle plays from its address with no gauge (ADR 0066)", async ({ page }) => {
  await page.goto("/play/reactor?stage=salvo");
  await expect(page.getByTestId("stage-intro")).toHaveAttribute("data-stage", "salvo");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("reactor-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-stage").first()).toHaveAttribute("data-stage", "salvo");
  await expect(canvas).toHaveAttribute("data-pressure", "");
  await expect(page.getByTestId("hud-pressure")).toHaveCount(0);
  await page.keyboard.press(KEYS[await legalDir(page)]!);
  await expect(page.getByTestId("hud-moves").first()).toHaveText("1");
  await expectViewMatchesState(page, "reactor");
});
