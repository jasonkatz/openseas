import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectViewMatchesState } from "./helpers.js";
import { NO_SAVE, SERVICE, draft, service } from "./standin.js";

/**
 * The sprite and sound panels (DESIGN.md 3.14, ADR 0050), and the swap they drive: a frame or a
 * cue given another picture or sound under a running board. No service answers in these tests:
 * the panels ask it nothing. Desktop only, as the studio is.
 */
const frames = JSON.parse(readFileSync(new URL("../../boards/src/sprites/frames.json", import.meta.url), "utf8")) as Record<string, Record<string, number[]>>;
const desktopOnly = (): void => test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool");

/** A second of quiet as a WAV file: enough for the browser to decode. */
function wav(): Buffer {
  const samples = 4410;
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24);
  b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), 44 + i * 2);
  return b;
}

const href = (page: Page, frame: string): Promise<string | null> => page.getByTestId(`frame-${frame}`).locator("image").first().getAttribute("href");

for (const puzzle of ["cooling", "salvage"]) {
  test(`${puzzle}: every frame has a row, and a file tried in one is drawn on the running board`, async ({ page }, testInfo) => {
    desktopOnly();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    const asked: string[] = [];
    page.on("request", (r) => {
      if (/\/(takes|drafts|links)/.test(new URL(r.url()).pathname) && r.url().startsWith("http://localhost:8090")) asked.push(r.url());
    });
    await page.goto(`/${puzzle}?seed=assets-1`);
    await page.getByTestId("play-start").click();
    const canvas = page.getByTestId(`${puzzle}-canvas`);
    await expect(canvas).toHaveAttribute("data-sprite-atlas", puzzle);
    await expectViewMatchesState(page, puzzle);
    const before = await page.getByTestId(`${puzzle}-board`).getAttribute("data-board");

    await page.getByTestId("tab-sprites").click();
    await expect(page.getByTestId("tuning")).toBeHidden();
    const names = Object.keys(frames[puzzle]!);
    for (const name of names) await expect(page.getByTestId(`frame-${name}`)).toHaveCount(1);
    // The page's own legend, with its marks toggle: each kind seen with marks and without (rule 6).
    const legend = page.getByTestId("sprite-legend");
    await legend.getByTestId("toggle-marks").check();
    await legend.getByTestId("toggle-marks").uncheck();

    const frame = names[0]!;
    expect(await href(page, frame)).not.toMatch(/^blob:/);
    await testInfo.attach(`${puzzle}-before`, { body: await page.screenshot(), contentType: "image/png" });
    // Any picture will do for a take: here, a picture of the tabs.
    const picture = await page.getByTestId("tab-sprites").screenshot();
    await page.getByTestId(`frame-file-${frame}`).setInputFiles({ name: "take.png", mimeType: "image/png", buffer: picture });
    await expect(page.getByTestId(`frame-${frame}`)).toHaveAttribute("data-tried", "1");
    await expect(page.getByTestId(`frame-pick-${frame}`)).toContainText("take.png");
    expect(await href(page, frame)).toMatch(/^blob:/);
    // The board was made again, on the same round, and still draws the engine's board.
    await expect(canvas).toHaveAttribute("data-sprite-atlas", puzzle);
    await expectViewMatchesState(page, puzzle);
    expect(await page.getByTestId(`${puzzle}-board`).getAttribute("data-board")).toBe(before);
    await testInfo.attach(`${puzzle}-tried`, { body: await page.screenshot(), contentType: "image/png" });

    await page.getByTestId(`frame-back-${frame}`).click();
    await expect(page.getByTestId(`frame-${frame}`)).toHaveAttribute("data-tried", "0");
    expect(await href(page, frame)).not.toMatch(/^blob:/);
    await expectViewMatchesState(page, puzzle);

    // A file that is no picture is refused where it was tried, and nothing changes.
    await page.getByTestId(`frame-file-${frame}`).setInputFiles({ name: "not.png", mimeType: "image/png", buffer: Buffer.from("no picture") });
    await expect(page.getByTestId(`frame-${frame}`).locator(".tune-refusal")).toBeVisible();
    await expect(page.getByTestId(`frame-${frame}`)).toHaveAttribute("data-tried", "0");

    await page.getByTestId("tab-tuning").click();
    await expect(page.getByTestId("tuning")).toBeVisible();
    expect(asked).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("every cue has a row that plays, the synthesized cue is the pick, and a file can be tried in its place", async ({ page }) => {
  desktopOnly();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.goto("/swordfight?seed=assets-2");
  await page.getByTestId("tab-sounds").click();
  // The puzzle's own cues, the shared ones its board plays, and the round's.
  for (const cue of ["clash", "heavy", "thud", "start", "end"]) await expect(page.getByTestId(`cue-${cue}`)).toHaveAttribute("data-voice", "synth");
  await page.getByTestId("cue-play-clash").click();
  await page.getByTestId("cue-play-thud").click();

  await page.getByTestId("cue-file-clash").setInputFiles({ name: "clash.wav", mimeType: "audio/wav", buffer: wav() });
  await expect(page.getByTestId("cue-clash")).toHaveAttribute("data-voice", "file");
  await expect(page.getByTestId("cue-file-name-clash")).toContainText("clash.wav");
  await page.getByTestId("cue-play-clash").click();
  // The synthesized cue is picked again with a tap.
  await page.getByTestId("cue-shipped-clash").click();
  await expect(page.getByTestId("cue-clash")).toHaveAttribute("data-voice", "synth");

  await page.getByTestId("cue-file-thud").setInputFiles({ name: "not.wav", mimeType: "audio/wav", buffer: Buffer.from("no sound") });
  await expect(page.getByTestId("cue-thud").locator(".tune-refusal")).toBeVisible();
  await expect(page.getByTestId("cue-thud")).toHaveAttribute("data-voice", "synth");
  expect(errors).toEqual([]);
});

test("a turn's takes appear in their rows, a tap puts one on the board, and a row writes the start of a message", async ({ page }) => {
  desktopOnly();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const s = await service(page, { login: "octo", save: true, chat: true, takes: [], drafts: [draft({ save: NO_SAVE })] });
  await page.goto("/cooling");
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "cooling");
  await page.getByTestId("tab-sprites").click();
  const frame = Object.keys(frames.cooling!)[0]!;
  await expect(page.getByTestId(`frame-takes-${frame}`)).toHaveCount(0);

  // The row asks the agent, in the chat's own box, for the owner to finish.
  await page.getByTestId(`ask-new-${frame}`).click();
  await expect(page.getByTestId("chat-input")).toHaveValue(`Make new takes of the ${frame} frame. `);
  await expect(page.getByTestId("chat-input")).toBeFocused();
  await page.getByTestId(`ask-change-${frame}`).click();
  await expect(page.getByTestId("chat-input")).toHaveValue(`Change the ${frame} frame: `);
  await page.getByTestId(`ask-new-${frame}`).click();
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-working")).toBeVisible();

  // The turn makes two takes and ends: one on this draft, numbered as the script numbered it, and one from another draft's library.
  const picture = await page.getByTestId("tab-sprites").screenshot();
  const mine = "a".repeat(64);
  const other = "b".repeat(64);
  s.takes.push({ hash: mine, kind: "sprite", puzzle: "cooling", name: frame, draft: "draftdraft", take: 1, prompt: "A brass cog.", body: picture, contentType: "image/png" });
  s.takes.push({ hash: other, kind: "sprite", puzzle: "cooling", name: frame, draft: "gonedraft1", take: 4, body: picture, contentType: "image/png" });
  s.takes.push({ hash: "c".repeat(64), kind: "sound", puzzle: "cooling", name: "clear", draft: "draftdraft", take: 2, body: wav(), contentType: "audio/wav" });
  s.chat.running = false;
  s.say("turn", { status: "done", commit: null, costUsd: 0.5, reverted: false });
  await expect(page.getByTestId("take-aaaaaaaa")).toHaveText("take 1");
  await expect(page.getByTestId("take-bbbbbbbb")).toHaveText("take bbbbbb");
  await expect(page.getByTestId("take-aaaaaaaa")).toHaveAttribute("title", "A brass cog.");

  await page.getByTestId("take-aaaaaaaa").click();
  await expect(page.getByTestId(`frame-${frame}`)).toHaveAttribute("data-tried", "1");
  await expect(page.getByTestId(`frame-pick-${frame}`)).toHaveText("On the board: take 1");
  expect(await href(page, frame)).toBe(`${SERVICE}/takes/${mine}`);
  await expect(page.getByTestId("cooling-canvas")).toHaveAttribute("data-sprite-atlas", "cooling");
  await expectViewMatchesState(page, "cooling");
  await page.getByTestId(`frame-back-${frame}`).click();
  await expect(page.getByTestId(`frame-${frame}`)).toHaveAttribute("data-tried", "0");

  // A cue's take is a button in its row: a tap gives the cue that voice.
  await page.getByTestId("tab-sounds").click();
  await page.getByTestId("take-cccccccc").click();
  await expect(page.getByTestId("cue-clear")).toHaveAttribute("data-voice", "take");
  await page.getByTestId("cue-shipped-clear").click();
  await expect(page.getByTestId("cue-clear")).toHaveAttribute("data-voice", "synth");
  expect(errors).toEqual([]);
});

test("signed out, or with a service that keeps no takes, the rows list none and ask for none", async ({ page }) => {
  desktopOnly();
  const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
  await page.goto("/cooling");
  await page.getByTestId("tab-sprites").click();
  const frame = Object.keys(frames.cooling!)[0]!;
  await expect(page.getByTestId(`frame-${frame}`)).toBeVisible();
  await expect(page.getByTestId(`ask-new-${frame}`)).toBeVisible();
  expect(s.calls.filter((c) => c.includes("/takes"))).toEqual([]);
});
