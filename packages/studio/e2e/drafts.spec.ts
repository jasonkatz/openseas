import { expect, test, type Page } from "@playwright/test";
import { SERVICE, draft, numbers, service } from "./standin.js";

/**
 * Drafts kept by the service (ADR 0045). No service runs under the smoke: these tests answer for
 * it (e2e/standin.ts), as e2e/links.spec.ts does, with what the real one answers
 * (packages/studio-server holds it to the same shapes).
 */
const store = (page: Page) => page.getByTestId("draft-store");
const kinds = (page: Page) => page.getByTestId("input-config.pieceKinds");

test.describe("drafts in the service", () => {
  test.beforeEach(() => test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool"));

  test("the owner's stored draft opens on a bare address, and a change is saved to it", async ({ page }) => {
    const s = await service(page, { login: "octo", drafts: [draft({ numbers: numbers({ seed: "kept-1", overrides: { pieceKinds: 5 }, roundSeconds: 45 }) })] });
    await page.goto("/cooling");
    await expect(store(page)).toHaveAttribute("data-status", "saved");
    await expect(kinds(page)).toHaveValue("5");
    await expect(page.getByTestId("seed-input")).toHaveValue("kept-1");
    await expect(page.getByTestId("hud-time")).toHaveText("0:45");
    await expect(page.getByTestId("changed-count")).toContainText("2");
    // The service keeps it, so the address does not.
    await expect(page).toHaveURL(/\/cooling$/);
    expect(s.writes).toEqual([]);

    await kinds(page).fill("4");
    await expect(store(page)).toHaveAttribute("data-revision", "4");
    await expect(store(page)).toHaveAttribute("data-status", "saved");
    expect(s.writes).toEqual([{ call: "PUT /drafts/draftdraft", body: { numbers: numbers({ seed: "kept-1", overrides: { pieceKinds: 4 }, roundSeconds: 45 }), revision: 3 } }]);
    await expect(page).toHaveURL(/\/cooling$/);

    // The draft follows the owner: a fresh load is on the saved numbers, and they play.
    await page.reload();
    await expect(kinds(page)).toHaveValue("4");
    await page.getByTestId("play-start").click();
    await expect(page.getByTestId("cooling-canvas")).toBeVisible();
  });

  test("the first change opens a draft, the home grid marks it, and it is discarded only after a confirmation", async ({ page }) => {
    const s = await service(page, { login: "octo" });
    await page.goto("/cooling");
    await expect(store(page)).toHaveAttribute("data-draft", "");
    await expect(page.getByTestId("draft-discard")).toHaveCount(0);
    await kinds(page).fill("5");
    await expect(store(page)).toHaveAttribute("data-draft", "newdraft22");
    expect(s.writes).toEqual([{ call: "POST /drafts", body: { puzzle: "cooling", numbers: numbers({ overrides: { pieceKinds: 5 } }) } }]);

    await page.goto("/");
    await expect(page.getByTestId("draft-mark-cooling")).toBeVisible();
    await expect(page.getByTestId("draft-mark-engines")).toHaveCount(0);

    // Reset all clears the numbers and keeps the draft.
    await page.getByTestId("tile-cooling").click();
    await expect(kinds(page)).toHaveValue("5");
    await page.getByTestId("reset-all").click();
    await expect(store(page)).toHaveAttribute("data-revision", "2");
    expect(s.drafts[0]!.numbers).toEqual(numbers());

    await kinds(page).fill("4");
    await expect(store(page)).toHaveAttribute("data-revision", "3");
    await page.getByTestId("draft-discard").click();
    await page.getByTestId("draft-discard-no").click();
    expect(s.drafts).toHaveLength(1);
    await page.getByTestId("draft-discard").click();
    await page.getByTestId("draft-discard-yes").click();
    await expect(store(page)).toHaveAttribute("data-draft", "");
    await expect(page.getByTestId("changed-count")).not.toContainText("1");
    expect(s.drafts).toEqual([]);
    await page.goto("/");
    await expect(page.getByTestId("puzzle-grid")).toBeVisible();
    await expect(page.getByTestId("draft-mark-cooling")).toHaveCount(0);
  });

  test("a link's numbers never overwrite the stored draft unasked", async ({ page }) => {
    const s = await service(page, { login: "octo", drafts: [draft()] });
    await page.goto("/cooling?c.pieceKinds=4&seconds=45");
    await expect(store(page)).toHaveAttribute("data-state", "address");
    await expect(store(page)).toHaveAttribute("data-why", "link");
    // The page plays the link, and changing it saves nothing: the address goes on carrying it.
    await expect(kinds(page)).toHaveValue("4");
    await page.getByTestId("input-roundSeconds").fill("50");
    await expect(page).toHaveURL(/seconds=50/);
    await page.waitForTimeout(900);
    expect(s.writes).toEqual([]);

    await page.getByTestId("draft-open").click();
    await expect(store(page)).toHaveAttribute("data-state", "stored");
    await expect(kinds(page)).toHaveValue("5");
    await expect(page).toHaveURL(/\/cooling$/);
    expect(s.writes).toEqual([]);

    await page.goto("/cooling?c.pieceKinds=4&seconds=45");
    await page.getByTestId("draft-keep").click();
    await expect(store(page)).toHaveAttribute("data-state", "stored");
    await expect(page).toHaveURL(/\/cooling$/);
    expect(s.writes).toEqual([{ call: "PUT /drafts/draftdraft", body: { numbers: numbers({ overrides: { pieceKinds: 4 }, roundSeconds: 45 }), revision: 3 } }]);
    await expect(kinds(page)).toHaveValue("4");

    // An address that says what the draft already says is just the draft.
    await page.goto("/cooling?c.pieceKinds=4&seconds=45");
    await expect(store(page)).toHaveAttribute("data-state", "stored");
    await expect(page).toHaveURL(/\/cooling$/);
  });

  test("a draft saved from somewhere else, or a service that stops answering, leaves the numbers in the address", async ({ page }) => {
    const s = await service(page, { login: "octo", drafts: [draft()] });
    await page.goto("/cooling");
    await expect(kinds(page)).toHaveValue("5");
    // Another page saved it meanwhile.
    s.drafts[0]!.revision = 9;
    s.drafts[0]!.numbers = numbers({ overrides: { pieceKinds: 6 } });
    await kinds(page).fill("4");
    await expect(store(page)).toHaveAttribute("data-why", "stale");
    await expect(page).toHaveURL(/c\.pieceKinds=4/);
    expect(s.drafts[0]!.numbers.overrides).toEqual({ pieceKinds: 6 });
    await page.getByTestId("draft-open").click();
    await expect(kinds(page)).toHaveValue("6");

    s.fail = "down";
    await kinds(page).fill("3");
    await expect(store(page)).toHaveAttribute("data-why", "unsaved");
    await expect(page).toHaveURL(/c\.pieceKinds=3/);
    // It still plays, and once the service is back the owner's word saves it.
    await page.getByTestId("play-start").click();
    await expect(page.getByTestId("cooling-canvas")).toBeVisible();
    s.fail = null;
    await page.getByTestId("draft-keep").click();
    await expect(store(page)).toHaveAttribute("data-state", "stored");
    expect(s.drafts[0]!.numbers.overrides).toEqual({ pieceKinds: 3 });
  });

  test("signed out, or with the service down, the address is the draft as it always was", async ({ page }) => {
    const s = await service(page, { login: null });
    await page.goto("/cooling");
    await expect(page.getByTestId("sign-in-github")).toBeVisible();
    await kinds(page).fill("5");
    await expect(page).toHaveURL(/c\.pieceKinds=5/);
    await expect(store(page)).toHaveCount(0);
    expect(s.calls.filter((c) => c.includes("/drafts"))).toEqual([]);

    await page.unroute(`${SERVICE}/**`);
    await page.route(`${SERVICE}/**`, (route) => route.abort());
    await page.goto("/cooling?c.pieceKinds=5");
    await expect(page.getByTestId("links-unreachable")).toBeVisible();
    await expect(kinds(page)).toHaveValue("5");
    await kinds(page).fill("4");
    await expect(page).toHaveURL(/c\.pieceKinds=4/);
    await expect(store(page)).toHaveCount(0);
    await page.getByTestId("play-start").click();
    await expect(page.getByTestId("cooling-canvas")).toBeVisible();
    await page.goto("/");
    await expect(page.getByTestId("tile-cooling")).toBeVisible();
  });

  test("signing out puts the stored draft's numbers back in the address", async ({ page }) => {
    await service(page, { login: "octo", drafts: [draft()] });
    await page.goto("/cooling");
    await expect(kinds(page)).toHaveValue("5");
    await page.getByTestId("sign-out").click();
    await expect(store(page)).toHaveCount(0);
    await expect(page).toHaveURL(/c\.pieceKinds=5/);
    await expect(kinds(page)).toHaveValue("5");
  });
});

test("a /play page asks the service nothing, whoever is signed in", async ({ page }) => {
  const s = await service(page, { login: "octo", drafts: [draft()] });
  await page.goto("/play/cooling?c.pieceKinds=4");
  await expect(page.getByTestId("play")).toBeVisible();
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("cooling-canvas")).toBeVisible();
  expect(s.calls).toEqual([]);
});
