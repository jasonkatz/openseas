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

/** Where a kit board's grid sits on the page, from the `data-geom` its canvas publishes: the origin and the cell size in page pixels. */
export async function boardGeom(page: Page, puzzle: string): Promise<{ ox: number; oy: number; cell: number }> {
  const canvas = page.getByTestId(`${puzzle}-canvas`);
  await expect(canvas).toHaveAttribute("data-geom", /^-?\d+,-?\d+,[\d.]+$/);
  const [gx, gy, cell] = ((await canvas.getAttribute("data-geom")) ?? "").split(",").map(Number) as [number, number, number];
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  return { ox: box.x + gx, oy: box.y + gy, cell };
}
