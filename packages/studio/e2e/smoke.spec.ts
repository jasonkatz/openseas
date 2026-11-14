import { expect, test, type Page } from "@playwright/test";
import { expectViewMatchesState } from "./helpers.js";

/** A finger on the page, through the browser's own touch input, so the boards see `pointerType: "touch"`. */
async function finger(page: Page): Promise<{ down(x: number, y: number): Promise<void>; move(x: number, y: number): Promise<void>; up(): Promise<void> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const send = (type: "touchStart" | "touchMove" | "touchEnd", x?: number, y?: number): Promise<unknown> =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: x === undefined || y === undefined ? [] : [{ x, y }] });
  return {
    down: async (x, y) => void (await send("touchStart", x, y)),
    move: async (x, y) => void (await send("touchMove", x, y)),
    up: async () => void (await send("touchEnd")),
  };
}

/**
 * Smoke: the studio builds, loads, and every board plays a round alone on its `/play` page, with
 * no server, through the same board code the game uses (ADR 0019, ADR 0042). `/play` itself (a
 * tuned link, a refused one, the seed, no request to the game) is smoked in play.spec.ts, and a
 * puzzle's studio page (the tuning panel, the seed, compare) in studio.spec.ts. The voyage bench
 * (ADR 0027) is smoked at the end.
 */
test("home page renders, says which build it is, and links to Cooling's page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "openseas studio" })).toBeVisible();
  await expect(page.getByTestId("status-build")).toContainText("studio");
  await page.getByTestId("tile-cooling").click();
  await expect(page).toHaveURL(/\/cooling$/);
  await expect(page.getByTestId("play-start")).toBeVisible();
});

test("the home grid lists every puzzle alike and pictures each board from this build", async ({ page }) => {
  // Fifteen boards are drawn one after another in a hidden frame.
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const tiles = page.getByTestId("puzzle-grid").locator("li");
  await expect(tiles).toHaveCount(15);
  // A tile stands on its glyph until its picture is taken, then shows the board itself.
  await expect(page.getByTestId("puzzle-grid").locator("img")).toHaveCount(15, { timeout: 60_000 });
  const picture = page.getByTestId("thumb-salvage");
  await expect(picture).toHaveAttribute("src", /^data:image\/webp/);
  expect(await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
  // The frame is gone once the last picture is in, and the pictures are kept for the tab.
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("puzzle-grid").locator("img")).toHaveCount(15, { timeout: 2000 });

  await page.getByTestId("tile-play-salvage").click();
  await expect(page).toHaveURL(/\/play\/salvage$/);
  await expect(page.getByTestId("play")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Cooling plays alone on /play: a round accepts a keyboard swap and a tap", async ({ page }) => {
  await page.goto("/play/cooling");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("cooling-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toContainText("0");
  // The round's board replaces the preview board behind the start card.
  await expectViewMatchesState(page, "cooling");

  // Keyboard: put the cursor somewhere and swap with the piece to the right.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await expectViewMatchesState(page, "cooling");

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

test("Engines plays alone on /play: a round takes keyboard drops", async ({ page }) => {
  await page.goto("/play/engines");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("engines-canvas");
  await expect(canvas).toBeVisible();
  // The count alone: rounds run their clock, so no cap follows it.
  await expect(page.getByTestId("hud-moves")).toHaveText("0");

  // Steer, rotate, and hold space to hurry the pair down until it lands (there is no hard drop).
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.down(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await page.keyboard.up(" ");
  await expectViewMatchesState(page, "engines");

  // Pointer: a tap turns the pair, a swipe up turns it back, a sideways drag steers it; then a key drops it.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.3;
  await page.mouse.click(x, y);
  // A swipe up turns it the other way.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - box.height * 0.2, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * 0.2, y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.down(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await page.keyboard.up(" ");

  // Touch: swipes turn the pair, and a finger held still hurries it down.
  const touch = await finger(page);
  await touch.down(x, y);
  await touch.move(x, y + box.height * 0.1);
  await touch.move(x, y + box.height * 0.2);
  await touch.up();
  await touch.down(x, y);
  await expect(page.getByTestId("hud-moves")).toHaveText("3");
  await touch.up();
});

test("Plating plays alone on /play: plates go down by keyboard and by tap", async ({ page }) => {
  // The plate tray and board redraw are the heaviest canvas in the suite on the phone profile.
  test.slow();
  await page.goto("/play/plating");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("plating-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toContainText("0");
  const settled = (): Promise<void> => expectViewMatchesState(page, "plating");
  await settled();

  // A turned and flipped plate does not pass its orientation on: the next one picked comes out of
  // the tray the way the tray shows it.
  await page.keyboard.press("1");
  await page.keyboard.press("r");
  await page.keyboard.press("f");
  await expect(canvas).not.toHaveAttribute("data-orient", "0,0,0");
  await page.keyboard.press("2");
  await expect(canvas).toHaveAttribute("data-orient", "1,0,0");
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-orient", "-1,0,0");

  // Keyboard: pick plate 1, jump to a spot it fits, weld it down.
  await page.keyboard.press("1");
  await page.keyboard.press("h");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await settled();

  // Pointer: pick plate 2, find a fit by keyboard, then click the middle of the ghost to weld it.
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

test("Gunnery plays alone on /play: a round lays arrows by key and by tap, and lifts one by tapping again", async ({ page }) => {
  await page.goto("/play/gunnery");
  await page.getByTestId("play-start").click();
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

test("Navigation plays alone on /play: a round turns a ring by key and brings stars down by key and by tap", async ({ page }) => {
  await page.goto("/play/navigation");
  await page.getByTestId("play-start").click();
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

test("Space Battle plays alone on /play: a fight plots by key and by tap and flies its plot", async ({ page }, testInfo) => {
  // Desktop only: on CI's phone profile this run timed out without a fault in the board, and the
  // desktop run already drives every input it checks.
  test.skip(testInfo.project.name === "phone", "flaky on CI's phone profile; the desktop run covers the board");
  await page.goto("/play/battle");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("battle-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toContainText("0/20");
  await expectViewMatchesState(page, "battle");

  // Keyboard: plot forward, forward, arm the port guns on the second move, then fly with enter.
  await page.keyboard.press("w");
  await page.keyboard.press("w");
  await page.keyboard.press("q");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /"move":"forward".*"move":"forward","port":true/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1/20");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", '{"segments":[],"grapple":false}');
  await expectViewMatchesState(page, "battle");

  // Pointer: the renderer says where its buttons sit; tap the left token, then the fly button.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const rect = async (id: string): Promise<number[]> => {
    const attr = (await canvas.getAttribute("data-buttons")) ?? "";
    const entry = attr.split(";").find((e) => e.startsWith(`${id}=`));
    if (!entry) throw new Error(`no button ${id} in ${attr}`);
    return entry.slice(id.length + 1).split(",").map(Number);
  };
  const tap = async (id: string): Promise<void> => {
    const [x, y, w, h] = await rect(id);
    await page.mouse.click(box.x + x! + w! / 2, box.y + y! + h! / 2);
  };
  await tap("token:left");
  await tap("token:forward");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /"move":"left".*"move":"forward"/);
  // Undo takes back the last move only; clear takes the whole plot, ghosts and all.
  await tap("undo");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /^\{"segments":\[\{"move":"left","port":false,"starboard":false\}\],"grapple":false\}$/);
  await tap("clear");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", '{"segments":[],"grapple":false}');
  await tap("token:left");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /"move":"left"/);
  await tap("fly");
  await expect(page.getByTestId("hud-moves")).toContainText("2/20");
  await expectViewMatchesState(page, "battle");

  // A full plot takes no more: a fifth token overwrites nothing. A tap on a slot picks it without
  // clearing it; a second tap takes its move back, and the next token goes there.
  const four = /^\{"segments":\[(\{"move":"forward","port":false,"starboard":false\},?){4}\],"grapple":false\}$/;
  for (const key of ["w", "w", "w", "w", "a"]) await page.keyboard.press(key);
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", four);
  await tap("slot:0");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", four);
  await tap("slot:0");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /^\{"segments":\[\{"move":null,/);
  await page.keyboard.press("a");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /^\{"segments":\[\{"move":"left",.*("move":"forward".*){3}/);
});

test("Swordfighting plays alone on /play: a fight drops pairs by keyboard and by touch", async ({ page }) => {
  // Two drops hurried down a seventeen-row board, with the raider's board small beside it, on the phone profile.
  test.slow();
  // A pinned seed: the same pairs and the same raider every run, so only the clock is left to chance.
  await page.goto("/play/swordfight?seed=smoke-sword-1");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("swordfight-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toContainText("0");
  await expectViewMatchesState(page, "swordfight");

  // Keyboard: steer left, turn, and hurry the pair down until it rests and the engine takes it.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.down(" ");
  await expect(page.getByTestId("hud-moves")).toContainText("1", { timeout: 30_000 });
  await page.keyboard.up(" ");
  await expectViewMatchesState(page, "swordfight");

  // Pointer: a tap turns the pair, a swipe up turns it back, a sideways drag steers it; then the key hurries it down.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height * 0.3;
  // A tap turns the upright pair clockwise, flat with its loose half on the right (rotation 0); a swipe up turns it back upright.
  const rotation = async (): Promise<string | undefined> => (await canvas.getAttribute("data-falling"))?.split(",")[1];
  await expect.poll(rotation).toBe("1");
  await page.mouse.click(x, y);
  await expect.poll(rotation).toBe("0");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - box.height * 0.2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(rotation).toBe("1");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * 0.15, y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.down(" ");
  await expect(page.getByTestId("hud-moves")).toContainText("2", { timeout: 30_000 });
  await page.keyboard.up(" ");
  await expectViewMatchesState(page, "swordfight");

  // Touch: a swipe down turns the upright pair clockwise (rotation 0), a swipe up turns it back, and a tap turns nothing.
  const touch = await finger(page);
  await expect.poll(rotation).toBe("1");
  await touch.down(x, y);
  await touch.move(x, y + box.height * 0.1);
  await touch.move(x, y + box.height * 0.2);
  await touch.up();
  await expect.poll(rotation).toBe("0");
  await touch.down(x, y);
  await touch.move(x, y - box.height * 0.1);
  await touch.move(x, y - box.height * 0.2);
  await touch.up();
  await expect.poll(rotation).toBe("1");
  // A finger held still hurries the pair down until the engine takes it.
  await touch.down(x, y);
  await expect(page.getByTestId("hud-moves")).toContainText("3", { timeout: 30_000 });
  await touch.up();
  await expectViewMatchesState(page, "swordfight");
});

test("a Cooling round plays a lone ship's heat: the deal brings the board to the heat's floor", async ({ page }) => {
  // Dealt eight rows deep on a dry, sound ship (ADR 0029): the round's first move is the ship's
  // heat, three rows, applied as a duty board applies its ship's word. The clock stays paused.
  await page.goto("/play/cooling?seed=smoke-water&c.initialHeatRow=8&start=1&paused=1");
  await expect(page.getByTestId("cooling-canvas")).toBeVisible();
  // The heat meter sits in the details sheet: three rows of twelve.
  await expect(page.locator(".heat-meter i")).toHaveAttribute("style", /width: 25%/);
});

const alwaysHailed = (tier: string): string => `w.lane.encounterChance=1&w.lane.raiders=${encodeURIComponent(JSON.stringify([{ tierId: tier, weight: 1 }]))}`;

test("the voyage bench flies a crew to its dock, charts the ship and proves the replay", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tile-voyage").click();
  await expect(page).toHaveURL(/\/voyage/);
  await expect(page.getByTestId("voyage-crew")).toBeVisible();
  // Three pirates aboard a skiff that wants four: one bot boots up.
  await expect(page.getByTestId("voyage-bots")).toContainText("1 bots boot up");
  await page.getByTestId("voyage-step").click();
  await expect(page.getByTestId("voyage-turn")).toHaveText("1");
  await page.getByTestId("voyage-to-end").click();
  await expect(page.getByTestId("voyage-summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("voyage-phase")).toHaveAttribute("data-phase", "arrived");
  await expect(page.getByTestId("vchart-progress")).toBeVisible();
  await expect(page.getByTestId("vchart-outputs")).toBeVisible();
  await expect(page.getByTestId("voyage-log")).toContainText("Docked");
  await expect(page.getByTestId("voyage-proof-result")).toHaveAttribute("data-ok", "1");
});

test("the voyage bench stops for the tester's plot when they have the helm", async ({ page }, testInfo) => {
  // Desktop only, as the practice battle: the phone profile drives the same board.
  test.skip(testInfo.project.name === "phone", "the desktop run covers the board");
  await page.goto(`/voyage?helm=you&${alwaysHailed("junker")}`);
  await page.getByTestId("voyage-to-end").click();
  await expect(page.getByTestId("voyage-your-plot")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
  // Keyboard, as on the practice page: forward, forward with the port guns, fly.
  await page.keyboard.press("w");
  await page.keyboard.press("w");
  await page.keyboard.press("q");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /"move":"forward".*"move":"forward","port":true/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("voyage-log")).toContainText("plotted by you");
  // The AI takes the rest of the fight, and the voyage flies on to its end.
  for (let i = 0; i < 40 && (await page.getByTestId("voyage-ai-plot").count()) > 0; i++) await page.getByTestId("voyage-ai-plot").click();
  if (await page.getByTestId("voyage-to-end").isEnabled()) await page.getByTestId("voyage-to-end").click();
  await expect(page.getByTestId("voyage-proof-result")).toHaveAttribute("data-ok", "1", { timeout: 30_000 });
  await expect(page.getByTestId("voyage-battle")).toContainText("you 1");
});

test("the voyage bench flies a batch and opens one of its voyages", async ({ page }) => {
  await page.goto(`/voyage?runs=4&hail=evade&${alwaysHailed("marauder")}`);
  await page.getByTestId("voyage-tab-batch").click();
  await page.getByTestId("voyage-batch-run").click();
  await expect(page.getByTestId("voyage-batch-stats")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("voyage-batch-stats")).toContainText("4/4");
  await expect(page.getByTestId("voyage-batch-list").locator("tbody tr")).toHaveCount(4);
  await page.getByTestId("voyage-batch-open").first().click();
  await expect(page.getByTestId("voyage-seed")).toHaveValue("voyage-1#1");
  await expect(page.getByTestId("voyage-summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("voyage-log")).toContainText("evades");
});

test("the voyage bench refuses a world the server would refuse", async ({ page }) => {
  // A leg must be a whole number of turns: content's own startup check.
  await page.goto("/voyage?w.lane.durationSeconds=215");
  await expect(page.getByTestId("voyage-invalid")).toContainText("whole number of turns");
  await expect(page.getByTestId("voyage-launch")).toHaveCount(0);
});
