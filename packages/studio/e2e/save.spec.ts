import { expect, test, type Page } from "@playwright/test";
import { NO_SAVE, draft, numbers, service } from "./standin.js";

/**
 * Save for a draft's numbers (ADR 0046), on the studio page. The stand-in service (e2e/standin.ts)
 * holds a Save at "being written" until the test says how it ended; the real one's branch, push
 * and pull request are proven in packages/studio-server/test/save.test.ts.
 */
const saveRows = (page: Page) => page.getByTestId("draft-save");
const PULL = { number: 123, url: "https://github.com/octo/openseas/pull/123" };

test.describe("save", () => {
  test.beforeEach(() => test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool"));

  test("Save shares a tester link at once, then shows the draft pull request it wrote", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, drafts: [draft({ save: NO_SAVE })] });
    await page.goto("/cooling");
    await expect(saveRows(page)).toHaveAttribute("data-state", "idle");
    await page.getByTestId("save-name").fill("Five kinds");
    await page.getByTestId("save").click();

    // At once: the link, in the Save rows and in the puzzle's list of links.
    await expect(page.getByTestId("save-link")).toContainText("savelink21");
    await expect(page.getByTestId("link-savelink21")).toContainText("Five kinds");
    await expect(page.getByTestId("save-writing")).toBeVisible();
    await expect(page.getByTestId("save")).toBeDisabled();
    await expect(page.getByTestId("draft-discard")).toBeDisabled();
    expect(s.writes).toEqual([{ call: "POST /drafts/draftdraft/save", body: { revision: 3, name: "Five kinds" } }]);

    // Then: the page asks until the branch is written, and shows the pull request.
    s.finish("draftdraft", { pull: PULL, savedRevision: 3 });
    await expect(saveRows(page)).toHaveAttribute("data-pull", "123");
    await expect(saveRows(page)).toHaveAttribute("data-current", "1");
    await expect(page.getByTestId("save-pull").locator("a")).toHaveAttribute("href", PULL.url);
    await expect(page.getByTestId("save-writing")).toHaveCount(0);

    // A number changed since is not in the pull request until the next Save, and the page says so.
    await page.getByTestId("input-config.pieceKinds").fill("4");
    await expect(saveRows(page)).toHaveAttribute("data-current", "0");
    await page.getByTestId("save").click();
    await expect(page.getByTestId("save-writing")).toBeVisible();
    expect(s.writes.at(-1)).toEqual({ call: "POST /drafts/draftdraft/save", body: { revision: 4, name: "Draft, save 4" } });
    s.finish("draftdraft", { savedRevision: 4 });
    await expect(saveRows(page)).toHaveAttribute("data-current", "1");

    await page.goto("/");
    await expect(page.getByTestId("draft-mark-cooling")).toHaveAttribute("data-pull", "1");
  });

  test("a Save that fails says why and leaves the draft and its link", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, drafts: [draft({ save: NO_SAVE })] });
    await page.goto("/cooling");
    await page.getByTestId("save").click();
    await expect(page.getByTestId("save-link")).toBeVisible();
    s.finish("draftdraft", { state: "failed", error: "github" });
    await expect(page.getByTestId("save-failed")).toContainText("GitHub");
    await expect(page.getByTestId("save-link")).toBeVisible();
    await expect(page.getByTestId("save")).toBeEnabled();
    await expect(page.getByTestId("input-config.pieceKinds")).toHaveValue("5");
  });

  test("when main has moved the page says so and merges it only when asked", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, drafts: [draft({ save: { ...NO_SAVE, pull: PULL, savedRevision: 3, behind: true } })] });
    await page.goto("/cooling");
    await expect(page.getByTestId("save-behind")).toBeVisible();
    // Tuning on does not ask for it, and does not lose sight of it.
    await page.getByTestId("input-config.pieceKinds").fill("4");
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "4");
    await expect(page.getByTestId("save-behind")).toBeVisible();
    expect(s.writes.map((w) => w.call)).toEqual(["PUT /drafts/draftdraft"]);

    await page.getByTestId("save-update").click();
    await expect(page.getByTestId("save-writing")).toBeVisible();
    expect(s.writes.at(-1)!.call).toBe("POST /drafts/draftdraft/update");
    s.finish("draftdraft", { behind: false });
    await expect(page.getByTestId("save-behind")).toHaveCount(0);
    await expect(saveRows(page)).toHaveAttribute("data-state", "idle");

    // And when the two changed the same lines, the page says the branch is as it was.
    s.drafts[0]!.save = { ...NO_SAVE, pull: PULL, savedRevision: 3, behind: true };
    await page.reload();
    await page.getByTestId("save-update").click();
    s.finish("draftdraft", { state: "failed", error: "conflict", behind: true });
    await expect(page.getByTestId("save-failed")).toContainText("same lines");
    await expect(page.getByTestId("save-behind")).toBeVisible();
  });

  test("a draft whose pull request was merged while the page watched is cleared", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, drafts: [draft({ save: { ...NO_SAVE, pull: PULL, savedRevision: 3 } })] });
    await page.goto("/cooling");
    await expect(page.getByTestId("input-config.pieceKinds")).toHaveValue("5");
    await page.getByTestId("save").click();
    await expect(page.getByTestId("save-writing")).toBeVisible();
    s.drafts = [];
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-draft", "");
    await expect(page.getByTestId("input-config.pieceKinds")).toHaveValue("7");
  });

  test("discarding a draft with a pull request says it closes it", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, drafts: [draft({ save: { ...NO_SAVE, pull: PULL, savedRevision: 3 } })] });
    await page.goto("/cooling");
    await page.getByTestId("draft-discard").click();
    await expect(page.getByTestId("draft-store")).toContainText("close its pull request");
    await page.getByTestId("draft-discard-yes").click();
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-draft", "");
    expect(s.drafts).toEqual([]);
  });

  test("a draft with no number changed has nothing to save, and a service that cannot Save offers none", async ({ page }) => {
    await service(page, { login: "octo", save: true, drafts: [draft({ numbers: numbers({ seed: "only-a-seed" }), save: NO_SAVE })] });
    await page.goto("/cooling");
    await expect(page.getByTestId("save")).toBeDisabled();
    await page.getByTestId("input-config.pieceKinds").fill("5");
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "4");
    await expect(page.getByTestId("save")).toBeEnabled();
    // A number the build refuses is not saved as a pull request.
    await page.getByTestId("input-config.streakMaxPercent").fill("20");
    await expect(page.getByTestId("save")).toBeDisabled();

    // A service from before Save: drafts as ever, and no Save.
    await page.unroute("http://localhost:8090/**");
    await service(page, { login: "octo", drafts: [draft()] });
    await page.goto("/cooling");
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-status", "saved");
    await expect(page.getByTestId("input-config.pieceKinds")).toHaveValue("5");
    await expect(saveRows(page)).toHaveCount(0);
  });
});
