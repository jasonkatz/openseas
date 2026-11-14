import { expect, test, type Page } from "@playwright/test";

/**
 * Drafts kept by the service (ADR 0045). No service runs under the smoke: these tests answer for
 * it, as e2e/links.spec.ts does, with what the real one answers (packages/studio-server holds it
 * to the same shapes).
 */
const SERVICE = "http://localhost:8090";

interface Numbers {
  seed: string | null;
  overrides: Record<string, unknown>;
  roundSeconds: number | null;
  paceSeconds: number | null;
  thresholds: null;
}
interface Draft {
  id: string;
  puzzle: string;
  owner: string;
  numbers: Numbers;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

const numbers = (over: Partial<Numbers> = {}): Numbers => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, ...over });
const draft = (over: Partial<Draft> = {}): Draft => ({ id: "draftdraft", puzzle: "cooling", owner: "octo", numbers: numbers({ overrides: { pieceKinds: 5 } }), revision: 3, createdAt: "2026-11-13T12:00:00.000Z", updatedAt: "2026-11-13T12:00:00.000Z", ...over });

interface Service {
  drafts: Draft[];
  /** Every request that would change a draft, as `METHOD path`, with its body. */
  writes: Array<{ call: string; body: unknown }>;
  /** Every request at all. */
  calls: string[];
  /** Set to answer the next saves as the real service would when it cannot or will not take them. */
  fail: null | "conflict" | "down";
}

/** A stand-in service: one owner (or nobody), and the drafts the test gives it, kept as the real one keeps them. */
async function service(page: Page, o: { login: string | null; drafts?: Draft[] }): Promise<Service> {
  const s: Service = { drafts: [...(o.drafts ?? [])], writes: [], calls: [], fail: null };
  await page.route(`${SERVICE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { "Access-Control-Allow-Origin": req.headers().origin ?? "*", "Access-Control-Allow-Credentials": "true" };
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" } });
    s.calls.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === "/auth/me") return json(200, { login: o.login, signIn: true, dev: false });
    if (url.pathname === "/auth/sign-out") {
      o.login = null;
      return json(200, { ok: true });
    }
    if (!o.login) return json(401, { error: "unauthorized" });
    if (url.pathname === "/links") return json(200, { links: [] });
    const id = /^\/drafts\/(.+)$/.exec(url.pathname)?.[1];
    if (url.pathname === "/drafts" && req.method() === "GET") {
      const puzzle = url.searchParams.get("puzzle");
      return json(200, { drafts: s.drafts.filter((d) => !puzzle || d.puzzle === puzzle) });
    }
    if (url.pathname !== "/drafts" && !id) return json(404, { error: "not_found" });
    s.writes.push({ call: `${req.method()} ${url.pathname}`, body: req.postDataJSON() as unknown });
    if (s.fail === "down") return route.abort();
    if (s.fail === "conflict") return json(409, { error: "conflict" });
    if (req.method() === "POST") {
      const body = req.postDataJSON() as { puzzle: string; numbers: Numbers };
      if (s.drafts.some((d) => d.puzzle === body.puzzle)) return json(409, { error: "conflict" });
      const made = draft({ id: "newdraft22", puzzle: body.puzzle, numbers: body.numbers, revision: 1 });
      s.drafts.push(made);
      return json(201, made);
    }
    const found = s.drafts.find((d) => d.id === id);
    if (!found) return json(404, { error: "not_found" });
    if (req.method() === "PUT") {
      const body = req.postDataJSON() as { numbers: Numbers; revision: number };
      if (body.revision !== found.revision) return json(409, { error: "conflict" });
      found.numbers = body.numbers;
      found.revision += 1;
      return json(200, found);
    }
    if (req.method() === "DELETE") {
      s.drafts = s.drafts.filter((d) => d.id !== id);
      return json(200, { ok: true });
    }
    return json(404, { error: "not_found" });
  });
  return s;
}

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
