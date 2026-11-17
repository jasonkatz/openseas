import { expect, test } from "@playwright/test";

/**
 * A phone's browser lets a page make no sound until the player has touched it, and only from
 * inside that touch. A board plays its cues a frame or more after the touch that caused them, so
 * the audio context has to be started by the touch itself (`boards/src/audio.ts`), or the game is
 * silent for good on a phone. Chromium on a desktop lets a page play at once; this flag makes it
 * hold a page to a gesture as a phone does. It is a launch option, so the test has a file of its own.
 */
test.use({
  launchOptions: {
    args: ["--autoplay-policy=document-user-activation-required"],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
});

const state = (page: import("@playwright/test").Page): Promise<string> => page.evaluate(() => (window as unknown as { openseasAudioState(): string }).openseasAudioState());

test("the first touch anywhere starts the sound, before any cue is asked for", async ({ page }) => {
  await page.goto("/play/cooling?seed=sound-1");
  await expect(page.getByTestId("play-start")).toBeVisible();
  // Nothing has been touched: there is no context yet, or one the browser holds suspended.
  expect(["none", "suspended"]).toContain(await state(page));
  // A touch that plays nothing: opening the details panel. It is still the player's gesture, and
  // the only chance the page may get before a board asks for a cue from a frame of its own.
  await page.getByTestId("toggle-details").click();
  await expect.poll(() => state(page)).toBe("running");
});
