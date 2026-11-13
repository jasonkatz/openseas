import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content sector: six by six. */
const W = 6;
const H = 6;

const steps = (a: number, b: number): number => Math.abs((a % W) - (b % W)) + Math.abs(Math.floor(a / W) - Math.floor(b / W));
const isPing = (ch: string): boolean => /[0-9a-z]/.test(ch);

/** The fog cells on the ring of the ping at `cell`, read off the board string: where the contact it hears can be. */
function candidates(board: string, cell: number): number[] {
  const d = parseInt(board[cell]!, 36);
  return [...board].flatMap((ch, c) => (ch === "." && steps(cell, c) === d ? [c] : []));
}

/**
 * A move no one could regret, from nothing but what the page publishes: a lock where a ping's ring
 * has one fog cell left, else a ping on a cell shaded as empty. Every sector the content config
 * deals can be cleared this way.
 */
function safeMove(board: string): { type: "ping" | "lock"; cell: number } {
  for (let p = 0; p < board.length; p++) {
    if (!isPing(board[p]!)) continue;
    const ring = candidates(board, p);
    if (ring.length === 1) return { type: "lock", cell: ring[0]! };
  }
  let best = -1;
  let bestFog = -1;
  for (let c = 0; c < board.length; c++) {
    if (board[c] !== "-") continue;
    const fog = [...board].filter((ch, o) => ch === "." && steps(c, o) <= 2).length;
    if (fog > bestFog) {
      bestFog = fog;
      best = c;
    }
  }
  if (best < 0) throw new Error(`no safe move on ${board}`);
  return { type: "ping", cell: best };
}

async function boardString(page: Page): Promise<string> {
  const board = await page.getByTestId("scanner-board").getAttribute("data-board");
  if (!board || board.length !== W * H) throw new Error(`unexpected board ${board}`);
  return board;
}

async function cellPoint(page: Page, cell: number): Promise<[number, number]> {
  const { ox, oy, cell: size } = await boardGeom(page, "scanner");
  return [ox + ((cell % W) + 0.5) * size, oy + (Math.floor(cell / W) + 0.5) * size];
}

async function tap(page: Page, cell: number): Promise<void> {
  await page.mouse.click(...(await cellPoint(page, cell)));
}

/** Hold a finger on a cell until the board answers: a long press locks, whatever the switch says. */
async function longPress(page: Page, cell: number): Promise<void> {
  const before = await boardString(page);
  await page.mouse.move(...(await cellPoint(page, cell)));
  await page.mouse.down();
  await expect(page.getByTestId("scanner-board")).not.toHaveAttribute("data-board", before);
  await page.mouse.up();
}

/** Tap one half of the switch under the sector. */
async function flipSwitch(page: Page, verb: "ping" | "lock"): Promise<void> {
  const canvas = page.getByTestId("scanner-canvas");
  const at = ((await canvas.getAttribute("data-switch")) ?? "").split(",").map(Number);
  const box = await canvas.boundingBox();
  if (!box || at.length !== 4) throw new Error("no switch");
  const i = verb === "ping" ? 0 : 2;
  await page.mouse.click(box.x + at[i]!, box.y + at[i + 1]!);
  await expect(canvas).toHaveAttribute("data-mode", verb);
}

/** Walk the keyboard cursor to a cell. */
async function moveCursor(page: Page, cell: number): Promise<void> {
  const canvas = page.getByTestId("scanner-canvas");
  const [col, row] = ((await canvas.getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  for (let c = col; c < cell % W; c++) await page.keyboard.press("ArrowRight");
  for (let c = col; c > cell % W; c--) await page.keyboard.press("ArrowLeft");
  for (let r = row; r < Math.floor(cell / W); r++) await page.keyboard.press("ArrowDown");
  for (let r = row; r > Math.floor(cell / W); r--) await page.keyboard.press("ArrowUp");
  await expect(canvas).toHaveAttribute("data-cursor", `${cell % W},${Math.floor(cell / W)}`);
}

test("Scanner plays alone on /play: a round pings by key and by tap, lights a ring, and locks what the rings prove", async ({ page }) => {
  await page.goto("/play/scanner");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("scanner-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "scanner");
  // A sector opens on one ping and nothing else: fog, and the cells that ping proves empty.
  await expect(page.getByTestId("scanner-board")).toHaveAttribute("data-board", /^[.-]*[1-9a-z][.-]*$/);
  await expect(canvas).toHaveAttribute("data-mode", "ping");

  // Keyboard: walk the cursor to a cell shaded as empty and ping it.
  let move = safeMove(await boardString(page));
  expect(move.type).toBe("ping");
  await moveCursor(page, move.cell);
  await page.keyboard.press(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "scanner");
  let board = await boardString(page);
  expect(isPing(board[move.cell]!)).toBe(true);

  // Pointer: a tap on a pinged cell lights its ring and is no move; the cells lit are the fog on that ring.
  await tap(page, move.cell);
  await expect(canvas).toHaveAttribute("data-ring", `${move.cell}:${candidates(board, move.cell).join(",")}`);
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-ring", "");

  // Pointer: tap safe cells until a ring is down to one cell, then lock it through the switch.
  let moves = 1;
  for (; moves < 40; moves++) {
    move = safeMove(await boardString(page));
    if (move.type === "lock") break;
    await tap(page, move.cell);
    await expect(page.getByTestId("hud-moves")).toHaveText(String(moves + 1));
    await expectViewMatchesState(page, "scanner");
  }
  expect(move.type).toBe("lock");
  await flipSwitch(page, "lock");
  await tap(page, move.cell);
  await expect(page.getByTestId("hud-moves")).toHaveText(String(moves + 1));
  await expectViewMatchesState(page, "scanner");
  board = await boardString(page);
  // Found, and nothing was spooked or missed on the way.
  expect(board[move.cell]).toBe("X");
  expect(board).not.toMatch(/[S!]/);
  // The strip over the sector counts what is left: sector 1, two of three contacts hidden.
  await expect(canvas).toHaveAttribute("data-strip", /^1,-?\d+,6,2,3,40$/);
  // The key flips the switch back.
  await page.keyboard.press("x");
  await expect(canvas).toHaveAttribute("data-mode", "ping");
});

test("a Scanner ping on a contact spooks it, a lock on empty space misses, and a cleared sector gives way to the next", async ({ page }) => {
  // A pinned lab seed: contacts at cells 7, 22 and 35, the opening ping on cell 31, and cell 0 empty fog.
  await page.goto("/play/scanner?seed=scan-1&start=lab");
  const canvas = page.getByTestId("scanner-canvas");
  await expect(canvas).toBeVisible();
  await expectViewMatchesState(page, "scanner");
  // What the page publishes shows fog where the contacts are, like any other fog.
  await expect(page.getByTestId("scanner-board")).toHaveAttribute("data-board", ".............-....---...----..-4---.");
  // The strip: sector 1, six pings of six left, three of three contacts hidden, a lock worth 40.
  await expect(canvas).toHaveAttribute("data-strip", "1,6,6,3,3,40");

  // A long press locks even with the switch on ping: on empty space it is a miss.
  await longPress(page, 0);
  await expectViewMatchesState(page, "scanner");
  expect((await boardString(page))[0]).toBe("!");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expect(page.getByTestId("hud-score")).toHaveText("0");

  // A ping that lands on a contact spooks it: it is given away for nothing, and the ping is spent.
  await tap(page, 7);
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expectViewMatchesState(page, "scanner");
  expect((await boardString(page))[7]).toBe("S");
  await expect(canvas).toHaveAttribute("data-strip", "1,5,6,2,3,40");
  await expect(page.getByTestId("hud-score")).toHaveText("0");

  // Keyboard: enter locks the cursor's cell. A contact found pays its bounty, and the opening ping sounds again for the one left.
  await moveCursor(page, 35);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-moves")).toHaveText("3");
  await expectViewMatchesState(page, "scanner");
  const board = await boardString(page);
  expect(board[35]).toBe("X");
  expect(board[31]).toBe("5");
  expect(board[22]).toBe(".");
  await expect(page.getByTestId("hud-score")).toHaveText("40");

  // The last contact, through the switch: the sector is cleared and the next opens on its own ping.
  await flipSwitch(page, "lock");
  await tap(page, 22);
  await expect(page.getByTestId("hud-moves")).toHaveText("4");
  await expect(page.getByTestId("hud-score")).toHaveText("80");
  await expectViewMatchesState(page, "scanner");
  await expect(page.getByTestId("scanner-board")).toHaveAttribute("data-board", /^[.-]*[1-9a-z][.-]*$/);
  // Sector 2, untouched. Two mistakes: the first sector was not clean, so no streak lifts the bounty.
  await expect(canvas).toHaveAttribute("data-strip", "2,6,6,3,3,40");
});
