import { expect, test } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

// Exercise the production build: a working dev URL is not enough for shared-package assets. Each
// atlas is built from its frame files by the build (ADR 0054) and served under its own name.
// The prototypes not restyled yet load theirs through the board kit (ADR 0037). The seven boards in the game and
// the restyled prototypes (Overload, Deflectors, Tug, Racks, Cutting, Scanner, Reactor) draw their pieces in code and load no atlas (ADR 0062), so none is listed here.
const CORE: string[] = [];
const PROTOTYPES = ["salvage"];

for (const puzzle of [...CORE, ...PROTOTYPES]) {
  test(`${puzzle} atlas loads, draws, and survives a resize`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    const image = page.waitForResponse((r) => r.url().includes(`/${puzzle}-`) && r.url().endsWith(".webp"));
    await page.goto(`/play/${puzzle}?seed=sprite-smoke&start=lab&paused=1`);
    expect((await image).ok()).toBe(true);
    const canvas = page.getByTestId(`${puzzle}-canvas`);
    await expect(canvas).toHaveAttribute("data-sprite-atlas", puzzle);
    await expect(canvas).toBeVisible();
    // Let the round reach its first drawn state before capturing the art.
    await expect(canvas).toHaveAttribute("data-view", /.+/);
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.width - 12, height: viewport.height - 12 });
    await expect(canvas).toBeVisible();
    // A diagnostic capture must not wait for an animated canvas to become a stable element.
    // The lab clock is paused; viewport capture also avoids element-screenshot scroll/stability waits.
    await testInfo.attach(`${puzzle}-sprites`, { body: await page.screenshot(), contentType: "image/png" });
    await page.setViewportSize(viewport);
    expect(errors).toEqual([]);
  });
}

test("a restyled board asks for no atlas and plays on pieces drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/cooling");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("cooling-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await expectViewMatchesState(page, "cooling");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Gunnery asks for no atlas and plays on pieces drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/gunnery");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("gunnery-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("d");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await expectViewMatchesState(page, "gunnery");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Navigation asks for no atlas and plays on stars drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/navigation");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("navigation-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toContainText("1");
  await expectViewMatchesState(page, "navigation");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Swordfighting asks for no atlas and plays on pieces drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/swordfight");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("swordfight-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expect(canvas).toHaveAttribute("data-falling", /\d/);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.down(" ");
  await expect(page.getByTestId("hud-moves")).toContainText("1", { timeout: 30_000 });
  await page.keyboard.up(" ");
  await expectViewMatchesState(page, "swordfight");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Space Battle asks for no atlas and plays on ships drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/battle");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("battle-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await page.keyboard.press("w");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /"move":"forward"/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("battle-board")).toHaveAttribute("data-board", /^1:/);
  await expectViewMatchesState(page, "battle");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Engines asks for no atlas and plays on pellets drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/engines");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("engines-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.down(" ");
  await expect(page.getByTestId("hud-moves")).toContainText("1", { timeout: 30_000 });
  await page.keyboard.up(" ");
  await expectViewMatchesState(page, "engines");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Scanner, a restyled kit board, asks for no atlas and plays on fog plates drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/scanner?seed=scan-1&start=lab");
  const canvas = page.getByTestId("scanner-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expectViewMatchesState(page, "scanner");
  // The pinned seed's last cell holds a contact (the Scanner smoke locks the same one): enter locks at the cursor.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "scanner");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("an unavailable atlas falls back to playable procedural art", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.webp", (route) => route.abort());
  await page.goto("/play/salvage?seed=sprite-smoke&start=lab");
  const canvas = page.getByTestId("salvage-canvas");
  await expect(canvas).toHaveAttribute("data-sprite-atlas", "fallback");
  await expectViewMatchesState(page, "salvage");
  expect(errors).toEqual([]);
});

test("a kit board whose atlas is unavailable draws its pieces in code and still plays", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.webp", (route) => route.abort());
  await page.goto("/play/salvage?seed=sprite-smoke&start=lab");
  const canvas = page.getByTestId("salvage-canvas");
  await expect(canvas).toHaveAttribute("data-sprite-atlas", "fallback");
  await expectViewMatchesState(page, "salvage");
  // Haul a line of three by drag: the content field is seven wide, and the deal always holds one.
  const W = 7;
  const board = (await page.getByTestId("salvage-board").getAttribute("data-board")) ?? "";
  const touching = (m: number, n: number): boolean => m !== n && Math.abs((m % W) - (n % W)) <= 1 && Math.abs(Math.floor(m / W) - Math.floor(n / W)) <= 1;
  const walk = (path: number[]): number[] | null => {
    if (path.length === 3) return path;
    const last = path[path.length - 1]!;
    for (let c = 0; c < board.length; c++) {
      if (path.includes(c) || !touching(last, c) || board[c] !== board[last]) continue;
      const found = walk([...path, c]);
      if (found) return found;
    }
    return null;
  };
  let line: number[] | null = null;
  for (let c = 0; c < board.length && !line; c++) if (/\d/.test(board[c]!)) line = walk([c]);
  expect(line, `a line of three on ${board}`).not.toBeNull();
  const { ox, oy, cell } = await boardGeom(page, "salvage");
  const at = (c: number): [number, number] => [ox + ((c % W) + 0.5) * cell, oy + (Math.floor(c / W) + 0.5) * cell];
  await page.mouse.move(...at(line![0]!));
  await page.mouse.down();
  for (const c of line!.slice(1)) await page.mouse.move(...at(c), { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "salvage");
  expect(errors).toEqual([]);
});

test("Overload, a restyled kit board, asks for no atlas and plays on capacitors drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/overload?seed=sprite-smoke&start=lab");
  const canvas = page.getByTestId("overload-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expectViewMatchesState(page, "overload");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "overload");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Deflectors, a restyled kit board, asks for no atlas and plays on mirrors drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/deflectors?seed=sprite-smoke&start=lab");
  const canvas = page.getByTestId("deflectors-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expectViewMatchesState(page, "deflectors");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Tug, a restyled kit board, asks for no atlas and plays on pods drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/tug?seed=tug-2&start=lab");
  const canvas = page.getByTestId("tug-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expectViewMatchesState(page, "tug");
  // The pinned seed's second pod can slide down (the Tug smoke plays the same flick).
  await page.keyboard.press("2");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "tug");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Racks, a restyled kit board, asks for no atlas and plays on fuel cells drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/racks?seed=sprite-smoke&start=lab");
  const canvas = page.getByTestId("racks-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expectViewMatchesState(page, "racks");
  // C calls the crate down: an action whatever the deal.
  await page.keyboard.press("c");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "racks");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Cutting, a restyled kit board, asks for no atlas and plays on ores drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/cutting?seed=sprite-smoke&start=lab");
  const canvas = page.getByTestId("cutting-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expectViewMatchesState(page, "cutting");
  // The first key lines a cut up down the middle of the slab and enter makes it: a cut whatever the deal.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "cutting");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});

test("Reactor, a restyled kit board, asks for no atlas and plays on rods drawn in code", async ({ page }) => {
  const errors: string[] = [];
  const images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".webp")) images.push(r.url());
  });
  await page.goto("/play/reactor?seed=sprite-smoke&start=lab");
  const canvas = page.getByTestId("reactor-canvas");
  await expect(canvas).toHaveAttribute("data-view", /.+/);
  await expect(canvas).toHaveAttribute("data-pieces", "drawn");
  await expect(canvas).not.toHaveAttribute("data-sprite-atlas");
  await expectViewMatchesState(page, "reactor");
  // A swipe the board cannot make is refused, so try each way: one of them moves.
  for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) await page.keyboard.press(key);
  await expect(page.getByTestId("hud-moves")).not.toHaveText("0");
  await expectViewMatchesState(page, "reactor");
  expect(images).toEqual([]);
  expect(errors).toEqual([]);
});
