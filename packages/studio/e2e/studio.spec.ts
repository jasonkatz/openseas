import { expect, test, type Page } from "@playwright/test";
import { expectViewMatchesState, shown } from "./helpers.js";

/**
 * A puzzle's studio page (DESIGN.md 3.14, ADR 0042): the board with the tuning panel beside it.
 * The studio is a desktop tool, so all but the last test run on the desktop profile only.
 */
const PUZZLES = ["cooling", "engines", "plating", "gunnery", "navigation", "battle", "swordfight", "salvage", "overload", "deflectors", "reactor", "scanner", "tug", "racks", "cutting", "tractor", "refining", "freefall", "pact"];

const desktopOnly = (): void => test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool");
const board = (page: Page): Promise<string | null> => page.getByTestId("cooling-board").getAttribute("data-board");
const control = (page: Page, key: string) => page.getByTestId(`control-${key}`);

for (const puzzle of PUZZLES) {
  test(`${puzzle} has a studio page: a control for its numbers, and its board plays there`, async ({ page }) => {
    desktopOnly();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/${puzzle}`);
    await expect(page.getByTestId("studio")).toBeVisible();
    const panel = page.getByTestId("tuning");
    // Every key is in a section, each with its line from beside the wire schema.
    await expect(panel.getByTestId("group-other")).toHaveCount(0);
    // The numbers are split over four modes (ADR 0056, ADR 0069): the board and the round, the deal and the pace, the scoring, and the rating.
    await page.getByTestId("tab-setup").click();
    await expect(control(page, "config.maxMoves")).toBeVisible();
    await expect(control(page, "config.maxMoves").locator(".tune-desc")).not.toBeEmpty();
    await expect(control(page, "roundSeconds")).toBeVisible();
    await expect(control(page, "paceSeconds")).toBeHidden();
    await page.getByTestId("tab-rating").click();
    await expect(control(page, "paceSeconds")).toBeVisible();
    await expect(control(page, "thresholds")).toBeVisible();
    await expect(control(page, "roundSeconds")).toBeHidden();
    await expect(page.getByTestId("changed-count")).toHaveText("Shipped numbers");

    await page.getByTestId("play-start").click();
    await expect(page.getByTestId(`${puzzle}-canvas`)).toBeVisible();
    await expect(page.getByTestId(`${puzzle}-canvas`)).toHaveAttribute("data-view", /.+/);
    expect(errors).toEqual([]);
  });
}

test("a changed number deals the same seed again, carries a dot that puts it back, and can be held against the shipped ones", async ({ page }) => {
  desktopOnly();
  await page.goto("/cooling?seed=studio-1");
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "cooling");
  const shipped = await board(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");

  // One more kind of piece: the round is dealt again on the same seed, and the address bar holds the draft.
  await (await shown(page, "more-config.pieceKinds")).click();
  await expect(page).toHaveURL(/c\.pieceKinds=8/);
  await expect(control(page, "config.pieceKinds")).toHaveAttribute("data-changed", "1");
  await expect(page.getByTestId("changed-count")).toContainText("1");
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "cooling");
  const tuned = await board(page);
  expect(tuned).not.toBe(shipped);

  // Held, the shipped numbers are dealt on that seed; let go, the draft's are again.
  const compare = await shown(page, "compare");
  await compare.hover();
  await page.mouse.down();
  await expect(page.getByTestId("comparing")).toBeVisible();
  await expect.poll(() => board(page)).toBe(shipped);
  await page.mouse.up();
  await expect(page.getByTestId("comparing")).toHaveCount(0);
  await expect.poll(() => board(page)).toBe(tuned);

  // The dot puts the one number back.
  await (await shown(page, "reset-config.pieceKinds")).click();
  await expect(page).not.toHaveURL(/pieceKinds/);
  await expect(control(page, "config.pieceKinds")).toHaveAttribute("data-changed", "0");
  await expect.poll(() => board(page)).toBe(shipped);
});

test("a number the server would refuse says why on its own control, and nothing is dealt on it", async ({ page }) => {
  desktopOnly();
  await page.goto("/cooling?seed=studio-2");
  await (await shown(page, "input-config.streakMaxPercent")).fill("20");
  await expect(page.getByTestId("refusal-config.streakMaxPercent")).toBeVisible();
  await expect(page.getByTestId("changed-count")).toContainText("refuse");
  await expect(page.getByTestId("play-start")).toBeDisabled();
  await expect(page.getByTestId("copy-play-link")).toBeDisabled();
  // The other controls are not blamed.
  await expect(page.getByTestId("refusal-config.pieceKinds")).toHaveCount(0);

  await (await shown(page, "reset-all")).click();
  await expect(page.getByTestId("refusal-config.streakMaxPercent")).toHaveCount(0);
  await expect(page.getByTestId("play-start")).toBeEnabled();
  await expect(page).not.toHaveURL(/streakMaxPercent/);
});

test("the round is left alone when dealing again is pinned off", async ({ page }) => {
  desktopOnly();
  await page.goto("/cooling?seed=studio-3");
  await (await shown(page, "restart-on-change")).uncheck();
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "cooling");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await (await shown(page, "more-config.pieceKinds")).click();
  await expect(page).toHaveURL(/c\.pieceKinds=8/);
  await page.waitForTimeout(900);
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  // The next deal is on the draft.
  await (await shown(page, "transport-restart")).click();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
});

test("a seed can be pinned, replayed and dealt afresh", async ({ page }) => {
  desktopOnly();
  await page.goto("/cooling");
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "cooling");
  const first = await board(page);
  await expect(page).not.toHaveURL(/seed=/);

  await (await shown(page, "seed-pin")).click();
  await expect(page).toHaveURL(/seed=local-/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await (await shown(page, "transport-restart")).click();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "cooling");
  expect(await board(page)).toBe(first);

  const pinned = page.url();
  await (await shown(page, "transport-deal")).click();
  await expect(page).not.toHaveURL(pinned);
  await expect.poll(() => board(page)).not.toBe(first);

  // A typed seed is a pinned seed.
  await (await shown(page, "seed-input")).fill("studio-typed");
  await expect(page).toHaveURL(/seed=studio-typed/);
});

test("a starting point, a curve and a threshold all land in the draft, and the play link carries it", async ({ page, context }) => {
  desktopOnly();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/cooling?seed=studio-4");
  await (await shown(page, "start-from")).selectOption("three_kinds");
  await expect(page).toHaveURL(/c\.pieceKinds=3/);
  await expect(page.getByTestId("input-config.pieceKinds")).toHaveValue("3");

  await (await shown(page, "longer-config.cascadeMultipliers")).click();
  await (await shown(page, "input-config.cascadeMultipliers.3")).fill("5");
  await expect(page).toHaveURL(new RegExp(`c\\.cascadeMultipliers=${encodeURIComponent("[1,2,3,5]")}`));

  await (await shown(page, "input-thresholds.0")).fill("95");
  await expect(page).toHaveURL(/thresholds=/);
  await expect(control(page, "thresholds")).toHaveAttribute("data-changed", "1");
  await expect(page.getByTestId("changed-count")).toContainText("3");

  await (await shown(page, "copy-play-link")).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("/play/cooling?");
  expect(link).toContain("c.pieceKinds=3");

  // The link plays the draft alone, and lists what it changes.
  await page.goto(link);
  await expect(page.getByTestId("play")).toBeVisible();
  await expect(page.getByTestId("studio")).toHaveCount(0);
  await expect(page.getByTestId("play-tuned")).toContainText("3");
});

test("on a phone a puzzle's page only plays", async ({ page }) => {
  test.skip(test.info().project.name !== "phone", "the phone profile");
  await page.goto("/cooling");
  await expect(page.getByTestId("play")).toBeVisible();
  await expect(page.getByTestId("studio")).toHaveCount(0);
  await expect(page.getByTestId("tuning")).toHaveCount(0);
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("cooling-canvas")).toBeVisible();
});

test("the rail turns the panel to a mode, a search finds a number in any of them, and the top bar lists what changed and leads back to it", async ({ page }) => {
  desktopOnly();
  await page.goto("/cooling?seed=studio-5");
  // The page opens on Play: the round's panel, and no numbers.
  await expect(page.getByTestId("tab-play")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("seed-input")).toBeVisible();
  await expect(page.getByTestId("tuning")).toBeHidden();

  await page.getByTestId("tab-setup").click();
  await expect(page.getByTestId("seed-input")).toBeHidden();
  await expect(control(page, "config.width")).toBeVisible();
  await expect(control(page, "config.heatRisePerMoves")).toBeHidden();
  await page.getByTestId("tab-tuning").click();
  await expect(control(page, "config.heatRisePerMoves")).toBeVisible();
  await expect(control(page, "config.width")).toBeHidden();

  // A search shows the matching numbers whatever mode they are tuned in, and turning the rail ends it.
  await page.getByTestId("find").fill("streak");
  await expect(control(page, "config.streakMaxPercent")).toBeVisible();
  await expect(control(page, "config.heatRisePerMoves")).toBeHidden();
  await page.getByTestId("find").fill("no such number");
  await expect(page.getByTestId("find-none")).toBeVisible();
  await page.getByTestId("tab-setup").click();
  await expect(page.getByTestId("find")).toHaveValue("");
  await expect(control(page, "config.width")).toBeVisible();

  // A change marks its mode on the rail and is listed in the top bar, which leads back to its control and puts it back.
  await page.getByTestId("more-config.pieceKinds").click();
  await expect(page.getByTestId("changed-count")).toHaveText("1 changed");
  await expect(page.getByTestId("tab-dot-setup")).toBeVisible();
  await expect(page.getByTestId("tab-dot-tuning")).toHaveCount(0);
  await page.getByTestId("tab-play").click();
  await page.getByTestId("changed-count").click();
  await page.getByTestId("change-config.pieceKinds").locator(".menu-item").click();
  await expect(page.getByTestId("tab-setup")).toHaveAttribute("aria-selected", "true");
  await expect(control(page, "config.pieceKinds")).toBeVisible();
  await page.getByTestId("changed-count").click();
  await page.getByTestId("change-config.pieceKinds").locator(".num-reset").click();
  await expect(page.getByTestId("changed-count")).toHaveText("Shipped numbers");
  await expect(page.getByTestId("tab-dot-setup")).toHaveCount(0);

  // The menu of puzzles leads to another's page.
  await page.getByTestId("menu-puzzle").click();
  await page.getByTestId("goto-engines").click();
  await expect(page).toHaveURL(/\/engines$/);
  await expect(page.getByTestId("menu-puzzle")).toContainText("Engines");
});

test("the Play panel keeps the last rounds finished on the page, and says which numbers each was dealt on", async ({ page }) => {
  desktopOnly();
  await page.goto("/cooling?seed=studio-6");
  await expect(page.getByTestId("last-round")).toHaveCount(0);
  const finish = async (): Promise<void> => {
    await expect(page.getByTestId("cooling-canvas")).toBeVisible();
    await page.evaluate(() => {
      window.openseasRoundClock!.pause();
      window.openseasRoundClock!.step(10 * 60 * 1000);
    });
    // The round ends on the page's next look at its clock: a loaded runner can take a while to get there.
    await expect(page.getByTestId("result-tier")).toBeVisible({ timeout: 15_000 });
  };
  await page.getByTestId("play-start").click();
  await finish();
  await expect(page.getByTestId("last-round")).toHaveCount(1);
  await expect(page.getByTestId("last-round").first()).toContainText("studio-6");
  await page.getByTestId("transport-restart").click();
  await finish();
  await expect(page.getByTestId("last-round")).toHaveCount(2);
});

test("the transport bar under the board plays the round from any mode: pause holds it under a veil, a step moves the held clock, and the speed sticks", async ({ page }) => {
  desktopOnly();
  await page.goto("/cooling?seed=studio-7");
  await page.getByTestId("tab-tuning").click();
  const play = page.getByTestId("transport-play");
  await play.click();
  await expectViewMatchesState(page, "cooling");
  await expect(page.getByTestId("transport-step")).toBeDisabled();

  await play.click();
  await expect(page.getByTestId("held")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.openseasRoundClock?.paused)).toBe(true);
  const left = await page.getByTestId("hud-time").textContent();
  await page.getByTestId("transport-step").click();
  await page.waitForTimeout(1200);
  expect(await page.getByTestId("hud-time").textContent()).not.toBe(left);
  await page.getByTestId("held").click();
  await expect(page.getByTestId("held")).toHaveCount(0);

  await page.getByTestId("transport-speed-2").click();
  await expect(page).toHaveURL(/speed=2/);
  await expect(page.getByTestId("transport-speed-2")).toHaveAttribute("aria-checked", "true");

  // Alt and a key: the boards keep their own letters.
  await page.keyboard.press("Alt+KeyP");
  await expect(page.getByTestId("held")).toBeVisible();
});

test("the panels open wide over the middle, in every mode at once, the board moves above the chat and keeps its round, and Play never widens", async ({ page }) => {
  desktopOnly();
  await page.goto("/cooling?seed=studio-8");
  await expect(page.getByTestId("panel-wide")).toHaveCount(0);
  await page.getByTestId("transport-play").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");

  // A mode's panel opens wide by default; shut, the board comes back to the middle.
  await page.getByTestId("tab-tuning").click();
  await expect(page.getByTestId("studio")).toHaveAttribute("data-wide", "1");
  await page.getByTestId("panel-wide").click();
  await expect(page.getByTestId("studio")).toHaveAttribute("data-wide", "0");
  await expect.poll(async () => (await page.getByTestId("cooling-canvas").boundingBox())!.x).toBeLessThan(800);
  const before = await page.getByTestId("cooling-canvas").boundingBox();
  await page.getByTestId("panel-wide").click();
  await expect(page.getByTestId("studio")).toHaveAttribute("data-wide", "1");
  // Once it has flown there.
  await expect.poll(async () => (await page.getByTestId("cooling-canvas").boundingBox())!.x).toBeGreaterThan(before!.x + 200);
  // The same round, not a new one.
  await expect(page.getByTestId("hud-moves")).toContainText("1");

  // One switch for every mode but Play.
  await page.getByTestId("tab-scoring").click();
  await expect(page.getByTestId("studio")).toHaveAttribute("data-wide", "1");
  await page.getByTestId("tab-play").click();
  await expect(page.getByTestId("studio")).toHaveAttribute("data-wide", "0");
  await expect(page.getByTestId("hud-moves")).toContainText("1");

  // Remembered across a reload.
  await page.reload();
  await page.getByTestId("tab-text").click();
  await expect(page.getByTestId("studio")).toHaveAttribute("data-wide", "1");
  await page.keyboard.press("Alt+Backslash");
  await expect(page.getByTestId("studio")).toHaveAttribute("data-wide", "0");
});

test("a finished round keeps the numbers it was dealt on, can be the baseline, and lays its numbers back over the draft when asked", async ({ page }) => {
  desktopOnly();
  await page.goto("/cooling?seed=studio-9");
  const finish = async (): Promise<void> => {
    await expect(page.getByTestId("cooling-canvas")).toBeVisible();
    await page.evaluate(() => {
      window.openseasRoundClock!.pause();
      window.openseasRoundClock!.step(10 * 60 * 1000);
    });
    // The round ends on the page's next look at its clock: a loaded runner can take a while to get there.
    await expect(page.getByTestId("result-tier")).toBeVisible({ timeout: 15_000 });
  };
  await (await shown(page, "more-config.pieceKinds")).click();
  await page.getByTestId("transport-play").click();
  await finish();
  await page.getByTestId("tab-play").click();
  const first = page.getByTestId("last-round").first();
  await expect(first.getByTestId("round-changes")).toContainText("Piece kinds");

  // Back to the shipped numbers, and a second round on them.
  await (await shown(page, "reset-all")).click();
  await page.getByTestId("transport-restart").click();
  await finish();
  await page.getByTestId("tab-play").click();
  await expect(page.getByTestId("last-round")).toHaveCount(2);
  await expect(page.getByTestId("last-round").first().getByTestId("round-changes")).toHaveCount(0);
  await expect(page.getByTestId("last-round").first().getByTestId("round-delta")).toBeVisible();

  // The older round's numbers, back over the draft once the owner says so.
  const older = page.getByTestId("last-round").nth(1);
  await older.getByTestId("round-use").click();
  await older.getByTestId("round-use-yes").click();
  await expect(page).toHaveURL(/c\.pieceKinds=8/);
  await expect(older.getByTestId("round-use")).toBeHidden();

  // Kept for the tab's session.
  await older.getByTestId("round-baseline").click();
  await page.reload();
  await expect(page.getByTestId("last-round")).toHaveCount(2);
  await expect(page.getByTestId("last-round").nth(1)).toHaveClass(/is-base/);
});

test("a panel opened wide draws more: a curve as a chart drawn by hand, the rating scale with the page's rounds, a larger stage, a timeline and the shipped words", async ({ page }) => {
  desktopOnly();
  await page.goto("/reactor?seed=studio-10");
  await page.getByTestId("transport-play").click();
  await expect(page.getByTestId("reactor-canvas")).toBeVisible();
  await page.evaluate(() => {
    window.openseasRoundClock!.pause();
    window.openseasRoundClock!.step(10 * 60 * 1000);
  });
  await expect(page.getByTestId("result-tier")).toBeVisible();

  // Wide is where a mode opens.
  await page.getByTestId("tab-scoring").click();
  await expect(page.getByTestId("studio")).toHaveAttribute("data-wide", "1");

  // A press near the top of the first bar draws that step taller.
  const chart = page.getByTestId("chart-config.fusePoints");
  await expect(chart).toBeVisible();
  const was = Number(await page.getByTestId("input-config.fusePoints.0").inputValue());
  const box = (await chart.boundingBox())!;
  await page.mouse.click(box.x + box.width / 6, box.y + 20);
  await expect.poll(async () => Number(await page.getByTestId("input-config.fusePoints.0").inputValue())).toBeGreaterThan(was);
  await expect(page).toHaveURL(/c\.fusePoints/);

  await page.getByTestId("tab-rating").click();
  await expect(page.getByTestId("rating-scale")).toBeVisible();
  await expect(page.getByTestId("scale-round")).toHaveCount(1);

  await page.getByTestId("tab-sprites").click();
  const stage = (await page.getByTestId("sprite-stage").boundingBox())!;
  // Only the controls scroll, in a column of their own; the stage beside it is a pane that never moves.
  expect(await page.locator(".panel-body").evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
  await page.getByTestId("sprite-side").evaluate((e) => (e.scrollTop = 300));
  expect(await page.getByTestId("sprite-side").evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect((await page.getByTestId("sprite-stage").boundingBox())!.y).toBeCloseTo(stage.y, 0);
  // Larger than the closed panel's 288, as large as the panel's room allows.
  expect(stage.width).toBeGreaterThan(320);

  await page.getByTestId("tab-sounds").click();
  await page.getByTestId("sounds").locator('[data-testid^="cue-edit-"]').first().click();
  await expect(page.getByTestId("roll-ruler")).toBeVisible();
  // The open cue's details are tabs under the roll: a voice picked on it turns to its own, nothing grows the page.
  await expect(page.getByTestId("voice-inspector")).toBeVisible();
  await page.getByTestId("cue-tab-cue").click();
  await expect(page.getByTestId("cue-level")).toBeVisible();
  await expect(page.getByTestId("voice-inspector")).toHaveCount(0);
  const body = page.locator(".panel-body");
  expect(await body.evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true);

  await page.getByTestId("tab-text").click();
  await expect(page.getByTestId("shipped-text-reactor.title")).toHaveText("Reactor");

  // Shut, the panels draw as they did.
  await page.getByTestId("panel-wide").click();
  await expect(page.getByTestId("shipped-text-reactor.title")).toHaveCount(0);
  await page.getByTestId("tab-rating").click();
  await expect(page.getByTestId("rating-scale")).toHaveCount(0);
});
