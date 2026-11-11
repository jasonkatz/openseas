/**
 * Where the world's labels stand, decided without drawing them. The scene measures and writes; these
 * rules decide, so they are tested here on plain points and boxes: the file runs with no page and
 * fails to load if the rules reach for three.js. The labels on a real screen are smoked by Playwright.
 */
import { describe, expect, it, vi } from "vitest";
import {
  figureBox,
  layoutColumns,
  layoutNames,
  layoutPins,
  layoutTags,
  overlaps,
  screenArea,
  stack,
  type Beside,
  type Box,
  type Name,
  type PinPlace,
  type PinSpot,
  type Pinned,
  type Size,
} from "../src/world/labels.js";

vi.mock("three", () => {
  throw new Error("where a label goes is decided without three.js");
});

/** A laptop's screen with the top bar over it and the card folded at the right. */
const VIEW: Size = { w: 1280, h: 720 };
const INSETS = { top: 0.08, bottom: 0, left: 0, right: 0.27 };
const AREA = screenArea(VIEW, INSETS, 4);
/** The player, standing mid-screen: a pirate about 80 pixels tall. */
const PLAYER = figureBox({ x: 460, y: 420 }, { x: 460, y: 340 });

function spot(x: number, y: number, more: Partial<PinSpot> = {}): PinSpot {
  return { x, y, sx: x, sy: y, w: 120, h: 34, lift: 14, kept: null, ...more };
}

/** The box a spot's label covers where it was placed (its pin's, beside it, or at the edge). */
function labelBox(s: PinSpot, at: PinPlace | Beside, lift = s.lift): Box {
  const x0 = at.kind === "beside" && at.flip ? at.label.x - s.w : at.label.x;
  return { x0, y0: at.label.y - lift, x1: x0 + s.w, y1: at.label.y - lift + s.h };
}
const pinBox = (at: Beside): Box => ({ x0: at.pin.x - 7, y0: at.pin.y - 7, x1: at.pin.x + 7, y1: at.pin.y + 7 });

/** A small seeded generator, so a failing case can be found again. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the screen", () => {
  it("keeps labels clear of the shell's panels by the margin each kind asks for", () => {
    const top = 720 * 0.08;
    const right = 1280 * (1 - 0.27);
    expect(screenArea(VIEW, INSETS, 4)).toEqual({ x0: 4, y0: top + 4, x1: right - 4, y1: 716 });
    // A column of deck labels keeps further from the top bar and the bottom than across.
    expect(screenArea(VIEW, INSETS, 8, 24)).toEqual({ x0: 8, y0: top + 24, x1: right - 8, y1: 696 });
  });

  it("boxes the player from the ring at their feet to the top of their headgear, with a little room", () => {
    expect(figureBox({ x: 100, y: 300 }, { x: 100, y: 220 })).toEqual({ x0: 60, y0: 214, x1: 140, y1: 308 });
    // However small they are drawn, the box is a thumb wide.
    expect(figureBox({ x: 100, y: 300 }, { x: 100, y: 290 })).toEqual({ x0: 84, y0: 284, x1: 116, y1: 308 });
  });
});

describe("names and tags", () => {
  const name = (x: number, y: number, more: Partial<Name> = {}): Name => ({ x, y, w: 140, h: 22, board: false, ...more });

  it("pushes a name that would sit on the one above below it by a line, and leaves one beside it alone", () => {
    const [a, b, c] = layoutNames([name(300, 200), name(320, 210), name(700, 205)], { area: AREA, player: null });
    expect(a).toEqual({ x: 300, y: 200, edge: null });
    expect(b).toEqual({ x: 320, y: 226, edge: null });
    // Far enough across that the two could not touch.
    expect(c).toEqual({ x: 700, y: 205, edge: null });
  });

  it("stacks from the top down, whatever order the labels come in, against where the one above ended up", () => {
    const placed = stack(
      [
        { x: 0, y: 30, w: 50, h: 10 },
        { x: 0, y: 10, w: 50, h: 10 },
        { x: 0, y: 20, w: 50, h: 10 },
      ],
      { gap: 20, pad: 4 },
      (at) => ({ x: at.x, y: at.y }),
    );
    expect(placed.map((p) => p.y)).toEqual([50, 10, 30]);
  });

  it("stands tags a shorter line apart than ships' names", () => {
    const [a, b] = layoutTags(
      [
        { x: 300, y: 200, w: 80, h: 16 },
        { x: 310, y: 205, w: 80, h: 16 },
      ],
      { player: null },
    );
    expect(b!.y - a!.y).toBe(20);
  });

  it("drops a name that would cover the player below them, and raises a tag over them", () => {
    const [n] = layoutNames([name(PLAYER.x0, PLAYER.y0 + 10)], { area: AREA, player: PLAYER });
    expect(n!.y).toBe(PLAYER.y1 + 2);
    const [t] = layoutTags([{ x: PLAYER.x1, y: PLAYER.y1, w: 80, h: 16 }], { player: PLAYER });
    expect(t!.y).toBe(PLAYER.y0 - 2);
  });

  it("brings the viewer's ship to board onto the screen's edge when she is off it, and names the edge", () => {
    const area = screenArea(VIEW, INSETS, 8);
    const [left, down, there] = layoutNames([name(-300, 300, { board: true }), name(400, 900, { board: true }), name(400, 300, { board: true })], { area, player: null });
    expect(left).toEqual({ x: area.x0 + 70, y: 300, edge: "left" });
    expect(down).toEqual({ x: 400, y: area.y1 - 22, edge: "down" });
    expect(there!.edge).toBeNull();
    // Any other ship's name just hangs where its point is.
    expect(layoutNames([name(-300, 300)], { area, player: null })[0]).toEqual({ x: -300, y: 300, edge: null });
  });
});

describe("spots beside their pins", () => {
  it("stands a label to the right of its pin, and to the left where the right runs off the clear screen", () => {
    const [right, left] = layoutPins([spot(300, 300), spot(AREA.x1 - 40, 500)], { area: AREA, avoid: [], player: null });
    expect(right).toMatchObject({ kind: "beside", pin: { x: 300, y: 300 }, label: { x: 318, y: 288 }, flip: false, kept: 0 });
    expect(left).toMatchObject({ kind: "beside", flip: true, kept: 1 });
  });

  it("keeps a label where it stood last while that place stays free, so it does not hop", () => {
    const [kept] = layoutPins([spot(300, 300, { kept: 4 })], { area: AREA, avoid: [], player: null });
    expect(kept).toMatchObject({ kind: "beside", flip: false, label: { x: 318, y: 300 + 12 + 14 }, kept: 4 });
  });

  it("stands no label under what floats over the world", () => {
    const card: Box = { x0: 290, y0: 250, x1: 600, y1: 320 };
    const [at] = layoutPins([spot(300, 300)], { area: AREA, avoid: [card], player: null });
    expect(overlaps(labelBox(spot(300, 300), at!), card)).toBe(false);
  });

  it("waits at the edge nearest a thing that is off the clear screen, inside it, pointing the way", () => {
    const off = [spot(-200, 300), spot(2000, 300), spot(400, -100), spot(400, 1000)];
    const placed = layoutPins(off, { area: AREA, avoid: [], player: null });
    expect(placed.map((p) => (p.kind === "edge" ? p.edge : null))).toEqual(["left", "right", "up", "down"]);
    for (const [i, at] of placed.entries()) {
      const box = labelBox(off[i]!, at);
      expect(box.x0).toBeGreaterThanOrEqual(AREA.x0);
      expect(box.x1).toBeLessThanOrEqual(AREA.x1);
      expect(box.y0).toBeGreaterThanOrEqual(AREA.y0);
      expect(box.y1).toBeLessThanOrEqual(AREA.y1);
    }
  });

  it("decides on screen or off by where the thing is on the ship's steady frame, not where it bobs to", () => {
    const [at] = layoutPins([spot(-3, 300, { sx: 6, sy: 300 })], { area: AREA, avoid: [], player: null });
    expect(at!.kind).toBe("beside");
  });

  it("hops a pin that would sit on the player over their headgear", () => {
    const [at] = layoutPins([spot(PLAYER.x0 + 5, PLAYER.y0 + 30)], { area: AREA, avoid: [], player: PLAYER });
    expect(at).toMatchObject({ kind: "beside", pin: { y: PLAYER.y0 - 12 } });
  });

  it("never covers the player with a label or a pin, wherever the spots are", () => {
    const next = prng(24);
    for (let n = 0; n < 400; n++) {
      const spots = Array.from({ length: 1 + Math.floor(next() * 6) }, () => {
        // Mostly on screen and near the player, some off it.
        const x = PLAYER.x0 - 250 + next() * 500 + (next() < 0.15 ? 1500 * (next() - 0.5) : 0);
        const y = PLAYER.y0 - 200 + next() * 400;
        return spot(x, y, { w: 70 + Math.round(next() * 100), h: next() < 0.5 ? 28 : 36, lift: next() < 0.5 ? 11 : 14 });
      });
      const placed = layoutPins(spots, { area: AREA, avoid: [], player: PLAYER });
      for (const [i, at] of placed.entries()) {
        expect(overlaps(labelBox(spots[i]!, at), PLAYER), `case ${n}, label ${i}`).toBe(false);
        if (at.kind === "beside") expect(overlaps(pinBox(at), PLAYER), `case ${n}, pin ${i}`).toBe(false);
      }
    }
  });
});

describe("the deck's columns", () => {
  /** A deck seen broadside: five spots across the middle of the screen. */
  const deck = (dx = 0): (Pinned & Size)[] =>
    [380, 420, 470, 520, 560].map((x, i) => ({ x: x + dx, y: 300 + (i % 3) * 30, sx: x + dx, sy: 300 + (i % 3) * 30, w: 150, h: 36 }));
  const area = screenArea(VIEW, INSETS, 8, 24);

  it("stands the port half of the labels in a column on the left and the starboard half on the right, each in order down the deck", () => {
    const spots = deck();
    const placed = layoutColumns(spots, { area, player: null })!;
    expect(placed).not.toBeNull();
    const lefts = placed.filter((p) => p.flip);
    const rights = placed.filter((p) => !p.flip);
    expect(lefts.length).toBe(3);
    expect(rights.length).toBe(2);
    expect(new Set(lefts.map((p) => p.label.x)).size).toBe(1);
    expect(lefts[0]!.label.x).toBe(380 - 40);
    expect(rights[0]!.label.x).toBe(560 + 40);
    // A label stands a little more than its own height below the one above it.
    const ys = lefts.map((p) => p.label.y).sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBe(42);
    for (const [i, p] of placed.entries()) expect(p.pin).toEqual({ x: spots[i]!.x, y: spots[i]!.y });
  });

  it("stands every label on the side that has room when the other has none", () => {
    // Shifted left until no column fits between the hull and the screen's left edge.
    const placed = layoutColumns(deck(-300), { area, player: null })!;
    expect(placed.every((p) => !p.flip)).toBe(true);
  });

  it("falls back to labels beside their pins when neither side has room", () => {
    const wide = [40, 300, 600, 900].map((x) => ({ x, y: 300, sx: x, sy: 300, w: 150, h: 36 }));
    expect(layoutColumns(wide, { area, player: null })).toBeNull();
  });

  it("falls back to labels beside their pins rather than stand a column over the player", () => {
    const spots = deck();
    const placed = layoutColumns(spots, { area, player: null })!;
    const covered = labelBox({ ...spot(0, 0), w: 150, h: 36 }, placed[0]!, 14);
    expect(layoutColumns(spots, { area, player: covered })).toBeNull();
  });

  it("covers nothing with an empty deck", () => {
    expect(layoutColumns([], { area, player: PLAYER })).toEqual([]);
  });
});
