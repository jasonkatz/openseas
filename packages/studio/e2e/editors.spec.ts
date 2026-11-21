import { expect, test, type Page } from "@playwright/test";
import { draft, numbers, service } from "./standin.js";

/**
 * The Sprites and Sounds editors (DESIGN.md 3.14, ADR 0065). A piece is redrawn by dragging a
 * handle of one of its layers, a cue revoiced by moving a voice or typing a number: either is part
 * of the draft at once, carried in the address, listed with the draft's changes and put back from
 * there. Desktop only, as the studio is.
 */
const desktopOnly = (): void => test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool");

const watch = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  return errors;
};

/** Drag a handle of the stage by (`dx`, `dy`) pixels. */
async function drag(page: Page, testId: string, dx: number, dy: number): Promise<void> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
}

test("the Sprites mode redraws a piece: on the board, in the address and the changes, and back again", async ({ page }) => {
  desktopOnly();
  const errors = watch(page);
  await page.goto("/cooling?seed=edit-1");
  await page.getByTestId("tab-sprites").click();
  const panel = page.getByTestId("sprites");
  // Every piece the board draws, one tile each.
  for (const piece of ["cog", "valve", "bolt", "magnet", "slag"]) await expect(panel.getByTestId(`piece-${piece}`)).toBeVisible();
  await panel.getByTestId("piece-bolt").click();
  await expect(panel.getByTestId("layers").locator("li")).toHaveCount(2);

  // The head's body handle moves the hexagon; its cut slot stays.
  await drag(page, "handle-body", 40, 0);
  await expect(panel.getByTestId("piece-dot-bolt")).toBeVisible();
  await expect(page.getByTestId("tab-dot-sprites")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("piece.bolt")).not.toBeNull();
  const moved = JSON.parse(new URL(page.url()).searchParams.get("piece.bolt")!) as { layers: Array<{ points?: number[] }> };
  expect(moved.layers[0]!.points![0]).toBeGreaterThan(12);
  // Its notes say it now reaches past the square a piece fills.
  await expect(panel.getByTestId("sprite-notes")).toBeVisible();

  // Typed numbers set it too; undo takes the last change back.
  await panel.getByTestId("layer-1").locator(".layer-pick").click();
  await panel.getByTestId("field-w").fill("6");
  await expect.poll(() => JSON.parse(new URL(page.url()).searchParams.get("piece.bolt") ?? "{}").layers?.[1]?.w).toBe(6);
  await panel.getByTestId("sprite-undo").click();
  await expect.poll(() => JSON.parse(new URL(page.url()).searchParams.get("piece.bolt") ?? "{}").layers?.[1]?.w).toBe(9);

  // A layer can be added and taken away.
  await panel.getByTestId("layer-add-disc").click();
  await expect(panel.getByTestId("layers").locator("li")).toHaveCount(3);
  await panel.getByTestId("layer-remove-2").click();
  await expect(panel.getByTestId("layers").locator("li")).toHaveCount(2);

  // The draft lists it, and puts it back from there.
  await page.getByTestId("changed-count").click();
  await expect(page.getByTestId("change-piece-bolt")).toBeVisible();
  await page.getByTestId("change-piece-bolt").locator(".num-reset").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("piece.bolt")).toBeNull();
  await expect(page.getByTestId("tab-dot-sprites")).toHaveCount(0);

  // An address that carries a drawing opens on it; one that is not a drawing is passed over.
  const cog = { layers: [{ kind: "disc", x: 12, y: 12, r: 9 }] };
  await page.goto(`/cooling?seed=edit-1&piece.cog=${encodeURIComponent(JSON.stringify(cog))}&piece.valve=${encodeURIComponent('{"layers":[]}')}`);
  await page.getByTestId("tab-sprites").click();
  await expect(page.getByTestId("piece-dot-cog")).toBeVisible();
  await expect(page.getByTestId("piece-dot-valve")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the Sounds mode revoices a cue: plays it as it is edited, holds it to the brand book, and puts it back", async ({ page }) => {
  desktopOnly();
  // The editor as a closed panel draws it, every field in one column: the wide panel's tabs are the wide-panels smoke's.
  await page.addInitScript(() => window.localStorage.setItem("openseas.studio.wide", "0"));
  const errors = watch(page);
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
  await page.goto("/cooling?seed=edit-2");
  await page.getByTestId("tab-sounds").click();
  const panel = page.getByTestId("sounds");
  await panel.getByTestId("cue-edit-clear").click();
  const editor = panel.getByTestId("cue-editor");
  // A cue here is the puzzle's own copy (ADR 0070), and plays each row a board may ask it with.
  await expect(editor.getByTestId("cue-shared")).toContainText("Cooling");
  const before = await tones();
  await editor.getByTestId("probe-3").click();
  await expect.poll(tones).toBeGreaterThan(before);

  // A voice moved on the roll is the draft's.
  // The narrow panel holds the roll below the fold.
  await editor.getByTestId("voice-0").scrollIntoViewIfNeeded();
  const voice = (await editor.getByTestId("voice-0").locator("rect").first().boundingBox())!;
  await page.mouse.move(voice.x + 8, voice.y + voice.height / 2);
  await page.mouse.down();
  await page.mouse.move(voice.x + 40, voice.y + voice.height / 2 - 24, { steps: 6 });
  await page.mouse.up();
  await expect(panel.getByTestId("cue-dot-clear")).toBeVisible();
  await expect(page.getByTestId("tab-dot-sounds")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("cue.clear")).not.toBeNull();
  const moved = JSON.parse(new URL(page.url()).searchParams.get("cue.clear")!) as { voices: Array<{ at: number; note: number }> };
  expect(moved.voices[0]!.at).toBeGreaterThan(0);
  expect(moved.voices[0]!.note).toBeGreaterThan(7);

  // A cue that runs past its length is said to, and plays as shipped until it is mended.
  await page.getByTestId("voice-release").fill("0.9");
  await expect(editor.getByTestId("cue-problems")).toBeVisible();
  await page.getByTestId("cue-undo").click();
  await expect(editor.getByTestId("cue-problems")).toHaveCount(0);

  // The cue's level, typed; then the whole cue put back.
  await editor.getByTestId("cue-level").fill("0.5");
  await expect.poll(() => JSON.parse(new URL(page.url()).searchParams.get("cue.clear") ?? "{}").level).toBe(0.5);
  await editor.getByTestId("cue-reset").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("cue.clear")).toBeNull();
  await expect(page.getByTestId("tab-dot-sounds")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the service keeps a draft's look; a draft whose only change is a cue can be saved, and one that breaks a rule cannot", async ({ page }) => {
  desktopOnly();
  // The editor as a closed panel draws it, every field in one column: the wide panel's tabs are the wide-panels smoke's.
  await page.addInitScript(() => window.localStorage.setItem("openseas.studio.wide", "0"));
  const s = await service(page, { login: "octo", save: true, words: true, look: true, drafts: [draft({ numbers: numbers(), save: { state: "idle", error: null, pull: null, savedRevision: null, behind: false } })] });
  await page.goto("/cooling");
  await expect(page.getByTestId("draft-store")).toHaveAttribute("data-status", "saved");
  await expect(page.getByTestId("save")).toBeDisabled();
  await page.getByTestId("tab-sounds").click();
  await page.getByTestId("cue-edit-swap").click();
  await page.getByTestId("cue-level").fill("0.8");
  await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "4");
  expect((s.drafts[0]!.numbers as { look?: { cues: Record<string, { level: number }> } }).look?.cues.swap?.level).toBe(0.8);
  // The service keeps it, so the address does not.
  await expect(page).toHaveURL(/\/cooling$/);
  await expect(page.getByTestId("save")).toBeEnabled();

  // A cue that runs too long holds Save until it is mended.
  await page.getByTestId("voice-release").fill("0.9");
  await expect(page.getByTestId("cue-problems")).toBeVisible();
  await expect(page.getByTestId("save")).toBeDisabled();
  await page.getByTestId("voice-release").fill("0.1");
  await expect(page.getByTestId("save")).toBeEnabled();
});
