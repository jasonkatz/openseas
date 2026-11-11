/**
 * Where the world's labels stand on screen (ADR 0020): pure rules over points and boxes in the world's
 * own pixels. The scene measures what it needs (where each thing projects to, how big each label is
 * drawn, what floats over the world), asks these rules where each label goes, and writes the answers
 * to its elements in one pass. Nothing here reads or writes the page or loads three.js.
 *
 * Four kinds of label, one rule set each:
 * - a ship's name hangs below its point (`layoutNames`), a pirate's tag stands above theirs
 *   (`layoutTags`); both drop down past a label above they would sit on (`stack`);
 * - a spot's label stands beside its pin with a leader to it, or waits at the screen's edge when its
 *   thing is off it (`layoutPins`);
 * - the deck's spots may instead stand in a column each side of the hull (`layoutColumns`).
 * Whatever the kind, no label covers the player's own pirate.
 */

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
/** A box on screen, in the world's own pixels. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** Fractions of the viewport covered by the shell's panels, so the focus lands in the clear. */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
/** The side of the screen a label waits at, pointing the way to a thing that is off it. */
export type Edge = "left" | "right" | "up" | "down";

export const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The part of the screen clear of the shell's panels, kept `margin` in from them across and `marginY` down. */
export function screenArea(view: Size, insets: Insets, margin: number, marginY = margin): Box {
  return { x0: view.w * insets.left + margin, y0: view.h * insets.top + marginY, x1: view.w * (1 - insets.right) - margin, y1: view.h * (1 - insets.bottom) - marginY };
}

/** Where the player's own pirate is on screen, feet to the top of the headgear, with a little room: no label may cover it. */
export function figureBox(feet: Point, head: Point): Box {
  const half = Math.max(16, (feet.y - head.y) * 0.5);
  return { x0: feet.x - half, y0: head.y - 6, x1: feet.x + half, y1: feet.y + 8 };
}

/** A pin that would sit on the player (standing at its station) hops up over their headgear instead. */
const pinClearOf = (player: Box | null, x: number, y: number): number =>
  player && x > player.x0 - 9 && x < player.x1 + 9 && y > player.y0 - 9 && y < player.y1 + 9 ? player.y0 - 12 : y;

// ---- names and tags

/** A label hung at a point (x, y), centered across it, drawn w by h. */
export interface Mark extends Point, Size {}

/** How labels stack: one drops `gap` below a label above it that it would sit on, judged with `pad` to spare sideways. */
export interface Spacing {
  gap: number;
  pad: number;
}

/**
 * Hang labels from the top of the screen down: each drops below any label above it that it would sit
 * on, then `settle` moves it on its own account (clear of the player, onto the screen) before the ones
 * below are stacked against where it ended up. The answers are in the order the marks came in.
 */
export function stack<M extends Mark, P extends Point>(marks: readonly M[], spacing: Spacing, settle: (at: M) => P): P[] {
  const order = marks.map((_, i) => i).sort((a, b) => marks[a]!.y - marks[b]!.y);
  const out: P[] = new Array<P>(marks.length);
  const done: number[] = [];
  for (const i of order) {
    const m = marks[i]!;
    let y = m.y;
    for (const j of done) {
      const q = out[j]!;
      if (Math.abs(q.x - m.x) < (marks[j]!.w + m.w) / 2 + spacing.pad && y - q.y < spacing.gap) y = q.y + spacing.gap;
    }
    out[i] = settle({ ...m, y });
    done.push(i);
  }
  return out;
}

/** A ship's name: `board` marks the viewer's own ship to board, which waits at the screen's edge when she is off it. */
export interface Name extends Mark {
  board: boolean;
}
export interface NamePlace extends Point {
  /** The edge a ship to board waits at, or null where she is on screen (and for every other ship). */
  edge: Edge | null;
}

/** Ships' names, each hanging centered below its point: a line apart, and clear of the player. `area` is the screen they keep to. */
export function layoutNames(names: readonly Name[], { area, player }: { area: Box; player: Box | null }): NamePlace[] {
  return stack(names, { gap: 26, pad: 6 }, (at) => {
    const half = at.w / 2;
    let { x, y } = at;
    // A ship's name hangs from its point; one over the player drops below them.
    if (player && overlaps(player, { x0: x - half, y0: y, x1: x + half, y1: y + at.h })) y = player.y1 + 2;
    if (!at.board) return { x, y, edge: null };
    // The player's own ship to board waits at the screen's edge when she is off it, pointing the way.
    const edge: Edge | null = x < area.x0 + half ? "left" : x > area.x1 - half ? "right" : y < area.y0 ? "up" : y > area.y1 - at.h ? "down" : null;
    if (edge) {
      x = Math.max(area.x0 + half, Math.min(area.x1 - half, x));
      y = Math.max(area.y0, Math.min(area.y1 - at.h, y));
    }
    return { x, y, edge };
  });
}

/** Pirates' name tags, each standing centered over its point: a line apart, and clear of the player. */
export function layoutTags(tags: readonly Mark[], { player }: { player: Box | null }): Point[] {
  return stack(tags, { gap: 20, pad: 4 }, (at) => {
    // A tag stands centered over its point and above it; one that would cover the player rises clear.
    const half = at.w / 2;
    const covers = player && overlaps(player, { x0: at.x - half, y0: at.y - at.h, x1: at.x + half, y1: at.y });
    return { x: at.x, y: covers ? player.y0 - 2 : at.y };
  });
}

// ---- spots

/** A spot's thing on screen: its pin at (x, y), and (sx, sy) where it is on the ship's steady frame, without the bob. */
export interface Pinned extends Point {
  sx: number;
  sy: number;
}

/** A label standing beside its pin, a leader from the pin to it; `flip` stands it to the left of `label` rather than the right. */
export interface Beside {
  kind: "beside";
  pin: Point;
  label: Point;
  flip: boolean;
  /** Where the leader from the pin meets the label. */
  leader: Point;
}
/** A label waiting at the screen's edge for a thing that is off it; its pin and leader are not drawn. */
export interface AtEdge {
  kind: "edge";
  edge: Edge;
  label: Point;
}
export type SpotPlace = Beside | AtEdge;

/** A spot to hang beside its pin: its label drawn w by h, its box `lift` above the line it is placed on (its CSS top margin). */
export interface PinSpot extends Pinned, Size {
  lift: number;
  /** Which place beside its pin the label took last, kept while it stays free so labels do not hop; null for none. */
  kept: number | null;
}
/** Where a spot's label goes, and the place beside its pin to keep for next time. */
export type PinPlace = SpotPlace & { kept: number | null };

/** How far a label stands across from its pin, and down from it. */
const SPOT_DX = 18;
const SPOT_DY = -12;

/**
 * Each label beside its pin: to the right, then the left, then above, then below; the first that stays
 * in `area` and covers nothing in `avoid`, no other pin and not the player wins. Failing all, it steps
 * down past what is in the way. A spot whose thing is off the area waits at the edge nearest it,
 * sliding along past labels already there. Labels whose pins are on screen go first, nearest the top
 * first. The answers are in the order the spots came in.
 */
export function layoutPins(spots: readonly PinSpot[], { area, avoid, player }: { area: Box; avoid: readonly Box[]; player: Box | null }): PinPlace[] {
  const inside = (p: PinSpot): boolean => p.sx >= area.x0 && p.sx <= area.x1 && p.sy >= area.y0 && p.sy <= area.y1;
  const at = spots.map((p) => ({ ...p, y: pinClearOf(player, p.x, p.y) }));
  // Pins on screen, and the player, are things a label must not cover.
  const pins = at.flatMap((p, owner) => (inside(p) ? [{ owner, x0: p.x - 10, y0: p.y - 10, x1: p.x + 10, y1: p.y + 10 }] : []));
  const taken: Box[] = [...avoid];
  const boxAt = (p: PinSpot, x0: number, ly: number): Box => ({ x0: x0 - 2, y0: ly - p.lift - 2, x1: x0 + p.w + 2, y1: ly - p.lift + p.h + 2 });
  const beside = (p: PinSpot, flip: boolean, ly: number): Box => boxAt(p, flip ? p.x - SPOT_DX - p.w : p.x + SPOT_DX, ly);
  const free = (i: number, box: Box): boolean =>
    box.x0 >= area.x0 && box.x1 <= area.x1 && box.y0 >= area.y0 && box.y1 <= area.y1 && !taken.some((t) => overlaps(t, box)) && !pins.some((q) => q.owner !== i && overlaps(q, box)) && !(player && overlaps(player, box));
  const blocked = (box: Box): boolean => taken.some((t) => overlaps(t, box)) || Boolean(player && overlaps(player, box));
  // Labels whose pins are on screen first, nearest the top first; the ones waiting at the edges after.
  const order = at.map((_, i) => i).sort((a, b) => Number(!inside(at[a]!)) - Number(!inside(at[b]!)) || at[a]!.sy - at[b]!.sy || at[a]!.sx - at[b]!.sx);
  const out: PinPlace[] = new Array<PinPlace>(spots.length);
  for (const i of order) {
    const p = at[i]!;
    if (!inside(p)) {
      // Its thing is off screen (zoomed in): the label waits at the edge nearest it, pointing the way.
      const edge: Edge = p.sx < area.x0 ? "left" : p.sx > area.x1 ? "right" : p.sy < area.y0 ? "up" : "down";
      let x0 = Math.max(area.x0 + 4, Math.min(area.x1 - 4 - p.w, p.sx - p.w / 2));
      let ly = Math.max(area.y0 + 4 + p.lift, Math.min(area.y1 - 4 - p.h + p.lift, p.sy));
      // Slide along the edge past any label (or the player) already there.
      for (let guard = 0; guard < 16 && blocked(boxAt(p, x0, ly)); guard++) {
        if (edge === "left" || edge === "right") ly = ly + p.h + 4 > area.y1 - p.h + p.lift ? area.y0 + 4 + p.lift + guard * 8 : ly + p.h + 4;
        else x0 = x0 + p.w + 6 > area.x1 - p.w ? area.x0 + 4 + guard * 12 : x0 + p.w + 6;
      }
      taken.push(boxAt(p, x0, ly));
      out[i] = { kind: "edge", edge, label: { x: x0, y: ly }, kept: p.kept };
      continue;
    }
    // Beside the pin to the right, then the left, then above, then below; the first spot that covers
    // no other label, no other pin and not the player wins. Failing all, step down past what is in the way.
    const options: { flip: boolean; ly: number }[] = [
      { flip: false, ly: p.y + SPOT_DY },
      { flip: true, ly: p.y + SPOT_DY },
      { flip: false, ly: p.y - 12 - p.h + p.lift },
      { flip: true, ly: p.y - 12 - p.h + p.lift },
      { flip: false, ly: p.y + 12 + p.lift },
      { flip: true, ly: p.y + 12 + p.lift },
    ];
    const kept = p.kept !== null ? options[p.kept] : undefined;
    let pick = kept && free(i, beside(p, kept.flip, kept.ly)) ? kept : options.find((o) => free(i, beside(p, o.flip, o.ly)));
    const keep = pick ? options.indexOf(pick) : null;
    if (!pick) {
      const flip = p.x + SPOT_DX + p.w > area.x1 - 4;
      let ly = p.y + SPOT_DY;
      for (let guard = 0; guard < 16 && blocked(beside(p, flip, ly)); guard++) ly += p.h * 0.5 + 2;
      pick = { flip, ly };
    }
    taken.push(beside(p, pick.flip, pick.ly));
    const lx = pick.flip ? p.x - SPOT_DX : p.x + SPOT_DX;
    out[i] = { kind: "beside", pin: { x: p.x, y: p.y }, label: { x: lx, y: pick.ly }, flip: pick.flip, leader: { x: lx, y: pick.ly - p.lift + p.h / 2 }, kept: keep };
  }
  return out;
}

/** A deck label's width in full (name and who), for deciding whether columns fit beside the hull. */
const CALLOUT_W = 165;
/** How far a column's labels stand above the line they are placed on (their CSS top margin on a wide screen). */
const CALLOUT_LIFT = 14;

/**
 * The deck's spots are a hand's width apart, so their labels stand in two columns, one each side
 * of the hull: a pin on the port half of the deck gets its label on the left, a pin on the
 * starboard half on the right, each column in deck order from bow to stern. Leaders never cross
 * and stay short: a callout diagram rather than a pile of pills. When one side has no room
 * (the card unfolded beside the ship) every label stands on the other. Null when neither side has
 * room, or a column would cover the player: then each label hangs beside its pin (`layoutPins`).
 * The answers are in the order the spots came in.
 */
export function layoutColumns(spots: readonly (Pinned & Size)[], { area, player }: { area: Box; player: Box | null }): Beside[] | null {
  if (spots.length === 0) return [];
  const pins = spots.map((p, i) => ({ ...p, i, y: pinClearOf(player, p.x, p.y) }));
  type Pin = (typeof pins)[number];
  let minX = Infinity;
  let maxX = -Infinity;
  let maxWidth = 0;
  let maxHeight = 0;
  for (const p of pins) {
    minX = Math.min(minX, p.sx);
    maxX = Math.max(maxX, p.sx);
    maxWidth = Math.max(maxWidth, p.w);
    maxHeight = Math.max(maxHeight, p.h);
  }
  const roomRight = area.x1 - (maxX + 40);
  const roomLeft = minX - 40 - area.x0;
  // Two columns of equal weight, the portmost half of the pins on the left, when a column fits
  // beside the hull on each side; one column on the side that has room when only one does (the
  // card unfolded beside the ship); and none when neither does, so the caller hangs each label
  // beside its pin rather than string leaders over the deck.
  // Judged by a label's full width, not as drawn now: compact labels must not tip it back.
  const fitsRight = roomRight >= CALLOUT_W * 0.75;
  const fitsLeft = roomLeft >= CALLOUT_W * 0.75;
  if (!fitsRight && !fitsLeft) return null;
  const both = fitsRight && fitsLeft && pins.length > 2;
  const byX = [...pins].sort((a, b) => a.sx - b.sx);
  const half = Math.ceil(byX.length / 2);
  const sides: { right: boolean; pins: Pin[] }[] = both
    ? [
        { right: false, pins: byX.slice(0, half) },
        { right: true, pins: byX.slice(half) },
      ]
    : [{ right: fitsRight, pins }];
  // Labels stack a little apart, however tall a phone draws them.
  const gap = Math.max(30, maxHeight + 6);
  const laid: { p: Pin; col: number; ly: number; right: boolean }[] = [];
  for (const side of sides) {
    if (side.pins.length === 0) continue;
    const colPins = side.pins.sort((a, b) => a.sy - b.sy);
    const nearest = side.right ? Math.max(...colPins.map((p) => p.sx)) : Math.min(...colPins.map((p) => p.sx));
    // The column stands a hand's width off the pins it serves, and never past the screen's edge.
    const col = side.right ? Math.min(nearest + 40, area.x1 - maxWidth) : Math.max(nearest - 40, area.x0 + maxWidth);
    const meanY = colPins.reduce((n, p) => n + p.sy, 0) / colPins.length;
    let y0 = meanY - ((colPins.length - 1) * gap) / 2;
    y0 = Math.max(area.y0, Math.min(area.y1 - (colPins.length - 1) * gap, y0));
    colPins.forEach((p, i) => laid.push({ p, col, ly: y0 + i * gap, right: side.right }));
  }
  // A column may never cover the player; if one would, the labels hang beside their pins instead.
  if (player) {
    for (const { p, col, ly, right } of laid) {
      const x0 = right ? col : col - p.w;
      if (overlaps(player, { x0, y0: ly - CALLOUT_LIFT, x1: x0 + p.w, y1: ly - CALLOUT_LIFT + p.h })) return null;
    }
  }
  const out: Beside[] = new Array<Beside>(spots.length);
  for (const { p, col, ly, right } of laid) out[p.i] = { kind: "beside", pin: { x: p.x, y: p.y }, label: { x: col, y: ly }, flip: !right, leader: { x: col, y: ly + CALLOUT_LIFT } };
  return out;
}
