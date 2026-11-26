import { expect, test, type Page } from "@playwright/test";
import { PUZZLE_IDS } from "@openseas/engine";
// The API pages are listed here, not imported: their module reads Markdown files, which only Vite can load.
const API_PAGES = [
  { slug: "", title: "The API" },
  { slug: "write-a-puzzle", title: "Write a puzzle" },
  { slug: "paths", title: "Paths, in full" },
  { slug: "rules", title: "Writing rules" },
];
const apiPath = (slug: string): string => (slug === "" ? "/api" : `/api/${slug}`);
import { DOMAIN_PAGES, domainPath } from "../src/domain/pages.js";

/**
 * Smoke: the site builds, its three areas open from the front page, every page of the domain and
 * the API renders, every guide renders with its pictures loaded, and nothing spills sideways.
 */

const fits = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Opens the side list where it is a drawer, as on a phone. */
async function openNav(page: Page): Promise<void> {
  const menu = page.getByTestId("open-menu");
  if (await menu.isVisible()) await menu.click();
}

test("the front page leads to all three areas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Puzzles, from the rules up" })).toBeVisible();
  for (const area of ["domain", "api", "guides"]) await expect(page.getByTestId(`card-${area}`)).toBeVisible();
  expect(await fits(page)).toBe(true);
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/domain$/);
  await expect(page.getByRole("heading", { level: 1, name: "What a puzzle is" })).toBeVisible();
  await page.getByTestId("brand").click();
  await expect(page).toHaveURL(/\/$/);
});

test("the domain section reads from page to page", async ({ page }) => {
  await page.goto("/domain");
  await openNav(page);
  await page.getByTestId("side-nav").getByRole("link", { name: "The round" }).click();
  await expect(page).toHaveURL(/\/domain\/round$/);
  await expect(page.getByRole("heading", { level: 1, name: "The round" })).toBeVisible();
  // A link inside the guide leads to the page its heading is on.
  await page.getByRole("link", { name: "The deal" }).first().click();
  await expect(page).toHaveURL(/\/domain\/deal$/);
  await page.getByTestId("pager-next").click();
  await expect(page).toHaveURL(/\/domain\/sides$/);
});

for (const p of DOMAIN_PAGES) {
  test(`the domain page "${p.title}" renders`, async ({ page }) => {
    await page.goto(domainPath(p.slug));
    await expect(page.getByRole("heading", { level: 1, name: p.title })).toBeVisible();
    await expect(page.locator(".prose")).toContainText(/\w{4}/);
    expect(await fits(page)).toBe(true);
  });
}

for (const p of API_PAGES) {
  test(`the API page "${p.title}" renders`, async ({ page }) => {
    await page.goto(apiPath(p.slug));
    await expect(page.getByRole("heading", { level: 1, name: p.title })).toBeVisible();
    await expect(page.locator(".prose h2").first()).toBeVisible();
    expect(await fits(page)).toBe(true);
  });
}

// The reference is listed here for the same reason: the three objects, and how many pages each has.
const OBJECTS = [
  { root: "puzzle", pages: 28 },
  { root: "skin", pages: 5 },
  { root: "theme", pages: 6 },
];

for (const o of OBJECTS) {
  test(`the ${o.root} object lists its fields, and every object under it has a page`, async ({ page }) => {
    await page.goto(`/api/${o.root}`);
    await expect(page.getByTestId(`ref-${o.root}`)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(o.root);
    expect(await fits(page)).toBe(true);
    const links = await page.getByTestId("ref-child").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    expect(links.length).toBe(o.pages);
    for (const href of links) {
      await page.goto(href);
      const key = href.split("/").pop()!;
      await expect(page.getByTestId(`ref-${o.root}-${key}`)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: key, exact: true })).toBeVisible();
      await expect(page.getByTestId("ref-fields")).toContainText(/\w{4}/);
      await expect(page.locator(".ref-side .code").first()).toBeAttached();
      expect(await fits(page), href).toBe(true);
    }
  });
}

test("an object's page names every value an enum takes, and opens at a field", async ({ page }) => {
  await page.goto("/api/puzzle/round#tempo-kind");
  const field = page.locator("#tempo-kind");
  await expect(field).toBeInViewport();
  for (const value of ["still", "ticking"]) await expect(field.locator(".values")).toContainText(value);
  await page.goto("/api/types");
  await expect(page.getByTestId("ref-types")).toBeVisible();
  expect(await fits(page)).toBe(true);
});

test("the search finds a field of the reference", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-search").click();
  await page.getByTestId("search").getByRole("searchbox").fill("logLimit");
  await expect(page.getByTestId("search-hit").first()).toContainText("logLimit");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/api\/puzzle\/round#loglimit$/);
});

test("the glossary narrows as it is typed into", async ({ page }) => {
  await page.goto("/domain/glossary");
  const all = await page.getByTestId("term").count();
  expect(all).toBeGreaterThan(100);
  await page.getByTestId("glossary-filter").fill("tally");
  await expect(page.getByTestId("term").first()).toContainText("Tally");
  expect(await page.getByTestId("term").count()).toBeLessThan(all);
});

test("an address with an anchor opens at its heading", async ({ page }) => {
  await page.goto("/api/rules#the-loop");
  await expect(page.locator("#the-loop")).toBeInViewport();
});

// The rules SDK is listed here as the reference is: its three objects, and how many pages each has.
const SDK = [
  { root: "hooks", pages: 21 },
  { root: "view", pages: 7 },
  { root: "context", pages: 2 },
];

for (const o of SDK) {
  test(`the SDK's ${o.root} page lists its members, and each has a page with its signature`, async ({ page }) => {
    await page.goto(`/api/${o.root}`);
    await expect(page.getByTestId(`sdk-${o.root}`)).toBeVisible();
    expect(await fits(page)).toBe(true);
    const links = await page.getByTestId("sdk-child").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    expect(links.length).toBe(o.pages);
    for (const href of links) {
      await page.goto(href);
      const name = href.split("/").pop()!;
      await expect(page.getByTestId(`sdk-${o.root}-${name}`)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
      await expect(page.locator(".sig").first()).toContainText(name);
      expect(await fits(page), href).toBe(true);
    }
  });
}

test("a hook's page says when it is asked, what it is given and what each answer means", async ({ page }) => {
  await page.goto("/api/hooks/canMove");
  await expect(page.getByTestId("sdk-stage")).toContainText("Check");
  await expect(page.getByTestId("sdk-params")).toContainText("View<P, S>");
  for (const value of ["null", "string"]) await expect(page.getByTestId("sdk-returns").locator(".values")).toContainText(value);
  // A name in a signature leads to where it is defined.
  await page.locator(".sig").first().getByRole("link", { name: "Move" }).click();
  await expect(page).toHaveURL(/\/api\/sdk#move$/);
  await expect(page.locator("#move")).toBeInViewport();
});

test("an event's builder is defined on the page of emit, and the SDK's types on one page", async ({ page }) => {
  await page.goto("/api/context/emit#e-arrive");
  await expect(page.locator("#e-arrive")).toBeInViewport();
  await expect(page.locator("#e-arrive .values")).toContainText("in place");
  expect(await page.getByTestId("sdk-inner").count()).toBe(11);
  await page.goto("/api/sdk");
  await expect(page.getByTestId("sdk-types")).toBeVisible();
  expect(await page.getByTestId("sdk-type").count()).toBeGreaterThan(25);
  expect(await fits(page)).toBe(true);
});

test("the search finds a hook and opens it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-search").click();
  await page.getByTestId("search").getByRole("searchbox").fill("onMoveEnd");
  await expect(page.getByTestId("search-hit").first()).toContainText("onMoveEnd");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/api\/hooks\/onMoveEnd$/);
  await expect(page.getByTestId("search")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "onMoveEnd" })).toBeVisible();
});

test("the guides list every puzzle and link to Cooling", async ({ page }) => {
  await page.goto("/guides");
  await expect(page.getByRole("heading", { level: 1, name: "Puzzle guides" })).toBeVisible();
  for (const id of PUZZLE_IDS) await expect(page.getByTestId(`guide-${id}`)).toBeVisible();
  await page.getByTestId("guide-cooling").click();
  await expect(page).toHaveURL(/\/guides\/cooling$/);
  await expect(page.getByRole("heading", { level: 1, name: "Cooling" })).toBeVisible();
  await page.getByTestId("back-home").click();
  await expect(page).toHaveURL(/\/guides$/);
});

for (const id of PUZZLE_IDS) {
  test(`the ${id} guide renders every rung and loads its pictures`, async ({ page }) => {
    await page.goto(`/guides/${id}`);
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
    expect(await fits(page)).toBe(true);
  });
}

test("a guide's old address leads to its new one", async ({ page }) => {
  await page.goto("/cooling#expert");
  await expect(page).toHaveURL(/\/guides\/cooling#expert$/);
  await expect(page.getByTestId("level-expert")).toHaveAttribute("aria-selected", "true");
});

test("an address with no page says so", async ({ page }) => {
  await page.goto("/nope");
  await expect(page.getByTestId("not-found")).toBeVisible();
  await page.goto("/domain/nope");
  await expect(page.getByTestId("not-found")).toBeVisible();
});
