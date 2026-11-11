import { expect, test, type Page } from "@playwright/test";
import { expectViewMatchesState } from "./helpers.js";

// The marks setting on every core board: each draws its kinds' marks from one geometry through the
// adapter for its surface (ADR 0041), on its pieces, in its legend, and on Plating's laid plates.
const BOARDS = ["cooling", "engines", "plating", "gunnery", "navigation", "battle", "swordfight"];

/** The setting is in the legend: beside the board on a wide screen, behind the details button on a phone. */
async function setMarks(page: Page, on: boolean): Promise<void> {
  const details = page.getByTestId("toggle-details");
  const phone = await details.isVisible();
  if (phone) await details.click();
  const toggle = page.getByTestId("toggle-marks");
  await toggle.setChecked(on);
  // The board takes keys again once the checkbox lets go of them.
  await toggle.blur();
  if (phone) await details.click();
}

for (const puzzle of BOARDS) {
  test(`${puzzle} draws its marks when the setting is on, and takes them off again`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.goto(`/${puzzle}?seed=marks-smoke&start=lab&paused=1`);
    await expect(page.getByTestId(`${puzzle}-canvas`)).toBeVisible();
    await expectViewMatchesState(page, puzzle);
    await setMarks(page, true);
    if (puzzle === "plating") {
      await page.keyboard.press("1");
      await page.keyboard.press("h");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("hud-moves")).toContainText("1");
    }
    await expectViewMatchesState(page, puzzle);
    await setMarks(page, false);
    await expectViewMatchesState(page, puzzle);
    expect(errors).toEqual([]);
  });
}
