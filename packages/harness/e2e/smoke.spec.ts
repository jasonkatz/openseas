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

/** On phones the bench is a sheet behind a button; on wide screens it is always there. */
async function openBench(page: Page): Promise<void> {
  const toggle = page.getByTestId("bench-toggle");
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}
async function closeBench(page: Page): Promise<void> {
  const toggle = page.getByTestId("bench-toggle");
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
}

/**
 * Smoke: the harness builds, loads, and every board plays an unrated round without the server,
 * through the same board code the game uses (ADR 0019). Rated play needs the server and is
 * covered by the server integration test. The bench's own paths (lab rounds from a link, the
 * replay check, reviewing a log, the lab clock) are smoked at the end.
 */
test("home page renders, says what it is testing against, and links to Bilging", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "openseas harness" })).toBeVisible();
  await expect(page.getByTestId("status-build")).toContainText("harness");
  await page.getByTestId("tile-bilging").click();
  await expect(page).toHaveURL(/\/bilging$/);
  await expect(page.getByTestId("start-unrated")).toBeVisible();
  await expect(page.getByTestId("start-lab")).toBeVisible();
});

test("an unrated Bilging round accepts a keyboard swap and shows the result", async ({ page }) => {
  await page.goto("/bilging");
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

test("home links to Sailing and an unrated round takes keyboard drops", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tile-sailing").click();
  await expect(page).toHaveURL(/\/sailing$/);
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

test("home links to Carpentry and planks go down by keyboard and by tap", async ({ page }) => {
  // The plank tray and board redraw are the heaviest canvas in the suite on the phone profile.
  test.slow();
  await page.goto("/");
  await page.getByTestId("tile-carpentry").click();
  await expect(page).toHaveURL(/\/carpentry$/);
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

test("home links to Gunnery and an unrated round lays arrows by key and by tap, and lifts one by tapping again", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tile-gunnery").click();
  await expect(page).toHaveURL(/\/gunnery$/);
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

test("home links to Navigation and an unrated round turns a ring by key and brings stars down by key and by tap", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tile-navigation").click();
  await expect(page).toHaveURL(/\/navigation$/);
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
  await expect.poll(landed).toBeGreaterThan(before);
  // Stars keep falling on the clock: left alone, the count still rises.
  const now = await landed();
  await expect.poll(landed, { timeout: 15_000 }).toBeGreaterThan(now);
  await expectViewMatchesState(page, "navigation");
});

test("a lab round opens from a link with its seed and config, replays clean, and its log can be reviewed", async ({ page }) => {
  // Three animated swaps, a review with board remounts and several settle checks: the longest test
  // in the suite, and right at the budget on the CI phone profile.
  test.slow();
  await page.goto("/bilging?seed=smoke-1&seconds=30&c.maxMoves=3&start=lab");
  const canvas = page.getByTestId("bilging-canvas");
  await expect(canvas).toBeVisible();
  // The address bar keeps the scenario but drops the autostart, so a reload does not start again.
  await expect(page).toHaveURL(/seed=smoke-1/);
  await expect(page).not.toHaveURL(/start=/);
  await expect(page.getByTestId("hud-moves")).toContainText("0/3");
  await expectViewMatchesState(page, "bilging");

  // Three swaps end a three-move round.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1/3");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("2/3");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("result")).toContainText("Lab round");

  // The bench knows the round and replayed it from the seed with every hash matching.
  await openBench(page);
  await expect(page.getByTestId("round-mode")).toContainText("Lab");
  await expect(page.getByTestId("round-seed")).toHaveText("smoke-1");
  await expect(page.getByTestId("check-replay")).toHaveAttribute("data-outcome", "ok");
  await expect(page.getByTestId("inspector-diff")).toContainText("maxMoves = 3");
  await expect(page.getByTestId("inspector-log").locator("li")).toHaveCount(3);

  // Review: step back through the log on the board.
  await page.getByTestId("round-review").click();
  await closeBench(page);
  await expect(page.getByTestId("review-bar")).toBeVisible();
  await expect(page.getByTestId("review-index")).toHaveText("3 / 3");
  await page.getByTestId("review-prev").click();
  await expect(page.getByTestId("review-index")).toHaveText("2 / 3");
  await expectViewMatchesState(page, "bilging");
  await page.getByTestId("review-exit").click();
  await expect(page.getByTestId("start-lab")).toBeVisible();
});

test("the scenario form refuses a config the server could not issue, and the link follows the form", async ({ page }) => {
  await page.goto("/bilging");
  await openBench(page);
  const field = page.getByTestId("config-field-maxMoves");
  await field.fill("0");
  await expect(page.getByTestId("config-errors")).toBeVisible();
  await expect(page.getByTestId("bench-start-lab")).toBeDisabled();
  await expect(page).toHaveURL(/c\.maxMoves=0/);
  await page.getByTestId("config-reset").click();
  await expect(page.getByTestId("config-errors")).toHaveCount(0);
  await expect(page.getByTestId("bench-start-lab")).toBeEnabled();
  await expect(page).not.toHaveURL(/maxMoves/);
  // A preset is a few overrides at once, and shows up on the start card's summary.
  await page.getByTestId("scenario-preset").selectOption("ten_moves");
  await expect(page).toHaveURL(/c\.maxMoves=10/);
  await expect(page).toHaveURL(/seconds=60/);
  await closeBench(page);
  await expect(page.getByTestId("lab-summary")).toContainText("1 config override");
});

test("a round pasted on the home page opens in review on its board", async ({ page }) => {
  await page.goto("/");
  const round = { puzzle: "bilging", seed: "smoke-paste", moves: [{ type: "swap", col: 0, row: 0 }, { type: "swap", col: 2, row: 5 }] };
  await page.getByTestId("home-review-text").fill(JSON.stringify(round));
  await page.getByTestId("home-review-open").click();
  await expect(page).toHaveURL(/\/bilging/);
  await expect(page.getByTestId("review-bar")).toBeVisible();
  await expect(page.getByTestId("review-index")).toHaveText("2 / 2");
  await expectViewMatchesState(page, "bilging");
  // Junk is refused on the home page with a reason.
  await page.goto("/");
  await page.getByTestId("home-review-text").fill('{"puzzle":"bilging","seed":"x","moves":[{"type":"arrow"}]}');
  await page.getByTestId("home-review-open").click();
  await expect(page.getByTestId("home-review-error")).toContainText("Move 0");
});

test("a lab round's clock can start paused, step a tick at a time, and run again", async ({ page }) => {
  await page.goto("/gunnery?seed=smoke-clock&start=lab&paused=1");
  await expect(page.getByTestId("gunnery-canvas")).toBeVisible();
  await openBench(page);
  const readout = page.getByTestId("clock-readout");
  await expect(readout).toContainText("paused");
  const time = page.getByTestId("hud-time");
  const frozen = await time.textContent();
  await page.waitForTimeout(1200);
  expect(await time.textContent()).toBe(frozen);
  // Three ticks of 200 ms; the shown tick runs one behind the clock.
  await page.getByTestId("clock-step").click();
  await page.getByTestId("clock-step").click();
  await page.getByTestId("clock-step").click();
  await expect(readout).toContainText("tick 2");
  await page.getByTestId("clock-pause").click();
  await expect(readout).not.toContainText("paused");
  await expect(time).not.toHaveText(frozen!, { timeout: 5_000 });
});

/** A server that is up but wants an alpha invite code, as a preview copied from production does. */
async function mockInviteGatedServer(page: Page): Promise<void> {
  let pirate: unknown = null;
  await page.route("**/api/me", (route) => route.fulfill({ json: { pirate, inviteRequired: true } }));
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/api/auth/sign-in/anonymous", (route) => route.fulfill({ json: { token: "t", user: { id: "u1", isAnonymous: true } } }));
  await page.route("**/api/pirate", async (route) => {
    const body = route.request().postDataJSON() as { inviteCode?: string };
    if (body?.inviteCode !== "secret") return route.fulfill({ status: 403, json: { error: "invite_invalid" } });
    pirate = { id: "p1", name: "Smoke Tester", guest: true, balance: 0, ratings: [], ships: [] };
    return route.fulfill({ status: 201, json: { pirate } });
  });
}

test("with a server that wants an invite code, the home signs the pirate in and the start card says so until then", async ({ page }) => {
  await mockInviteGatedServer(page);
  await page.goto("/bilging");
  // A cold worker on the CI phone profile spends its first seconds bringing up the board's renderer,
  // and the start card only says this once the sign-in round trip lands after that.
  await expect(page.getByText("Sign the articles on the home page")).toBeVisible({ timeout: 20_000 });
  await page.goto("/");
  await expect(page.getByTestId("sign-in")).toBeVisible();
  await expect(page.getByTestId("status-card")).toContainText("Not signed in");
  await page.getByTestId("sign-in-invite").fill("wrong");
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByTestId("sign-in")).toContainText("isn't right");
  await page.getByTestId("sign-in-invite").fill("secret");
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByTestId("status-pirate")).toContainText("Smoke Tester");
});
