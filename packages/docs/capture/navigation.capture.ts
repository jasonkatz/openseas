import { test } from "@playwright/test";
import { canvasBox, hidePointer, openLab, still } from "./lib.js";

test("navigation: look", async ({ page }) => {
  await openLab(page, "navigation", { seed: "look-1", speed: 0.25 });
  await hidePointer(page);
  await still(page, "navigation", "board");
  console.log(await canvasBox(page, "navigation"), await page.getByTestId("navigation-canvas").getAttribute("data-geom"));
});
