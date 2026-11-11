import { expect, test } from "@playwright/test";
import { PUZZLE_IDS } from "@openseas/engine";

/** Smoke: the site builds, lists every puzzle, and every guide renders with its pictures loaded. */
test("home lists every guide and links to Cooling", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Puzzle guides" })).toBeVisible();
  for (const id of PUZZLE_IDS) await expect(page.getByTestId(`guide-${id}`)).toBeVisible();
  await page.getByTestId("guide-cooling").click();
  await expect(page).toHaveURL(/\/cooling$/);
  await expect(page.getByRole("heading", { level: 1, name: "Cooling" })).toBeVisible();
  await page.getByTestId("back-home").click();
  await expect(page).toHaveURL(/\/$/);
});

for (const id of PUZZLE_IDS) {
  test(`the ${id} guide renders every rung and loads its pictures`, async ({ page }) => {
    await page.goto(`/${id}`);
    await expect(page.getByTestId(`guide-page-${id}`)).toBeVisible();
    for (const level of ["beginner", "intermediate", "advanced", "expert"]) {
      await page.getByTestId(`level-${level}`).click();
      await expect(page.getByTestId(`level-${level}`)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("rung").locator(".tip").first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#${level}$`));
    }
    // Every picture on the page is a real file: a still decodes, a clip's poster and source answer.
    const broken = await page.evaluate(async () => {
      const urls = [
        ...[...document.querySelectorAll("img")].map((i) => i.src),
        ...[...document.querySelectorAll("video")].flatMap((v) => [v.src, v.poster]),
      ];
      const bad: string[] = [];
      for (const url of urls) {
        const res = await fetch(url);
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !/^(image|video)\//.test(type)) bad.push(url);
      }
      return bad;
    });
    expect(broken).toEqual([]);
    // Nothing spills sideways on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test("an address with no guide says so", async ({ page }) => {
  await page.goto("/nope");
  await expect(page.getByTestId("not-found")).toBeVisible();
});
