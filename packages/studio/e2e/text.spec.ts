import { expect, test, type Page } from "@playwright/test";
import { expectViewMatchesState, shown } from "./helpers.js";
import { draft, numbers, service } from "./standin.js";

/**
 * The Text mode (DESIGN.md 3.14, ADR 0057): the puzzle's name, its category and every string that
 * is its own, each to rewrite. A rewritten string is the draft's: the page says it at once, a
 * link carries it, and the service keeps it with the numbers. Save's writing of it is proven in
 * packages/studio-server/test/save.test.ts.
 */
const desktopOnly = (): void => test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool");
const row = (page: Page, key: string) => page.getByTestId(`text-${key}`);
const field = (page: Page, key: string) => page.getByTestId(`input-text-${key}`);

test("a puzzle's words are rewritten in the Text mode, said on the page at once, and put back", async ({ page }) => {
  desktopOnly();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/cooling?seed=text-1");
  await page.getByTestId("tab-text").click();
  // Every string of the puzzle's has a row, in a section, and no other puzzle's does.
  await expect(row(page, "cooling.title")).toBeVisible();
  await expect(page.getByTestId("text-group-identity").getByTestId("text-home.practice_cooling_blurb")).toBeVisible();
  await expect(page.getByTestId("text-group-intro").getByTestId("text-cooling.how_to")).toBeVisible();
  await expect(page.getByTestId("text-group-play").getByTestId("text-cooling.multi_2")).toBeVisible();
  await expect(page.getByTestId("text-group-pieces").getByTestId("text-cooling.piece.cog")).toBeVisible();
  await expect(row(page, "engines.title")).toHaveCount(0);

  // The name is rewritten: the top bar and the start card say it, the address carries it, and the change is counted.
  await field(page, "cooling.title").fill("Coolant Run");
  await expect(row(page, "cooling.title")).toHaveAttribute("data-changed", "1");
  await expect(page.getByTestId("menu-puzzle")).toContainText("Coolant Run");
  await expect(page.locator(".veil-card h2, .veil-card h1").first()).toHaveText("Coolant Run");
  await expect(page).toHaveURL(/text\.cooling\.title=Coolant\+Run/);
  await expect(page.getByTestId("changed-count")).toHaveText("1 changed");
  await expect(page.getByTestId("tab-dot-text")).toBeVisible();

  // The start card's own words, and the board still plays on them.
  await field(page, "cooling.how_to").fill("Swap two pieces to line up three.");
  await expect(page.locator(".veil-card .how").first()).toHaveText("Swap two pieces to line up three.");
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "cooling");

  // A string that fills in a name must keep it: the edit is refused where it is typed, and the draft keeps the shipped words.
  await field(page, "cooling.streak_label").fill("Many in a row!");
  await expect(page.getByTestId("refusal-text-cooling.streak_label")).toContainText("{count}");
  await expect(row(page, "cooling.streak_label")).toHaveAttribute("data-changed", "0");
  await expect(page).not.toHaveURL(/streak_label/);
  await field(page, "cooling.streak_label").fill("{count} straight!");
  await expect(page.getByTestId("refusal-text-cooling.streak_label")).toHaveCount(0);
  await expect(page).toHaveURL(/text\.cooling\.streak_label=/);
  await expect(page.getByTestId("changed-count")).toHaveText("3 changed");

  // The search finds words as it finds numbers, in whichever mode.
  await page.getByTestId("find").fill("straight");
  await expect(row(page, "cooling.streak_label")).toBeVisible();
  await expect(row(page, "cooling.title")).toBeHidden();
  await page.getByTestId("tab-tuning").click();
  await page.getByTestId("find").fill("coolant run");
  await expect(row(page, "cooling.title")).toBeVisible();
  await page.getByTestId("tab-text").click();

  // The category is a label the draft can change, and the list in the top bar leads back to each and puts each back.
  await page.getByTestId("input-category").selectOption("crafting");
  await expect(page).toHaveURL(/category=crafting/);
  await page.getByTestId("tab-play").click();
  await page.getByTestId("changed-count").click();
  await expect(page.getByTestId("change-category")).toContainText("Crafting");
  await page.getByTestId("change-text-cooling.title").locator(".menu-item").click();
  await expect(page.getByTestId("tab-text")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "cooling.title")).toBeVisible();
  await page.getByTestId("reset-text-cooling.title").click();
  await expect(page.getByTestId("menu-puzzle")).toContainText("Cooling");
  await expect(field(page, "cooling.title")).toHaveValue("Cooling");
  await (await shown(page, "reset-all")).click();
  await expect(page.getByTestId("changed-count")).toHaveText("Shipped numbers");
  await expect(page).not.toHaveURL(/text\.|category=/);
  await expect(page.getByTestId("input-category")).toHaveValue("duty");
  expect(errors).toEqual([]);
});

test("the play link carries the words, and plays the puzzle alone on them", async ({ page }) => {
  await page.goto(`/play/cooling?seed=text-2&text.cooling.title=${encodeURIComponent("Coolant Run")}&text.cooling.go=${encodeURIComponent("Chill!")}&text.engines.title=Mine&text.cooling.streak_label=Broken`);
  await expect(page.getByTestId("play")).toBeVisible();
  // Its own strings are said; another puzzle's and one that drops the name it fills in are not laid over the table.
  await expect(page.locator(".veil-card h2, .veil-card h1").first()).toHaveText("Coolant Run");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("cooling-canvas")).toBeVisible();
  await page.getByTestId("toggle-details").click();
  await expect(page.getByTestId("play-words")).toContainText("4");
});

test("the service keeps a draft's words with its numbers, and one older than words leaves them in the address", async ({ page }) => {
  desktopOnly();
  const words = { texts: { "cooling.title": "Coolant Run" }, category: null };
  const s = await service(page, { login: "octo", words: true, drafts: [draft({ numbers: { ...numbers({ overrides: { pieceKinds: 5 } }), words } })] });
  await page.goto("/cooling");
  await expect(page.getByTestId("draft-store")).toHaveAttribute("data-status", "saved");
  await expect(page.getByTestId("menu-puzzle")).toContainText("Coolant Run");
  await expect(page).toHaveURL(/\/cooling$/);
  await (await shown(page, "input-text-cooling.go")).fill("Chill!");
  await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "4");
  expect(s.drafts[0]!.numbers.words).toEqual({ texts: { "cooling.title": "Coolant Run", "cooling.go": "Chill!" }, category: null });
  await expect(page).toHaveURL(/\/cooling$/);

  // A service that keeps no words: the draft is stored without them, they stay in the address, and the draft is not saved over and over.
  const old = await service(page, { login: "octo", drafts: [draft()] });
  await page.goto("/cooling");
  await expect(page.getByTestId("draft-store")).toHaveAttribute("data-status", "saved");
  await (await shown(page, "input-text-cooling.go")).fill("Chill!");
  await expect(page).toHaveURL(/text\.cooling\.go=Chill/);
  await page.waitForTimeout(1500);
  expect(old.writes).toEqual([]);
});

test("a draft whose only change is a word can be saved", async ({ page }) => {
  desktopOnly();
  await service(page, { login: "octo", save: true, words: true, drafts: [draft({ numbers: numbers(), save: { state: "idle", error: null, pull: null, savedRevision: null, behind: false } })] });
  await page.goto("/cooling");
  await expect(page.getByTestId("draft-store")).toHaveAttribute("data-status", "saved");
  await expect(page.getByTestId("save")).toBeDisabled();
  await (await shown(page, "input-text-cooling.go")).fill("Chill!");
  await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "4");
  await expect(page.getByTestId("save")).toBeEnabled();
});
