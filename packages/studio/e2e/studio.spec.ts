import { expect, test, type Page } from "@playwright/test";
import { expectViewMatchesState, shown } from "./helpers.js";

/**
 * A puzzle's studio page (DESIGN.md 3.14, ADR 0042): the board with the tuning panel beside it.
 * The studio is a desktop tool, so all but the last test run on the desktop profile only.
 */
const PUZZLES = ["cooling", "engines", "plating", "gunnery", "navigation", "battle", "swordfight", "salvage", "overload", "deflectors", "reactor", "scanner", "tug", "racks", "cutting"];

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
    // The numbers are split over three modes (ADR 0055): the board and the round, the deal and the pace, the scoring and the rating.
    await page.getByTestId("tab-setup").click();
    await expect(control(page, "config.maxMoves")).toBeVisible();
    await expect(control(page, "config.maxMoves").locator(".tune-desc")).not.toBeEmpty();
    await expect(control(page, "roundSeconds")).toBeVisible();
    await expect(control(page, "paceSeconds")).toBeHidden();
    await page.getByTestId("tab-scoring").click();
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
  await (await shown(page, "seed-replay")).click();
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
  await (await shown(page, "seed-replay")).click();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "cooling");
  expect(await board(page)).toBe(first);

  const pinned = page.url();
  await (await shown(page, "seed-new")).click();
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
    await expect(page.getByTestId("result-tier")).toBeVisible();
  };
  await page.getByTestId("play-start").click();
  await finish();
  await expect(page.getByTestId("last-round")).toHaveCount(1);
  await expect(page.getByTestId("last-round").first()).toContainText("studio-6");
  await page.getByTestId("seed-replay").click();
  await finish();
  await expect(page.getByTestId("last-round")).toHaveCount(2);
});
