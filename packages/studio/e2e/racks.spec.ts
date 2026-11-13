import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content racks: five in the row, five cells tall. */
const RACKS = 5;
const HEIGHT = 5;

interface Board {
  racks: string[];
  crate: { rack: number; kinds: string; lands: number };
}

/** The board string the page publishes: each rack's kinds bottom first, then the crate as rack:kinds:moves. */
async function board(page: Page): Promise<Board> {
  const text = await page.getByTestId("racks-board").getAttribute("data-board");
  const m = /^([0-9|]*);(\d+):(\d+):(\d+)$/.exec(text ?? "");
  if (!m) throw new Error(`unexpected board ${text}`);
  const racks = m[1]!.split("|");
  if (racks.length !== RACKS) throw new Error(`unexpected racks ${text}`);
  return { racks, crate: { rack: Number(m[2]), kinds: m[3]!, lands: Number(m[4]) } };
}

/** A move the engine takes: off a rack that holds something, onto another with room. */
function legalMove(b: Board, avoid = -1): [number, number] {
  for (let from = 0; from < RACKS; from++)
    for (let to = 0; to < RACKS; to++) if (from !== to && from !== avoid && b.racks[from]!.length > 0 && b.racks[to]!.length < HEIGHT) return [from, to];
  throw new Error("no legal move");
}

/** The middle of a rack's column, a little below its rim, in page pixels. */
async function rackPoint(page: Page, rack: number): Promise<[number, number]> {
  const { ox, oy, cell } = await boardGeom(page, "racks");
  return [ox + (rack + 0.5) * cell, oy + cell];
}

async function tapRack(page: Page, rack: number): Promise<void> {
  await page.mouse.click(...(await rackPoint(page, rack)));
}

/** The hanging crate, from the point the canvas publishes for it. */
async function tapCrate(page: Page): Promise<void> {
  const canvas = page.getByTestId("racks-canvas");
  await expect(canvas).toHaveAttribute("data-crate", /^\d+,\d+$/);
  const [x, y] = ((await canvas.getAttribute("data-crate")) ?? "").split(",").map(Number) as [number, number];
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.click(box.x + x, box.y + y);
}

async function dragRack(page: Page, from: number, to: number): Promise<void> {
  const a = await rackPoint(page, from);
  const b = await rackPoint(page, to);
  await page.mouse.move(...a);
  await page.mouse.down();
  await page.mouse.move((a[0] + b[0]) / 2, a[1] - 10, { steps: 5 });
  await page.mouse.move(...b, { steps: 5 });
  await page.mouse.up();
}

test("Racks plays alone on /play: a round moves cells by key, tap and drag, and calls the crate", async ({ page }) => {
  await page.goto("/play/racks");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("racks-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "racks");

  // Keyboard: a digit lifts a rack's top, a digit sets it down.
  let b = await board(page);
  let [from, to] = legalMove(b);
  await page.keyboard.press(String(from + 1));
  await page.keyboard.press(String(to + 1));
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "racks");
  // The crate came a step nearer, or landed and a new one hangs with a full count.
  const after = await board(page);
  expect(after.crate.lands === b.crate.lands - 1 || after.crate.lands === 4).toBe(true);

  // Pointer: tap a rack, tap a rack. Tapping the same rack twice puts the cells back.
  b = after;
  [from, to] = legalMove(b);
  await tapRack(page, from);
  await tapRack(page, from);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await tapRack(page, from);
  await tapRack(page, to);
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expectViewMatchesState(page, "racks");

  // Drag from rack to rack.
  b = await board(page);
  [from, to] = legalMove(b);
  await dragRack(page, from, to);
  await expect(page.getByTestId("hud-moves")).toHaveText("3");
  await expectViewMatchesState(page, "racks");

  // The crate comes down when it is tapped, and when C is pressed.
  await tapCrate(page);
  await expect(page.getByTestId("hud-moves")).toHaveText("4");
  await expectViewMatchesState(page, "racks");
  expect((await board(page)).crate.lands).toBe(4);
  await page.keyboard.press("c");
  await expect(page.getByTestId("hud-moves")).toHaveText("5");
  await expectViewMatchesState(page, "racks");
});

test("a Racks rack filled with one kind ships", async ({ page }) => {
  // A pinned lab seed: the first crate is two of kind 3 over a rack that holds one, and two more sit on other racks' tops.
  await page.goto("/play/racks?seed=ship-17&start=lab");
  const canvas = page.getByTestId("racks-canvas");
  await expect(canvas).toBeVisible();
  await expectViewMatchesState(page, "racks");
  await expect(page.getByTestId("racks-board")).toHaveAttribute("data-board", "00|3|212|123|013;1:33:4");
  await tapCrate(page);
  await expect(page.getByTestId("racks-board")).toHaveAttribute("data-board", "00|333|212|123|013;4:11:4");
  await dragRack(page, 3, 1);
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expect(page.getByTestId("hud-score")).toHaveText("0");
  // The fifth cell of the kind fills the rack: it ships for 100 and comes back empty.
  await tapRack(page, 4);
  await tapRack(page, 1);
  await expect(page.getByTestId("hud-moves")).toHaveText("3");
  await expect(page.getByTestId("hud-score")).toHaveText("100");
  await expect(page.getByTestId("racks-board")).toHaveAttribute("data-board", "00||212|12|01;4:11:2");
  await expectViewMatchesState(page, "racks");
});
