import { expect, test, type Page } from "@playwright/test";
import { expectViewMatchesState, shown } from "./helpers.js";
import { NO_SAVE, SERVICE, draft, numbers, service } from "./standin.js";

/**
 * The sound panel (DESIGN.md 3.14, ADR 0050), and the swap it drives: a cue given another voice
 * under a running board, by a file, a take or the synthesized cue. Desktop only, as the studio is.
 * There is no sprite panel: every board draws its pieces in code (ADR 0062). What a draft, a link
 * or an address kept of sprite picks before then is read and passed over (ADR 0063), and the last
 * tests here hold the studio to that.
 */
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

test("every cue has a row that plays, the synthesized cue is the pick, and a file can be tried in its place", async ({ page }) => {
  desktopOnly();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.goto("/swordfight?seed=assets-2");
  await page.getByTestId("tab-sounds").click();
  // The puzzle's own cues, the shared ones its board plays, and the round's.
  for (const cue of ["clash", "heavy", "thud", "start", "end"]) await expect(page.getByTestId(`cue-${cue}`)).toHaveAttribute("data-voice", "synth");
  await (await shown(page, "cue-play-clash")).click();
  await (await shown(page, "cue-play-thud")).click();

  // A cue's voices and its file are in its row once it is the open one.
  await page.getByTestId("cue-open-clash").click();
  await page.getByTestId("cue-file-clash").setInputFiles({ name: "clash.wav", mimeType: "audio/wav", buffer: wav() });
  await expect(page.getByTestId("cue-clash")).toHaveAttribute("data-voice", "file");
  await expect(page.getByTestId("cue-file-name-clash")).toContainText("clash.wav");
  await (await shown(page, "cue-play-clash")).click();
  // The synthesized cue is picked again with a tap.
  await (await shown(page, "cue-shipped-clash")).click();
  await expect(page.getByTestId("cue-clash")).toHaveAttribute("data-voice", "synth");

  await page.getByTestId("cue-open-thud").click();
  await page.getByTestId("cue-file-thud").setInputFiles({ name: "not.wav", mimeType: "audio/wav", buffer: Buffer.from("no sound") });
  await expect(page.getByTestId("cue-thud").locator(".tune-refusal")).toBeVisible();
  await expect(page.getByTestId("cue-thud")).toHaveAttribute("data-voice", "synth");
  expect(errors).toEqual([]);
});

test("a turn's takes appear in their cue's row, a tap picks one into the draft and onto the board, and a row writes the start of a message", async ({ page }) => {
  desktopOnly();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const s = await service(page, { login: "octo", save: true, chat: true, takes: [], picks: true, drafts: [draft({ puzzle: "salvage", numbers: numbers({ overrides: { kinds: 6 } }), save: NO_SAVE })] });
  await page.goto("/salvage");
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "salvage");
  await page.getByTestId("tab-sounds").click();
  await page.getByTestId("cue-open-pop").click();
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-voice", "synth");

  // The row asks the agent, in the chat's own box, for the owner to finish.
  await (await shown(page, "ask-new-pop")).click();
  await expect(page.getByTestId("chat-input")).toHaveValue("Make new takes of the pop cue. ");
  await expect(page.getByTestId("chat-input")).toBeFocused();
  await (await shown(page, "ask-change-pop")).click();
  await expect(page.getByTestId("chat-input")).toHaveValue("Change the pop cue: ");
  await (await shown(page, "ask-new-pop")).click();
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-working")).toBeVisible();

  // The turn makes takes and ends: one on this draft, numbered as the script numbered it, and one from another draft's library.
  const mine = "a".repeat(64);
  const other = "b".repeat(64);
  const picture = "c".repeat(64);
  s.takes.push({ hash: mine, kind: "sound", puzzle: "salvage", name: "pop", draft: "draftdraft", take: 1, prompt: "A soft pop.", body: wav(), contentType: "audio/wav" });
  s.takes.push({ hash: other, kind: "sound", puzzle: "salvage", name: "pop", draft: "gonedraft1", take: 4, body: wav(), contentType: "audio/wav" });
  // A service older than the site may still list a sprite take it kept before pieces were drawn in code: the page passes it over.
  s.takes.push({ hash: picture, kind: "sprite", puzzle: "salvage", name: "pop", draft: "draftdraft", take: 2, body: await page.getByTestId("tab-sounds").screenshot(), contentType: "image/png" });
  s.chat.running = false;
  s.say("turn", { status: "done", commit: null, costUsd: 0.5, reverted: false });
  await expect(page.getByTestId("take-aaaaaaaa")).toHaveText("take 1");
  await expect(page.getByTestId("take-bbbbbbbb")).toHaveText("take bbbbbb");
  await expect(page.getByTestId("take-aaaaaaaa")).toHaveAttribute("title", "A soft pop.");
  await expect(page.getByTestId("take-cccccccc")).toHaveCount(0);

  // A tap is a pick: the draft holds it, the service is sent it, and the running board plays it from then on.
  await (await shown(page, "take-aaaaaaaa")).click();
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-voice", "take");
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-picked", mine);
  await expectViewMatchesState(page, "salvage");
  await expect.poll(() => s.drafts[0]!.numbers.picks).toEqual({ sounds: { pop: mine } });
  // The numbers are untouched, and the address stays bare: the service keeps the draft.
  expect(s.drafts[0]!.numbers.overrides).toEqual({ kinds: 6 });
  expect(new URL(page.url()).search).toBe("");

  // The synthesized cue is picked again with another tap, and the take with one more.
  await (await shown(page, "cue-shipped-pop")).click();
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-voice", "synth");
  await expect.poll(() => s.drafts[0]!.numbers.picks).toEqual({ sounds: {} });
  await (await shown(page, "take-aaaaaaaa")).click();
  await expect.poll(() => s.drafts[0]!.numbers.picks).toEqual({ sounds: { pop: mine } });

  // The pick is the draft's: a fresh page opens on it.
  await page.reload();
  await page.getByTestId("tab-sounds").click();
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-picked", mine);
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-voice", "take");
  // The top bar counts it with the changed numbers, lists it, and the rail marks its mode.
  await expect(page.getByTestId("changed-count")).toContainText("2");
  await expect(page.getByTestId("change-sounds-pop")).toHaveCount(1);
  await expect(page.getByTestId("tab-dot-sounds")).toBeVisible();

  // A file tried over a pick gives way to the pick again, and Reset all clears numbers and picks alike.
  await page.getByTestId("cue-open-pop").click();
  await page.getByTestId("cue-file-pop").setInputFiles({ name: "pop.wav", mimeType: "audio/wav", buffer: wav() });
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-voice", "file");
  await (await shown(page, "cue-back-pop")).click();
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-voice", "take");
  await (await shown(page, "reset-all")).click();
  await expect(page.getByTestId("change-sounds-pop")).toHaveCount(0);
  await expect(page.getByTestId("tab-dot-sounds")).toHaveCount(0);
  await expect.poll(() => s.drafts[0]!.numbers.picks).toEqual({ sounds: {} });
  await page.getByTestId("tab-sounds").click();
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-picked", "");
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-voice", "synth");
  expect(errors).toEqual([]);
});

test("on a service older than picks, a pick stays in the address and the draft is not saved over and over", async ({ page }) => {
  desktopOnly();
  const mine = "a".repeat(64);
  const s = await service(page, { login: "octo", save: true, chat: true, takes: [], drafts: [draft({ puzzle: "salvage", numbers: numbers({ overrides: { kinds: 6 } }), save: NO_SAVE })] });
  s.takes.push({ hash: mine, kind: "sound", puzzle: "salvage", name: "pop", draft: "draftdraft", take: 1, body: wav(), contentType: "audio/wav" });
  await page.goto("/salvage");
  await page.getByTestId("tab-sounds").click();
  await page.getByTestId("cue-open-pop").click();
  await (await shown(page, "take-aaaaaaaa")).click();
  await expect(page.getByTestId("cue-pop")).toHaveAttribute("data-picked", mine);
  await expect(page).toHaveURL(new RegExp(`sound\\.pop=${mine}`));
  // Longer than the page waits before it saves a change: nothing is sent, since the service would drop it.
  await page.waitForTimeout(1500);
  expect(s.writes).toEqual([]);
});

test("a link's pick is loaded on /play, and a take that cannot be read says so", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const good = "a".repeat(64);
  const gone = "d".repeat(64);
  const asked: string[] = [];
  await page.route(`${SERVICE}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    asked.push(path);
    return path === `/takes/${good}` ? route.fulfill({ status: 200, contentType: "audio/wav", headers: { "Access-Control-Allow-Origin": "*" }, body: wav() }) : route.fulfill({ status: 404, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: '{"error":"not_found"}' });
  });

  await page.goto(`/play/salvage?seed=picks-1&sound.pop=${good}`);
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "salvage");
  await page.getByTestId("toggle-details").click();
  await expect(page.getByTestId("play-picks")).toContainText("1");
  await expect(page.getByTestId("play-picks").locator(".error")).toHaveCount(0);
  // The puzzle alone asks the service for the take it picks, and nothing else.
  expect([...new Set(asked)]).toEqual([`/takes/${good}`]);

  await page.goto(`/play/salvage?seed=picks-1&sound.pop=${gone}&sound.thud=${gone}`);
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "salvage");
  await page.getByTestId("toggle-details").click();
  await expect(page.getByTestId("play-picks").locator(".error")).toContainText("2");
  expect(errors).toEqual([]);
});

test("signed out, or with a service that keeps no takes, the rows list none and ask for none", async ({ page }) => {
  desktopOnly();
  const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ puzzle: "salvage", numbers: numbers({ overrides: { kinds: 6 } }), save: NO_SAVE })] });
  await page.goto("/salvage");
  await page.getByTestId("tab-sounds").click();
  await page.getByTestId("cue-open-pop").click();
  await expect(page.getByTestId("cue-pop")).toBeVisible();
  await expect(page.getByTestId("ask-new-pop")).toBeVisible();
  expect(s.calls.filter((c) => c.includes("/takes"))).toEqual([]);
});

test("the studio has no Sprites mode, and a draft kept with sprite picks opens as one that picks no frame", async ({ page }) => {
  desktopOnly();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const old = "e".repeat(64);
  // A row as the service kept it before pieces were drawn in code (ADR 0062): a sprite pick beside a sound's.
  const s = await service(page, { login: "octo", save: true, chat: true, takes: [], picks: true, drafts: [draft({ puzzle: "salvage", numbers: numbers({ overrides: { kinds: 6 }, picks: { sprites: { "debris-gold": old }, sounds: { pop: "synth" } } }), save: NO_SAVE })] });
  await page.goto("/salvage");
  await expect(page.getByTestId("studio")).toBeVisible();
  await expect(page.getByTestId("tab-sounds")).toBeVisible();
  await expect(page.getByTestId("tab-sprites")).toHaveCount(0);
  await page.getByTestId("play-start").click();
  await expectViewMatchesState(page, "salvage");
  // The draft is the stored one, with its number and its cue; the sprite pick is counted nowhere and asked for nowhere.
  await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "3");
  await expect(page.getByTestId("changed-count")).toContainText("2");
  await expect(page.getByTestId("change-sounds-pop")).toHaveCount(1);
  await expect(page.getByTestId("change-sprites-debris-gold")).toHaveCount(0);
  expect(s.calls.filter((c) => c.includes(old))).toEqual([]);
  // A change is saved over it without the sprite pick: the page never writes one.
  await (await shown(page, "input-config.kinds")).fill("4");
  await expect.poll(() => s.drafts[0]!.numbers.overrides).toEqual({ kinds: 4 });
  expect(s.drafts[0]!.numbers.picks).toEqual({ sounds: { pop: "synth" } });
  expect(errors).toEqual([]);
});

test("an address kept with a sprite pick still opens on /play, and asks the service for nothing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const old = "f".repeat(64);
  const asked: string[] = [];
  await page.route(`${SERVICE}/**`, (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 404, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: '{"error":"not_found"}' });
  });
  await page.goto(`/play/salvage?seed=picks-1&c.kinds=6&sprite.debris-gold=${old}`);
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("salvage-canvas")).toHaveAttribute("data-pieces", "drawn");
  await expectViewMatchesState(page, "salvage");
  // The number in the address is played; the sprite pick is read past, counted nowhere and reported nowhere.
  await page.getByTestId("toggle-details").click();
  await expect(page.getByTestId("play-picks")).toHaveCount(0);
  expect(asked).toEqual([]);
  expect(errors).toEqual([]);
});
