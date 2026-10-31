import { expect, test, type Page } from "@playwright/test";

/**
 * Once the board settles, what the canvas draws must be the engine's board, piece for piece. Both
 * attributes are read in one evaluation so a board that advances on a clock cannot change between
 * the reads, and so a slow CI runner spends one round trip per poll, not two.
 */
async function expectViewMatchesState(page: Page, puzzle: string): Promise<void> {
  await expect(async () => {
    const [want, shown] = await page.evaluate(
      (id) => [
        document.querySelector(`[data-testid="${id}-board"]`)?.getAttribute("data-board") ?? null,
        document.querySelector(`[data-testid="${id}-canvas"]`)?.getAttribute("data-view") ?? null,
      ],
      puzzle,
    );
    expect(want).toBeTruthy();
    expect(shown).toBe(want);
  }).toPass({ timeout: 15_000 });
}

/**
 * Smoke: the client builds, loads, and a Bilging round is playable without the server (unrated).
 * Rated play needs the server and is covered by the server integration test.
 */
test("home page renders and links to Bilging practice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "openseas" })).toBeVisible();
  await page.getByRole("link", { name: /Bilging/ }).click();
  await expect(page).toHaveURL(/\/practice\/bilging$/);
  await expect(page.getByTestId("start-unrated")).toBeVisible();
});

test("an unrated Bilging round accepts a keyboard swap and shows the result", async ({ page }) => {
  await page.goto("/practice/bilging");
  await page.getByTestId("start-unrated").click();
  const canvas = page.getByTestId("bilging-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toContainText("0");
  // The round's board replaces the preview board behind the start card.
  await expectViewMatchesState(page, "bilging");

  // Keyboard: put the cursor somewhere and swap with the piece to the right.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await expectViewMatchesState(page, "bilging");

  // Pointer: tap two horizontally adjacent cells.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const cell = Math.min(box.width / 6, box.height / 12);
  const ox = box.x + (box.width - cell * 6) / 2;
  const oy = box.y + (box.height - cell * 12) / 2;
  await page.mouse.click(ox + cell * 0.5, oy + cell * 11.5);
  await page.mouse.click(ox + cell * 1.5, oy + cell * 11.5);
  await expect(page.getByTestId("hud-moves")).toContainText("2");
});

test("home links to Sailing practice and an unrated round takes keyboard drops", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Sailing/ }).click();
  await expect(page).toHaveURL(/\/practice\/sailing$/);
  await page.getByTestId("start-unrated").click();
  const canvas = page.getByTestId("sailing-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toContainText("0");

  // Steer, rotate, hard drop.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await expectViewMatchesState(page, "sailing");

  // Pointer: a tap turns the pair, a sideways drag steers it; then a key drops it.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.3;
  await page.mouse.click(x, y);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * 0.2, y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("2");
});

test("home links to Carpentry practice and planks go down by keyboard and by tap", async ({ page }) => {
  // The plank tray and board redraw are the heaviest canvas in the suite on the phone profile.
  test.slow();
  await page.goto("/");
  await page.getByRole("link", { name: /Carpentry/ }).click();
  await expect(page).toHaveURL(/\/practice\/carpentry$/);
  await page.getByTestId("start-unrated").click();
  const canvas = page.getByTestId("carpentry-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toContainText("0");
  const settled = (): Promise<void> => expectViewMatchesState(page, "carpentry");
  await settled();

  // Keyboard: pick plank 1, jump to a spot it fits, nail it down.
  await page.keyboard.press("1");
  await page.keyboard.press("h");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await settled();

  // Pointer: pick plank 2, find a fit by keyboard, then click the middle of the ghost to nail it.
  await page.keyboard.press("2");
  await page.keyboard.press("h");
  await expect.poll(() => canvas.getAttribute("data-ghost")).toMatch(/^\d+,\d+,\d+,\d+$/);
  const [col, row, w, h] = (await canvas.getAttribute("data-ghost"))!.split(",").map(Number);
  const [ox, oy, cell] = (await canvas.getAttribute("data-geometry"))!.split(",").map(Number);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.click(box.x + ox! + (col! + w! / 2) * cell!, box.y + oy! + (row! + h! / 2) * cell!);
  await expect(page.getByTestId("hud-moves")).toContainText("2");
});

test("home links to Gunnery practice and an unrated round takes arrows by key and by tap", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Gunnery/ }).click();
  await expect(page).toHaveURL(/\/practice\/gunnery$/);
  await page.getByTestId("start-unrated").click();
  const canvas = page.getByTestId("gunnery-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toContainText("0");

  // Keyboard: lay an arrow pointing right at the cursor.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("d");
  await expect(page.getByTestId("hud-moves")).toContainText("1");

  // Pointer: tap a deck cell near the top-left of the deck.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const cell = Math.min(box.width / 9, box.height / 11);
  const ox = box.x + (box.width - cell * 9) / 2;
  const oy = box.y + (box.height - cell * 11) / 2;
  await page.mouse.click(ox + cell * 1.5, oy + cell * 1.5);
  await expect(page.getByTestId("hud-moves")).toContainText("2");
  // The deck the canvas shows is the deck the engine holds.
  await expect(async () => {
    const want = await page.getByTestId("gunnery-board").getAttribute("data-board");
    expect(await canvas.getAttribute("data-view")).toBe(want);
  }).toPass({ timeout: 10_000 });
});
