import { expect, test, type Page } from "@playwright/test";

/**
 * Swap on the new engine (ADR 0092): the page is reached from home, the board is drawn from the
 * round's events alone and holds what the engine holds, and it plays by pointer and by key.
 */

interface Shown {
  board: string;
  view: string;
  score: number;
  busy: boolean;
}
const shown = (page: Page): Promise<Shown> =>
  page.evaluate(() => {
    const hud = document.querySelector<HTMLElement>('[data-testid="rung-board"]')!;
    const canvas = document.querySelector<HTMLElement>('[data-testid="rung-canvas"]')!;
    return { board: hud.dataset.board!, view: canvas.dataset.view!, score: Number(hud.dataset.score), busy: hud.dataset.busy === "1" };
  });

/** Once a move has played out, what the events drew is what the engine holds. */
async function settled(page: Page): Promise<Shown> {
  let last!: Shown;
  await expect(async () => {
    last = await shown(page);
    expect(last.busy).toBe(false);
    expect(last.view).toBe(last.board);
  }).toPass({ timeout: 15_000 });
  return last;
}

const rows = (board: string): number[][] => board.split("/").map((row) => [...row].map(Number));

/** A swap that lines up three: found on the board as the page shows it, the way a player would. */
function scoringSwap(board: string): { a: [number, number]; b: [number, number] } {
  const g = rows(board);
  const lines = (h: number[][]): boolean => {
    for (let y = 0; y < h.length; y++) for (let x = 0; x < h[0]!.length; x++) {
      const k = h[y]![x]!;
      if (x + 2 < h[0]!.length && h[y]![x + 1] === k && h[y]![x + 2] === k) return true;
      if (y + 2 < h.length && h[y + 1]![x] === k && h[y + 2]![x] === k) return true;
    }
    return false;
  };
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0]!.length; x++) {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const [bx, by] = [x + dx, y + dy];
      if (by >= g.length || bx >= g[0]!.length || g[y]![x] === g[by]![bx]) continue;
      const h = g.map((row) => [...row]);
      [h[y]![x], h[by]![bx]] = [h[by]![bx]!, h[y]![x]!];
      if (lines(h)) return { a: [x, y], b: [bx, by] };
    }
  }
  throw new Error("the board has no scoring swap");
}

async function centre(page: Page, board: string, [x, y]: [number, number]): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId("rung-canvas").boundingBox())!;
  const g = rows(board);
  return { x: box.x + ((x + 0.5) * box.width) / g[0]!.length, y: box.y + ((y + 0.5) * box.height) / g.length };
}

test("Swap on the new engine is reached from home and opens on a dealt board", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tile-rung-swap").click();
  await expect(page.getByTestId("rung-swap")).toBeVisible();
  const first = await settled(page);
  expect(first.score).toBe(0);
  expect(first.board).toMatch(/^([1-5]{6}\/){6}[1-5]{6}$/);
  // The same seed deals the same board.
  await page.goto("/rungs/swap?seed=1");
  expect((await settled(page)).board).toBe(first.board);
  // Nothing is hidden: the page prints which part answers each hook, and the whole document.
  await page.getByTestId("rung-explain").locator("summary").click();
  await expect(page.getByTestId("rung-explain").locator("pre")).toContainText("onCascade  lines, then refill");
  await page.getByTestId("rung-expand").locator("summary").click();
  await expect(page.getByTestId("rung-expand").locator("pre")).toContainText('"id": "swap"');
});

test("Swap plays by pointer: a drag swaps, scores, and the board the events drew is the engine's", async ({ page }) => {
  await page.goto("/rungs/swap?seed=3");
  const before = await settled(page);
  const { a, b } = scoringSwap(before.board);
  const from = await centre(page, before.board, a);
  const to = await centre(page, before.board, b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("rung-board")).toContainText("19 moves left");
  const after = await settled(page);
  expect(after.score).toBeGreaterThanOrEqual(3);
  expect(after.board).not.toBe(before.board);
  // A swap of two pieces that are not side by side is refused with the rules' reason, and changes nothing.
  const far = await centre(page, after.board, [0, 0]);
  const off = await centre(page, after.board, [3, 3]);
  await page.mouse.click(far.x, far.y);
  await page.mouse.click(off.x, off.y);
  await expect(page.getByTestId("rung-says")).toHaveText("Pick two pieces side by side.");
  expect((await settled(page)).board).toBe(after.board);
});

test("Swap plays by key: arrows move, space picks, an arrow swaps", async ({ page }) => {
  await page.goto("/rungs/swap?seed=5");
  const before = await settled(page);
  const { a, b } = scoringSwap(before.board);
  await page.getByTestId("rung-canvas").focus();
  for (let i = 0; i < a[0]; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < a[1]; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await page.keyboard.press(b[0] > a[0] ? "ArrowRight" : "ArrowDown");
  await expect(page.getByTestId("rung-board")).toContainText("19 moves left");
  const after = await settled(page);
  expect(after.score).toBeGreaterThanOrEqual(3);
  // A new round deals another board, on a score of nothing.
  await page.getByTestId("rung-new").click();
  await expect(page.getByTestId("rung-board")).toContainText("20 moves left");
  const next = await settled(page);
  expect(next.score).toBe(0);
  expect(next.board).not.toBe(after.board);
});

// Cooling, Paths and Gunnery on the new engine play on their shipped pages (ADR 0097). Their rounds are driven by
// the shipped smoke of each board, which runs on both engines; this holds only that the pages are reached.
for (const [id, canvas] of [["cooling", "cooling-canvas"], ["paths", "salvage-canvas"], ["gunnery", "gunnery-canvas"]] as const) {
  test(`${id} on the new engine is reached from home, on its shipped board`, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId(`tile-rung-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`/rungs/${id}$`));
    await expect(page.getByTestId(canvas)).toBeVisible();
    await expect(page.getByText("On the new engine", { exact: true }).first()).toBeVisible();
  });
}
