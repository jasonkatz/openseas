import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content slab: six by six. */
const W = 6;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The pieces on the table, read off the board string the page publishes: cells, `;`, then every piece as x.y.w.h. */
async function pieces(page: Page): Promise<Rect[]> {
  const board = (await page.getByTestId("cutting-board").getAttribute("data-board")) ?? "";
  const [cells, rects] = board.split(";");
  if (!cells || cells.length !== W * W || !rects) throw new Error(`unexpected board ${board}`);
  return rects.split(",").map((r) => {
    const [x, y, w, h] = r.split(".").map(Number) as [number, number, number, number];
    return { x, y, w, h };
  });
}

const cutsMade = async (page: Page): Promise<number> => Number((await page.getByTestId("hud-moves").textContent())?.trim() ?? "0");

test("Cutting plays alone on /play: a round cuts by key, by swipe and by two taps", async ({ page }) => {
  await page.goto("/play/cutting");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("cutting-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "cutting");
  // A fresh slab is one whole piece.
  expect(await pieces(page)).toEqual([{ x: 0, y: 0, w: W, h: W }]);

  // Keyboard: the first key lines a cut up down the middle, right moves it a column, enter makes it.
  await page.keyboard.press("ArrowRight");
  await expect(canvas).toHaveAttribute("data-cursor", /^\d+,1,3$/);
  await page.keyboard.press("ArrowRight");
  await expect(canvas).toHaveAttribute("data-cursor", /^\d+,1,4$/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "cutting");

  // Pointer: swipe across the largest piece still on the table, along a row line through its middle.
  // A cut can end the slab, so the piece is read fresh each time and the count only has to rise.
  const swipe = async (): Promise<void> => {
    const { ox, oy, cell } = await boardGeom(page, "cutting");
    const p = (await pieces(page)).filter((r) => r.h >= 2).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!p) throw new Error("no piece tall enough to cut across");
    const y = oy + (p.y + Math.ceil(p.h / 2)) * cell;
    await page.mouse.move(ox + (p.x + 0.2) * cell, y);
    await page.mouse.down();
    await page.mouse.move(ox + (p.x + p.w - 0.2) * cell, y, { steps: 8 });
    await page.mouse.up();
  };
  const before = await cutsMade(page);
  await swipe();
  await expect.poll(() => cutsMade(page)).toBe(before + 1);
  await expectViewMatchesState(page, "cutting");

  // Two taps: the first lines the nearest line up, the second on the same line makes the cut.
  const tapTwice = async (): Promise<void> => {
    const { ox, oy, cell } = await boardGeom(page, "cutting");
    const p = (await pieces(page)).filter((r) => r.w >= 2).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!p) throw new Error("no piece wide enough to cut down");
    const x = ox + (p.x + 1) * cell + 2;
    const y = oy + (p.y + p.h / 2) * cell + (p.h % 2 === 0 ? cell * 0.4 : 0);
    await page.mouse.click(x, y);
    await expect(canvas).toHaveAttribute("data-cursor", new RegExp(`^\\d+,1,${p.x + 1}$`));
    await page.mouse.click(x, y);
  };
  const beforeTap = await cutsMade(page);
  await tapTwice();
  await expect.poll(() => cutsMade(page)).toBe(beforeTap + 1);
  await expectViewMatchesState(page, "cutting");
});

test("a Cutting slab given up is graded and the next one is dealt", async ({ page }) => {
  await page.goto("/play/cutting?seed=smoke-1&start=lab");
  const canvas = page.getByTestId("cutting-canvas");
  await expect(canvas).toBeVisible();
  await expectViewMatchesState(page, "cutting");
  const board = page.getByTestId("cutting-board");
  await expect(board).toHaveAttribute("data-slab", "0");
  const first = await board.getAttribute("data-board");
  // D gives the slab up: no cut is counted, the slab number moves on and a new slab is on the table.
  await page.keyboard.press("d");
  await expect(board).toHaveAttribute("data-slab", "1");
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "cutting");
  expect(await board.getAttribute("data-board")).not.toBe(first);
  expect(await pieces(page)).toEqual([{ x: 0, y: 0, w: W, h: W }]);
});
