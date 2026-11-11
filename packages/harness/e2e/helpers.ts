import { expect, type Page } from "@playwright/test";

/**
 * Once the board settles, what the canvas draws must be the engine's board, piece for piece. Both
 * attributes are read in one evaluation so a board that advances on a clock cannot change between
 * the reads, and so a slow CI runner spends one round trip per poll, not two.
 */
export async function expectViewMatchesState(page: Page, puzzle: string): Promise<void> {
  await expect(async () => {
    const [want, shown] = await page.evaluate(
      (id) => [
        document.querySelector(`[data-testid="${id}-board"]`)?.getAttribute("data-board") ?? null,
        document.querySelector(`[data-testid="${id}-canvas"]`)?.getAttribute("data-view") ?? null,
      ],
      puzzle,
    );
    expect(want).toBeTruthy();
    expect(shown).toBe(want);
  }).toPass({ timeout: 15_000 });
}

/** On phones the bench is a sheet behind a button; on wide screens it is always there. */
export async function openBench(page: Page): Promise<void> {
  const toggle = page.getByTestId("bench-toggle");
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}
export async function closeBench(page: Page): Promise<void> {
  const toggle = page.getByTestId("bench-toggle");
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
}

/**
 * Where a kit board's grid sits on the page, from the `data-geom` its canvas publishes: the origin and the cell size in page pixels.
 * The canvas is scrolled into view first, as a player would: a click the start card scrolled to, or the scroll the home page
 * kept, can leave the top of a board above the window, where a tap at a cell's point lands on the page, not the board.
 */
export async function boardGeom(page: Page, puzzle: string): Promise<{ ox: number; oy: number; cell: number }> {
  const canvas = page.getByTestId(`${puzzle}-canvas`);
  await expect(canvas).toHaveAttribute("data-geom", /^-?\d+,-?\d+,[\d.]+$/);
  await canvas.scrollIntoViewIfNeeded();
  const [gx, gy, cell] = ((await canvas.getAttribute("data-geom")) ?? "").split(",").map(Number) as [number, number, number];
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  return { ox: box.x + gx, oy: box.y + gy, cell };
}
