import { expect, test } from "@playwright/test";
import { expectViewMatchesState, shown } from "./helpers.js";
import { NO_SAVE, SERVICE, draft, numbers, service } from "./standin.js";

/**
 * The Sounds mode (DESIGN.md 3.14, ADR 0062 decision 5): a plain list of the puzzle's cues, each
 * with a button that plays it. Desktop only, as the studio is. There is no sample to pick, no
 * take and no file to try, and no Sprites mode: every board draws its pieces and synthesizes its
 * cues in code. What a draft, a link or an address kept of picks before then, of a sprite or a
 * sound, is read and passed over (ADR 0063, ADR 0064), and the later tests here hold the studio
 * to that.
 */
const desktopOnly = (): void => test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool");

test("the Sounds mode lists every cue the puzzle's board plays, each with a button that plays it, and nothing to pick", async ({ page }) => {
  desktopOnly();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  // Count the tones the page asks the browser for: a cue played is at least one.
  await page.addInitScript(() => {
    const w = window as unknown as { tones: number };
    w.tones = 0;
    const make = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.tones++;
      return make.call(this);
    };
  });
  const tones = (): Promise<number> => page.evaluate(() => (window as unknown as { tones: number }).tones);
  await page.goto("/swordfight?seed=assets-2");
  await page.getByTestId("tab-sounds").click();
  // The puzzle's own cues, the shared ones its board plays, the beat's, and the round's.
  for (const cue of ["clash", "heavy", "thud", "beat", "start", "end"]) await expect(await shown(page, `cue-${cue}`)).toBeVisible();
  // A puzzle's own cue says which cues it plays.
  await expect(page.getByTestId("cue-heavy")).toContainText("zap + thud");

  let before = await tones();
  for (const cue of ["thud", "clash", "beat"]) {
    await (await shown(page, `cue-play-${cue}`)).click();
    await expect.poll(tones, `${cue} plays`).toBeGreaterThan(before);
    before = await tones();
  }

  // A list to listen to, and nothing more: no file, no take, no voice to choose, no message to the chat.
  const panel = page.getByTestId("sounds");
  await expect(panel.locator("input[type=file]")).toHaveCount(0);
  await expect(panel.locator("[data-testid^=take-], [data-testid^=cue-file-], [data-testid^=cue-shipped-], [data-testid^=cue-synth-], [data-testid^=ask-]")).toHaveCount(0);
  await expect(panel.locator("button")).toHaveCount(await panel.locator("[data-testid^=cue-play-]").count());
  await expect(page.getByTestId("tab-sprites")).toHaveCount(0);
  // Listening changes nothing of the draft or the address.
  await expect(page.getByTestId("changed-count")).not.toContainText("1");
  expect(new URL(page.url()).search).toBe("?seed=assets-2");
  expect(errors).toEqual([]);
});

test("a draft kept with picks, of a sprite and of sounds, opens as one that picks nothing, and is saved without them", async ({ page }) => {
  desktopOnly();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const old = "e".repeat(64);
  // A row as the service kept it before ADR 0062: a take picked for a frame and for a cue, and a cue held to its synthesized voice.
  const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ puzzle: "salvage", numbers: numbers({ overrides: { kinds: 6 }, picks: { sprites: { "debris-gold": old }, sounds: { pop: old, thud: "synth" } } }), save: NO_SAVE })] });
  await page.goto("/salvage");
  await expect(page.getByTestId("studio")).toBeVisible();
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "salvage");
  // The draft is the stored one, with its number; the picks are counted nowhere and asked for nowhere.
  await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "3");
  await expect(page.getByTestId("changed-count")).toContainText("1");
  await expect(page.locator("[data-testid^=change-sounds-], [data-testid^=change-sprites-]")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
  expect(s.calls.filter((c) => c.includes("/takes"))).toEqual([]);
  // Opening it saved nothing over it: the page takes it for the draft it is.
  expect(s.writes).toEqual([]);
  // A change is saved over it without the picks: the page never writes one.
  await (await shown(page, "input-config.kinds")).fill("4");
  await expect.poll(() => s.drafts[0]!.numbers.overrides).toEqual({ kinds: 4 });
  expect(s.drafts[0]!.numbers).not.toHaveProperty("picks");
  expect(errors).toEqual([]);
});

test("an address kept with picks still opens on /play, and asks the service for nothing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const old = "f".repeat(64);
  const asked: string[] = [];
  await page.route(`${SERVICE}/**`, (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 404, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: '{"error":"not_found"}' });
  });
  await page.goto(`/play/salvage?seed=picks-1&c.kinds=6&sprite.debris-gold=${old}&sound.pop=${old}&sound.thud=synth`);
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("salvage-canvas")).toHaveAttribute("data-pieces", "drawn");
  await expectViewMatchesState(page, "salvage");
  // The number in the address is played; the picks are read past, counted nowhere and reported nowhere.
  await page.getByTestId("toggle-details").click();
  await expect(page.getByTestId("play-picks")).toHaveCount(0);
  expect(asked).toEqual([]);
  expect(errors).toEqual([]);
});

test("a tester link frozen with picks still plays, on its numbers, and no take is asked for", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const old = "c".repeat(64);
  const asked: string[] = [];
  // A link as the service sent it before ADR 0062, and as one older than the site still would.
  const link = { id: "abcdefgh23", puzzle: "salvage", name: "Six kinds, a new pop", author: "octo", draft: { seed: "link-picks", overrides: { kinds: 6 }, roundSeconds: null, paceSeconds: null, thresholds: null, picks: { sprites: { crate: old }, sounds: { pop: old, thud: "synth" } } }, createdAt: "2026-11-13T12:00:00.000Z", withdrawn: false };
  await page.route(`${SERVICE}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    asked.push(path);
    const headers = { "Access-Control-Allow-Origin": "*" };
    return path === `/links/${link.id}` ? route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(link) }) : route.fulfill({ status: 404, contentType: "application/json", headers, body: '{"error":"not_found"}' });
  });
  await page.goto(`/play/${link.id}`);
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "salvage");
  await page.getByTestId("toggle-details").click();
  await expect(page.getByTestId("play-picks")).toHaveCount(0);
  expect([...new Set(asked)]).toEqual([`/links/${link.id}`]);
  expect(errors).toEqual([]);
});
