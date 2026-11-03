import { expect, test } from "@playwright/test";

/**
 * Smoke: the game builds and loads without the server. The puzzle boards are smoked in the
 * harness (packages/harness/e2e), which drives the same board code (ADR 0019). This grows into
 * the shell smoke described in DESIGN.md 5.4 as M3 lands.
 */
test("the game opens on the masthead and says the server is out of reach", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "openseas" })).toBeVisible();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByTestId("shell-note")).toBeVisible();
});
