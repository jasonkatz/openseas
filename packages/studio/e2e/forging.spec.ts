import { expect, test, type Page } from "@playwright/test";
import { boardGeom, expectViewMatchesState } from "./helpers.js";

/** The content plate: six by six. */
const W = 6;
const H = 6;

/** The spots the press can reach from `at` after striking `mark`, read off the board string: two characters a spot, heat then mark. */
function reach(board: string, at: number, mark: string): number[] {
  const live = (i: number): boolean => board[i * 2] !== ".";
  const col = at % W;
  const row = Math.floor(at / W);
  const out = new Set<number>();
  const add = (c: number, r: number): void => {
    if (c >= 0 && c < W && r >= 0 && r < H && r * W + c !== at && live(r * W + c)) out.add(r * W + c);
  };
  const all8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
  const edge = (dc: number, dr: number): void => {
    let c = col;
    let r = row;
    while (c + dc >= 0 && c + dc < W && r + dr >= 0 && r + dr < H) {
      c += dc;
      r += dr;
    }
    if (c !== col || r !== row) add(c, r);
  };
  const steps: Record<string, number> = { "1": 1, "2": 2, "3": 3, "4": 4 };
  if (steps[mark]) for (const [dc, dr] of all8) add(col + dc * steps[mark]!, row + dr * steps[mark]!);
  else if (mark === "h") for (const [dc, dr] of [[1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2]] as const) add(col + dc, row + dr);
  else if (mark === "!") for (let i = 0; i < W * H; i++) add(i % W, Math.floor(i / W));
  else {
    const dirs = mark === "r" ? all8.filter(([dc, dr]) => dc === 0 || dr === 0) : mark === "s" ? all8.filter(([dc, dr]) => dc !== 0 && dr !== 0) : all8;
    for (const [dc, dr] of dirs) edge(dc, dr);
  }
  return [...out];
}

async function boardString(page: Page): Promise<string> {
  const board = await page.getByTestId("forging-board").getAttribute("data-board");
  if (!board || board.length !== W * H * 2) throw new Error(`unexpected board ${board}`);
  return board;
}

async function tap(page: Page, cell: number): Promise<void> {
  const { ox, oy, cell: size } = await boardGeom(page, "forging");
  await page.mouse.click(ox + ((cell % W) + 0.5) * size, oy + (Math.floor(cell / W) + 0.5) * size);
}

test("Forging plays alone on /play: a round strikes by key and by tap, and refuses a spot the press cannot reach", async ({ page }) => {
  await page.goto("/play/forging");
  await page.getByTestId("play-start").click();
  const canvas = page.getByTestId("forging-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("hud-moves")).toHaveText("0");
  await expectViewMatchesState(page, "forging");

  // Keyboard: the first strike may land anywhere. Move one right and strike.
  const before = await boardString(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("hud-moves")).toHaveText("1");
  await expectViewMatchesState(page, "forging");
  const [col, row] = ((await canvas.getAttribute("data-cursor")) ?? "0,0").split(",").map(Number) as [number, number];
  const first = row * W + col;
  const struck = before[first * 2 + 1]!;

  // A spot the press cannot reach is refused: nothing changes.
  const board = await boardString(page);
  const open = reach(board, first, struck);
  const shut = Array.from({ length: W * H }, (_, i) => i).find((i) => i !== first && !open.includes(i) && board[i * 2] !== ".");
  if (shut !== undefined) {
    await tap(page, shut);
    await expect(page.getByTestId("hud-moves")).toHaveText("1");
  }

  // Pointer: tap a spot it can reach.
  expect(open.length).toBeGreaterThan(0);
  await tap(page, open[0]!);
  await expect(page.getByTestId("hud-moves")).toHaveText("2");
  await expectViewMatchesState(page, "forging");
  // The struck spot is a step cooler.
  const after = await boardString(page);
  expect(Number(after[open[0]! * 2])).toBe(Number(board[open[0]! * 2]) - 1);
});

test("a Forging stage plays from its address: its name in the HUD and its marks on the plate (ADR 0066)", async ({ page }) => {
  await page.goto("/play/forging?stage=steps");
  await expect(page.getByTestId("stage-intro")).toHaveAttribute("data-stage", "steps");
  await page.getByTestId("play-start").click();
  await expect(page.getByTestId("forging-canvas")).toBeVisible();
  await expect(page.getByTestId("hud-stage").first()).toHaveAttribute("data-stage", "steps");
  // The first stage deals steps of one to three only.
  await expect(page.getByTestId("forging-board")).toHaveAttribute("data-board", /^(3[123])+$/);
  await tap(page, 14);
  await expect(page.getByTestId("hud-moves").first()).toHaveText("1");
  await expectViewMatchesState(page, "forging");
});
