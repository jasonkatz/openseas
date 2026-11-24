import { expect, test, type Page } from "@playwright/test";
import { loadContent } from "@openseas/content";
import { createShowdownGame, reduceShowdown, showdownOwed, type ShowdownEvent, type ShowdownState } from "@openseas/engine";
import { boardGeom, canvasAttr, clip, findSeed, hidePointer, openLab, settled, still } from "./lib.js";

const cfg = loadContent().puzzles.showdown.config;

const deal = (seed: string): ShowdownState => createShowdownGame(seed, cfg);

/** Play the table on until the player is to decide, or the hand is over: the events on the way. */
function playOn(s: ShowdownState): { state: ShowdownState; events: ShowdownEvent[] } {
  const events: ShowdownEvent[] = [];
  let state = s;
  while (state.phase === "table" && !state.finished) {
    state = reduceShowdown(state, { type: "next" });
    events.push(...state.lastMove!.events);
  }
  return { state, events };
}

/** The player's decision `move` from `s`, then the table played on after it. */
function decide(s: ShowdownState, move: "fold" | "call" | "raise"): { state: ShowdownState; events: ShowdownEvent[] } {
  const after = reduceShowdown(s, { type: move });
  const on = playOn(after);
  return { state: on.state, events: [...after.lastMove!.events, ...on.events] };
}

/** Wait for the board to settle on the player's turn, or between hands. */
async function turn(page: Page): Promise<string> {
  await expect(page.getByTestId("showdown-canvas")).toHaveAttribute("data-phase", /^(act|over)$/, { timeout: 20_000 });
  await settled(page, "showdown");
  return canvasAttr(page, "showdown", "data-phase");
}

/** Hover the k-th button, so a clip opens with the hand already there. */
async function hover(page: Page, k: number): Promise<{ x: number; y: number }> {
  const g = await boardGeom(page, "showdown");
  const at = { x: g.ox + (k + 0.5) * g.cell, y: g.oy + g.cell / 2 };
  await page.mouse.move(at.x, at.y, { steps: 4 });
  return at;
}

test("showdown: the table", async ({ page }) => {
  // A first hand where the rivals have acted and it is the player's turn, with a bet to call.
  const { seed } = findSeed("showdown-hero", (s) => {
    const st = playOn(deal(s)).state;
    return st.phase === "act" && showdownOwed(st) > 0 && st.seats.every((x) => !x.folded) ? true : null;
  });
  await openLab(page, "showdown", { seed });
  await turn(page);
  await hidePointer(page);
  await still(page, "showdown", "table");
});

test("showdown: a call and the flop", async ({ page }) => {
  // The player's first decision is a call that the table follows to the first three cards.
  const { seed } = findSeed("showdown-flop", (s) => {
    const st = playOn(deal(s)).state;
    if (st.phase !== "act") return null;
    const r = decide(st, "call");
    return r.events.some((e) => e.kind === "street" && e.street === 1) && r.events.filter((e) => e.kind === "act").length >= 3 ? true : null;
  });
  await openLab(page, "showdown", { seed });
  await turn(page);
  const at = await hover(page, 1);
  await clip(page, "showdown", "flop", async () => {
    await page.mouse.click(at.x, at.y);
    await turn(page);
  }, { tailMs: 900 });
});

test("showdown: a fold", async ({ page }) => {
  // Two small cards and a bet to call: folding them lets the rest play out among the rivals.
  const { seed } = findSeed("showdown-fold", (s) => {
    const st = playOn(deal(s)).state;
    if (st.phase !== "act" || showdownOwed(st) === 0) return null;
    if (st.seats[0]!.cards.some((card) => card % 13 > 5)) return null;
    return decide(st, "fold").events.some((e) => e.kind === "street") ? true : null;
  });
  await openLab(page, "showdown", { seed });
  await turn(page);
  const at = await hover(page, 0);
  await clip(page, "showdown", "fold", async () => {
    await page.mouse.click(at.x, at.y);
    await turn(page);
  }, { tailMs: 1400 });
});

test("showdown: the cards are shown", async ({ page }) => {
  // Calling every bet of the first hand reaches a showdown of three or more seats on the player's last call.
  const { seed, found } = findSeed("showdown-show", (s) => {
    let st = playOn(deal(s)).state;
    let calls = 0;
    while (st.phase === "act") {
      const r = decide(st, "call");
      calls++;
      const win = r.events.find((e) => e.kind === "win");
      if (win && win.kind === "win") return win.shown.length >= 3 && win.winners.includes(0) ? calls : null;
      st = r.state;
    }
    return null;
  }, 4000);
  await openLab(page, "showdown", { seed });
  for (let k = 1; k < found; k++) {
    await turn(page);
    await page.keyboard.press("c");
  }
  await turn(page);
  const at = await hover(page, 1);
  await clip(page, "showdown", "showdown", async () => {
    await page.mouse.click(at.x, at.y);
    await turn(page);
  }, { tailMs: 1600 });
});
