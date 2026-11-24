import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import { createPactGame, pactHint, pactRankOf, pactSuitOf, reducePact, type PactState } from "@openseas/engine";
import { boardGeom, clip, findSeed, hidePointer, openLab, settled, still } from "./lib.js";

const cfg = loadContent().puzzles.pact.config;

/** The board's layout in units from its corner, as `PACT_LAYOUT` in boards/src/pact/renderer.ts lays it out. */
const HAND_ROWS = [9.9, 11.8];
const CARD_PITCH = 1.33;
const SUIT_ORDER = [3, 2, 0, 1];

/** The hand as the board shows it: spades, hearts, clubs, diamonds, high to low. */
const shownHand = (cards: readonly number[]): number[] =>
  [...cards].sort((a, b) => (SUIT_ORDER.indexOf(pactSuitOf(a)) - SUIT_ORDER.indexOf(pactSuitOf(b))) || pactRankOf(b) - pactRankOf(a));

/** The table played on until the player is to bid or play, or the hand is over. */
function playOn(s: PactState): PactState {
  let state = s;
  while (state.phase === "table" && !state.finished) state = reducePact(state, { type: "next" });
  return state;
}

/** The player's own move by the engine's rule, then the table played on. */
function step(s: PactState): PactState {
  return playOn(reducePact(s, pactHint(s)!));
}

/** Wait for the board to settle on the player's turn, or between hands. */
async function turn(page: Page): Promise<string> {
  await expect(page.getByTestId("pact-canvas")).toHaveAttribute("data-phase", /^(bid|play|over)$/, { timeout: 20_000 });
  await settled(page, "pact");
  return (await page.getByTestId("pact-canvas").getAttribute("data-phase")) ?? "";
}

/** Where the board draws `card` of the player's `hand`, on the page. */
async function cardOnPage(page: Page, hand: readonly number[], card: number): Promise<{ x: number; y: number }> {
  const { ox, oy, cell } = await boardGeom(page, "pact");
  const order = shownHand(hand);
  const k = order.indexOf(card);
  const n = order.length;
  const first = Math.ceil(n / 2);
  const row = k < first ? 0 : 1;
  const inRow = row === 0 ? first : n - first;
  const i = row === 0 ? k : k - first;
  return { x: ox + (5 + (i - (inRow - 1) / 2) * CARD_PITCH) * cell, y: oy + HAND_ROWS[row]! * cell };
}

/** Bid by keys: a number picks it, enter makes it. Bids over nine step up from nine. */
async function bid(page: Page, n: number): Promise<void> {
  await page.keyboard.press(String(Math.min(9, n)));
  for (let k = 9; k < n; k++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
}

/** Play the player's seat by the engine's rule on the page, `moves` times, keeping the engine's state beside it. */
async function follow(page: Page, s: PactState, moves: number): Promise<PactState> {
  let state = s;
  for (let k = 0; k < moves; k++) {
    await turn(page);
    const m = pactHint(state)!;
    if (m.type === "bid") await bid(page, m.bid);
    else if (m.type === "play") {
      const at = await cardOnPage(page, state.seats[0]!.cards, m.card);
      await page.mouse.click(at.x, at.y);
    }
    state = step(state);
  }
  return state;
}

/** A first hand where the player's bid is under ten and their first card falls third or fourth in its trick. */
function firstTrick(seed: string): number | null {
  let st = playOn(createPactGame(seed, cfg));
  const m = pactHint(st);
  if (!m || m.type !== "bid" || m.bid > 9 || m.bid === 0) return null;
  st = playOn(reducePact(st, m));
  return st.phase === "play" && st.trick.length >= 2 ? st.trick.length : null;
}

test("pact: the table", async ({ page }) => {
  const { seed } = findSeed("pact-hero", (s) => (firstTrick(s) === 2 ? true : null));
  await openLab(page, "pact", { seed });
  await follow(page, playOn(createPactGame(seed, cfg)), 1);
  await turn(page);
  await hidePointer(page);
  await still(page, "pact", "table");
});

test("pact: the bid", async ({ page }) => {
  // A deal where the other seats bid first, so the panel shows their bids beside it.
  const { seed } = findSeed("pact-bid", (s) => {
    const st = playOn(createPactGame(s, cfg));
    const m = pactHint(st);
    return st.phase === "bid" && st.seats.filter((x) => x.bid !== null).length === 3 && m?.type === "bid" && m.bid > 0 && m.bid < 10 ? m.bid : null;
  });
  await openLab(page, "pact", { seed });
  const found = pactHint(playOn(createPactGame(seed, cfg)));
  await turn(page);
  await page.keyboard.press(String(found!.type === "bid" ? found!.bid : 3));
  await page.waitForTimeout(300);
  await hidePointer(page);
  await still(page, "pact", "bid");
});

test("pact: a trick taken", async ({ page }) => {
  // The player's first card is the last of its trick.
  const { seed } = findSeed("pact-trick", (s) => (firstTrick(s) === 3 ? true : null));
  await openLab(page, "pact", { seed });
  const st = await follow(page, playOn(createPactGame(seed, cfg)), 1);
  await turn(page);
  const m = pactHint(st)!;
  if (m.type !== "play") throw new Error("the player is not to play");
  const at = await cardOnPage(page, st.seats[0]!.cards, m.card);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await clip(page, "pact", "trick", async () => {
    await page.mouse.click(at.x, at.y);
    // The trick holds, then goes to its taker; the clip ends before the next card is led.
    await page.waitForTimeout(1750);
  }, { tailMs: 100 });
});

test("pact: the hand's count", async ({ page }) => {
  // A hand the player's side makes, whose last trick the player plays last.
  const { seed } = findSeed("pact-count", (s) => {
    let st = playOn(createPactGame(s, cfg));
    while (st.phase === "bid" || st.phase === "play") {
      if (st.phase === "play" && st.seats[0]!.cards.length === 1) {
        if (st.trick.length !== 3) return null;
        const end = step(st);
        return end.count && end.count.us.pact > 0 && end.count.us.took >= end.count.us.pact && end.count.us.nils.length === 0 ? true : null;
      }
      st = step(st);
    }
    return null;
  }, 4000);
  test.setTimeout(240_000);
  await openLab(page, "pact", { seed });
  // Bid and play the hand through to its last card.
  let st = playOn(createPactGame(seed, cfg));
  while (!(st.phase === "play" && st.seats[0]!.cards.length === 1)) st = await follow(page, st, 1);
  await turn(page);
  const last = st.seats[0]!.cards[0]!;
  const at = await cardOnPage(page, st.seats[0]!.cards, last);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await clip(page, "pact", "count", async () => {
    await page.mouse.click(at.x, at.y);
    await turn(page);
  }, { tailMs: 1600 });
});
