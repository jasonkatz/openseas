import { expect, test, type Page } from "@playwright/test";
import { boardString, swapEngine, type Move, type Round, type SwapState } from "@openseas/puzzle";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/**
 * The domain engine's first puzzle, played in the studio (ADR 0088). The test runs the same round
 * beside the page, with the same engine, seed and stage, so it knows which swap scores and what
 * board each swap must leave: the page's board, drawn from the round's events alone, has to be
 * that board, piece for piece.
 */
const SCALE = { floor: 1000, steady: 1300, sharp: 1600, masterful: 1900, legendary: 2200, ceiling: 2500 };
const engine = swapEngine({ scale: SCALE });
const SEED = "smoke";

function dealt(stage: string): Round<SwapState> {
  return engine.start(SEED, engine.settings({ stage }));
}

/** The swap worth most on this board, and the round after it. */
function best(round: Round<SwapState>, at: number): { move: Move; round: Round<SwapState>; points: number } {
  const { width, height } = round.board;
  let found: { move: Move; round: Round<SwapState>; points: number } | null = null;
  for (let cell = 0; cell < width * height; cell++) {
    if (cell % width === width - 1) continue;
    const move: Move = { id: "swap", at: cell, to: "right" };
    const next = engine.play(round, { at, move }).round;
    const points = next.score - round.score;
    if (!found || points > found.points) found = { move, round: next, points };
  }
  return found!;
}

async function open(page: Page, stage: string): Promise<void> {
  await page.goto(`/play/swap?seed=${SEED}&stage=${stage}`);
  await expect(page.getByTestId("domain-start")).toBeVisible();
  await expect(page.getByTestId("swap-board")).toHaveAttribute("data-board", boardString(dealt(stage).board));
  await expectViewMatchesState(page, "swap");
}

test("the grid lists the domain engine's puzzle and opens it alone", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tile-swap").click();
  await expect(page).toHaveURL(/\/play\/swap$/);
  await expect(page.getByTestId("domain-start")).toBeVisible();
  await expect(page.getByTestId("swap-canvas")).toHaveAttribute("data-pieces", "drawn");
});

test("a swipe plays a swap, and the board drawn from its events is the round's board", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "full");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("play")).toHaveAttribute("data-phase", "playing");

  let round = dealt("full");
  for (let n = 1; n <= 4; n++) {
    // The page stamps the swap with its own clock; a swap's board does not depend on when it was made.
    const step = best(round, round.at);
    const { ox, oy, cell } = await boardGeom(page, "swap");
    const from = step.move.at as number;
    const x = ox + ((from % round.board.width) + 0.5) * cell;
    const y = oy + (Math.floor(from / round.board.width) + 0.5) * cell;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + cell * 0.6, y, { steps: 3 });
    await page.mouse.up();
    round = step.round;
    await expect(page.getByTestId("swap-board")).toHaveAttribute("data-seq", String(n));
    await expect(page.getByTestId("swap-board")).toHaveAttribute("data-board", boardString(round.board));
    await expectViewMatchesState(page, "swap");
    await expect(page.getByTestId("hud-score")).toContainText(String(round.score));
  }
  expect(round.score).toBeGreaterThan(0);
  // The events never left the board somewhere the round was not.
  await expect(page.getByTestId("swap-canvas")).not.toHaveAttribute("data-drift", "1");
  expect(errors).toEqual([]);
});

test("the keys play a swap, and a tap on a piece and then its neighbour does too", async ({ page }) => {
  await open(page, "runs");
  await expect(page.getByTestId("hud-stage")).toHaveAttribute("data-stage", "runs");
  await page.getByTestId("play-start").click();
  let round = dealt("runs");
  const width = round.board.width;

  // Keys: walk the cursor from the top left to the piece, pick it up, swap it right.
  let step = best(round, round.at);
  const from = step.move.at as number;
  for (let i = 0; i < Math.floor(from / width); i++) await page.keyboard.press("ArrowDown");
  for (let i = 0; i < from % width; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  round = step.round;
  await expect(page.getByTestId("swap-board")).toHaveAttribute("data-board", boardString(round.board));
  await expectViewMatchesState(page, "swap");

  // Taps: the piece, then the one on its right.
  step = best(round, round.at);
  const { ox, oy, cell } = await boardGeom(page, "swap");
  const at = step.move.at as number;
  const x = ox + ((at % width) + 0.5) * cell;
  const y = oy + (Math.floor(at / width) + 0.5) * cell;
  await page.mouse.click(x, y);
  await page.mouse.click(x + cell, y);
  round = step.round;
  await expect(page.getByTestId("swap-board")).toHaveAttribute("data-board", boardString(round.board));
  await expectViewMatchesState(page, "swap");
});

test("a round runs to its clock, is judged, and replays from its log to the same score", async ({ page }) => {
  await page.clock.install();
  await open(page, "chains");
  await page.getByTestId("play-start").click();
  const round = dealt("chains");
  const step = best(round, 0);
  const { ox, oy, cell } = await boardGeom(page, "swap");
  const at = step.move.at as number;
  const x = ox + ((at % round.board.width) + 0.5) * cell;
  const y = oy + (Math.floor(at / round.board.width) + 0.5) * cell;
  await page.mouse.click(x, y);
  await page.mouse.click(x + cell, y);
  await expect(page.getByTestId("hud-score")).toContainText(String(step.round.score));

  await page.clock.fastForward(151_000);
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("result-score")).toHaveText(String(step.round.score), { timeout: 10_000 });
  await expect(page.getByTestId("replay-verified")).toBeVisible();
  await expect(page.getByTestId("result-tier")).toHaveAttribute("data-tier", engine.read(engine.mark(step.round, 150_000).round).tier!);
  await expect(page.getByTestId("stat-swaps")).toHaveText("1");

  await page.getByTestId("change-stage").click();
  await page.getByTestId("stage-specials").click();
  await expect(page.getByTestId("swap-board")).toHaveAttribute("data-board", boardString(dealt("specials").board));
});
