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

  // A turned and flipped plank does not pass its orientation on: the next one picked comes out of
  // the tray the way the tray shows it.
  await page.keyboard.press("1");
  await page.keyboard.press("r");
  await page.keyboard.press("f");
  await expect(canvas).not.toHaveAttribute("data-orient", "0,0,0");
  await page.keyboard.press("2");
  await expect(canvas).toHaveAttribute("data-orient", "1,0,0");
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-orient", "-1,0,0");

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

test("home links to Gunnery practice and an unrated round lays arrows by key and by tap, and lifts one by tapping again", async ({ page }) => {
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
  // The renderer says where its grid sits on the canvas.
  const [gx, gy, cell] = ((await canvas.getAttribute("data-geom")) ?? "").split(",").map(Number) as [number, number, number];
  const ox = box.x + gx;
  const oy = box.y + gy;
  await page.mouse.click(ox + cell * 1.5, oy + cell * 1.5);
  await expect(page.getByTestId("hud-moves")).toContainText("2");
  // The view string ends with the arrows on deck as col.row.dir.
  const board = page.getByTestId("gunnery-board");
  await expect(board).toHaveAttribute("data-board", /\|(.*,)?1\.1\.\d(,.*)?$/);
  // The same tap again lifts that arrow.
  await page.mouse.click(ox + cell * 1.5, oy + cell * 1.5);
  await expect(page.getByTestId("hud-moves")).toContainText("3");
  await expect(board).not.toHaveAttribute("data-board", /\|(.*,)?1\.1\.\d(,.*)?$/);
  // The deck the canvas shows is the deck the engine holds.
  await expectViewMatchesState(page, "gunnery");
});

test("home links to Navigation practice and an unrated round turns a ring by key and brings stars down by key and by tap", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Navigation/ }).click();
  await expect(page).toHaveURL(/\/practice\/navigation$/);
  await page.getByTestId("start-unrated").click();
  const canvas = page.getByTestId("navigation-canvas");
  await expect(canvas).toBeVisible();
  // Stars come down on their own clock, so the count is only ever compared with a reading taken just before.
  const landed = async (): Promise<number> => Number((await page.getByTestId("hud-moves").textContent())?.trim() ?? "0");

  // Turn the selected ring, then bring the falling star down with enter.
  await page.keyboard.press("ArrowRight");
  const beforeKey = await landed();
  await page.keyboard.press("Enter");
  await expect.poll(landed).toBeGreaterThan(beforeKey);
  await expectViewMatchesState(page, "navigation");

  // Pointer: a tap on the compass rose in the center brings the next star down.
  const before = await landed();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const geom = (await canvas.getAttribute("data-geom"))?.split(",").map(Number);
  if (!geom || geom.length !== 3) throw new Error("no chart geometry");
  await page.mouse.click(box.x + geom[0]!, box.y + geom[1]!);
  await expect
    .poll(landed)
    .toBeGreaterThan(before);
  // Stars keep falling on the clock: left alone, the count still rises.
  const now = await landed();
  await expect.poll(landed, { timeout: 15_000 }).toBeGreaterThan(now);
  await expectViewMatchesState(page, "navigation");
});

test("the ship page and the notice board render without the server and point back to each other", async ({ page }) => {
  await page.goto("/ship");
  await expect(page.getByRole("heading", { name: "You're ashore" })).toBeVisible();
  await page.getByRole("link", { name: "Notice board" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.getByRole("heading", { name: "Ships", exact: true })).toBeVisible();
  await expect(page.getByText("No ship is recruiting here.")).toBeVisible();
  await expect(page.getByText("No ship is at sea.")).toBeVisible();
});
