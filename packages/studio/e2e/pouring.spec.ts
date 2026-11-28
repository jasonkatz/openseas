import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content bar: six squares a side, two characters a square in the board string. */
const N = 6;

async function boardString(page: Page): Promise<string> {
  const board = await page.getByTestId("pouring-board").getAttribute("data-board");
  if (!board || board.length !== N * N * 2) throw new Error(`unexpected board ${board}`);
  return board;
}

/** An empty square with no drink beside it: anything that is not a rag may be poured there. */
function lonely(board: string): number {
  const at = (c: number): string => board.slice(c * 2, c * 2 + 2);
  for (let c = 0; c < N * N; c++) {
    if (at(c) !== "..") continue;
    const col = c % N;
    const row = Math.floor(c / N);
    const near = [row > 0 ? c - N : -1, col < N - 1 ? c + 1 : -1, row < N - 1 ? c + N : -1, col > 0 ? c - 1 : -1].filter((n) => n >= 0);
    if (near.every((n) => at(n) === "..")) return c;
  }
  throw new Error(`no lonely square on ${board}`);
}

/** The HUD reads turns taken of the round's turns: "1/20". */
const turns = (n: number): RegExp => new RegExp(`^${n}(/|$)`);

async function tap(page: Page, cell: number): Promise<void> {
  const { ox, oy, cell: size } = await boardGeom(page, "pouring");
  await page.mouse.click(ox + ((cell % N) + 0.5) * size, oy + (Math.floor(cell / N) + 0.5) * size);
}

for (const [path, on] of [["/play/pouring", ""], ["/play/rungs/pouring", ", on the new engine"]] as const) test(`Pouring plays alone on /play: a turn by key, by tap and a drink downed${on}`, async ({ page }) => {
  // This seed deals the player a drink in the first slot, so the first pour is one any square takes.
  await page.goto(`${path}?seed=smoke-2`);
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("pouring-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText(turns(0));
  await expectViewMatchesState(page, "pouring");

  // Keyboard: pick the first drink, walk the cursor to the middle of the bar and pour.
  await page.keyboard.press("1");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(canvas).toHaveAttribute("data-cursor", "2,2");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toHaveText(turns(1));
  await expectViewMatchesState(page, "pouring");
  expect((await boardString(page)).slice((2 * N + 2) * 2, (2 * N + 2) * 2 + 2)).not.toBe("..");

  // Pointer: a tap on a square with nothing beside it pours the picked drink there. A rag cannot
  // pour on an empty square, so the other slot is tried when the first will not go.
  const target = lonely(await boardString(page));
  await tap(page, target);
  await page.waitForTimeout(400);
  if (turns(1).test((await page.getByTestId("hud-moves").textContent()) ?? "")) {
    await page.keyboard.press("2");
    await tap(page, target);
  }
  await expect(page.getByTestId("hud-moves")).toHaveText(turns(2));
  await expectViewMatchesState(page, "pouring");

  // X downs the picked drink: a turn with nothing poured.
  const before = await boardString(page);
  await page.keyboard.press("x");
  await expect(page.getByTestId("hud-moves")).toHaveText(/^[34](\/|$)/);
  await expectViewMatchesState(page, "pouring");
  expect((await boardString(page)).length).toBe(before.length);
});

test("a Pouring stage plays from its address: its name in the HUD, its card on the start card (ADR 0066)", async ({ page }) => {
  await page.goto("/play/pouring?stage=lines&seed=smoke-2");
  await expect(page.getByTestId("stage-intro")).toHaveAttribute("data-stage", "lines");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("pouring-canvas")).toBeVisible();
  await expect(page.getByTestId("hud-stage").first()).toHaveAttribute("data-stage", "lines");
  await tap(page, 14);
  await expect(page.getByTestId("hud-moves").first()).toHaveText(turns(1));
  await expectViewMatchesState(page, "pouring");
});
