import { expect, test, type Page } from "@playwright/test";
import { expectViewMatchesState } from "./helpers.js";

/**
 * Tester links by id (ADR 0042 decision 11, ADR 0043). No service runs under the smoke: these
 * tests answer for it, at the address the build was given (playwright.config.ts), with what the
 * real one answers. The service's own tests (packages/studio-server) hold it to the same shapes.
 */
const SERVICE = "http://localhost:8090";
const LINK = "abcdefgh23";

interface Link {
  id: string;
  puzzle: string;
  name: string;
  author: string;
  draft: { seed: string | null; overrides: Record<string, unknown>; roundSeconds: number | null; paceSeconds: number | null; thresholds: null };
  createdAt: string;
  withdrawn: boolean;
}

const link = (over: Partial<Link> = {}): Link => ({
  id: LINK,
  puzzle: "cooling",
  name: "Five kinds",
  author: "octo",
  draft: { seed: "link-1", overrides: { pieceKinds: 5 }, roundSeconds: 60, paceSeconds: null, thresholds: null },
  createdAt: "2026-11-13T12:00:00.000Z",
  withdrawn: false,
  ...over,
});

/** A stand-in service: one owner, and whatever links the test gives it. */
async function service(page: Page, o: { login: string | null; links?: Link[] }): Promise<{ made: unknown[]; withdrawn: string[] }> {
  const links = [...(o.links ?? [])];
  const calls = { made: [] as unknown[], withdrawn: [] as string[] };
  await page.route(`${SERVICE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": req.headers().origin ?? "*", "Access-Control-Allow-Credentials": "true" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": req.headers().origin ?? "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" } });
    if (url.pathname === "/auth/me") return json(200, { login: o.login, signIn: true, dev: false });
    const id = /^\/links\/(.+)$/.exec(url.pathname)?.[1];
    if (id && req.method() === "GET") {
      const found = links.find((l) => l.id === id);
      return found ? (found.withdrawn ? json(410, { error: "withdrawn" }) : json(200, found)) : json(404, { error: "not_found" });
    }
    if (!o.login) return json(401, { error: "unauthorized" });
    if (url.pathname === "/links" && req.method() === "GET") return json(200, { links: links.filter((l) => l.puzzle === url.searchParams.get("puzzle") && !l.withdrawn) });
    if (url.pathname === "/links" && req.method() === "POST") {
      const body = req.postDataJSON() as { puzzle: string; name: string; draft: Link["draft"] };
      calls.made.push(body);
      const made = link({ id: "zzzzzzzz99", puzzle: body.puzzle, name: body.name, draft: body.draft, author: o.login });
      links.unshift(made);
      return json(201, made);
    }
    if (id && req.method() === "DELETE") {
      calls.withdrawn.push(id);
      const found = links.find((l) => l.id === id);
      if (found) found.withdrawn = true;
      return json(200, found);
    }
    return json(404, { error: "not_found" });
  });
  return calls;
}

test("a tester link plays its puzzle alone on the frozen numbers, and says whose draft it is", async ({ page }) => {
  await service(page, { login: null, links: [link()] });
  await page.goto(`/play/${LINK}`);
  await expect(page.getByTestId("play")).toBeVisible();
  await expect(page.getByTestId("play-link")).toContainText("Five kinds");
  await expect(page.getByTestId("play-link")).toContainText("octo");
  await expect(page.getByTestId("play-tuned")).toContainText("2");
  await expect(page.getByTestId("hud-time")).toHaveText("1:00");

  await page.getByTestId("toggle-details").click();
  await expect(page.getByTestId("play-link-name")).toContainText("Five kinds");
  await expect(page.getByTestId("play-changes").locator("[data-key='config.pieceKinds']")).toContainText("5");
  await expect(page.getByTestId("play-seed")).toContainText("link-1");
  await page.getByTestId("toggle-details").click();

  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "cooling");
  const dealt = (await page.getByTestId("cooling-board").getAttribute("data-board")) ?? "";
  // Five kinds only: nothing of the sixth or seventh is on the board.
  expect(dealt.split(",").filter((k) => k === "5" || k === "6")).toEqual([]);
  // The address is the link's and stays so, whatever the page does with its seed.
  await page.getByTestId("toggle-details").click();
  await page.getByTestId("play-new-seed").click();
  await expect(page).toHaveURL(new RegExp(`/play/${LINK}$`));
});

test("a link that was withdrawn, never was, or cannot be fetched says which and deals nothing", async ({ page }) => {
  await service(page, { login: null, links: [link({ withdrawn: true })] });
  await page.goto(`/play/${LINK}`);
  await expect(page.getByTestId("play-withdrawn")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);

  await page.goto("/play/nosuchlink");
  await expect(page.getByTestId("play-unknown")).toBeVisible();

  await page.unroute(`${SERVICE}/**`);
  await page.route(`${SERVICE}/**`, (route) => route.abort());
  await page.goto(`/play/${LINK}`);
  await expect(page.getByTestId("play-unreachable")).toBeVisible();
});

test("a link the current build would refuse says so and deals nothing", async ({ page }) => {
  await service(page, { login: null, links: [link({ draft: { seed: null, overrides: { width: 1 }, roundSeconds: null, paceSeconds: null, thresholds: null } })] });
  await page.goto(`/play/${LINK}`);
  await expect(page.getByTestId("play-refused")).toContainText("config.width");
  await expect(page.getByTestId("play-start")).toHaveCount(0);
});

test("the signed-in owner freezes a draft as a link, sees the puzzle's links, and withdraws one", async ({ page, context }) => {
  test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const calls = await service(page, { login: "octo", links: [link()] });
  await page.goto("/cooling?seed=studio-9&c.pieceKinds=4&seconds=45");
  const panel = page.getByTestId("tester-links");
  await expect(panel).toContainText("octo");
  await expect(page.getByTestId(`link-${LINK}`)).toContainText("Five kinds");

  await expect(page.getByTestId("link-make")).toBeDisabled();
  await page.getByTestId("link-name").fill("Four kinds, short");
  await page.getByTestId("link-make").click();
  await expect(page.getByTestId("link-zzzzzzzz99")).toContainText("Four kinds, short");
  expect(calls.made).toEqual([{ puzzle: "cooling", name: "Four kinds, short", draft: { seed: "studio-9", overrides: { pieceKinds: 4 }, roundSeconds: 45, paceSeconds: null, thresholds: null } }]);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/play\/zzzzzzzz99$/);

  await page.getByTestId(`link-withdraw-${LINK}`).click();
  await expect(page.getByTestId(`link-${LINK}`)).toHaveCount(0);
  expect(calls.withdrawn).toEqual([LINK]);

  // A refused draft cannot be frozen.
  await page.getByTestId("link-name").fill("Broken");
  await page.getByTestId("input-config.streakMaxPercent").fill("20");
  await expect(page.getByTestId("link-make")).toBeDisabled();
});

test("without a session the panel offers sign-in, and without the service the studio carries on", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool");
  await service(page, { login: null });
  await page.goto("/cooling");
  await expect(page.getByTestId("sign-in-github")).toHaveAttribute("href", new RegExp(`^${SERVICE}/auth/github\\?return=`));
  await expect(page.getByTestId("link-make")).toHaveCount(0);

  await page.unroute(`${SERVICE}/**`);
  await page.route(`${SERVICE}/**`, (route) => route.abort());
  await page.goto("/cooling");
  await expect(page.getByTestId("links-unreachable")).toBeVisible();
  await expect(page.getByTestId("copy-play-link")).toBeEnabled();
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("cooling-canvas")).toBeVisible();
});
