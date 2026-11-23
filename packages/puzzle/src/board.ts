/**
 * The board the rules know (docs/puzzles/DOMAIN.md, "The board", "Pieces", "Board changes"): cells
 * counted in rows from the top and columns from the left, zones beside it, and the pieces on them.
 * It only ever changes by a board change, and every board change is carried on an event, so a
 * board drawn from a round's start and its events alone matches the round (`applyChanges`).
 */

/** A cell, as its index (row × width + column), or a numbered spot in a zone. */
export type Place = number | { readonly zone: string; readonly spot: number };

export const DIRECTIONS = ["up", "down", "left", "right"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** A piece on the board: its id within the round, which declared piece it is, and its kind and state where it has them. */
export interface PieceOn {
  readonly id: number;
  readonly piece: string;
  /** A member of a family: its kind, numbered from 1. */
  readonly kind?: number;
  /** A named form, or the number it shows. */
  readonly state?: string | number;
}

export interface Board {
  readonly width: number;
  readonly height: number;
  /** Row-major from the top left. */
  readonly cells: readonly (PieceOn | null)[];
  readonly zones: Readonly<Record<string, readonly (PieceOn | null)[]>>;
}

export type Change =
  | { readonly change: "arrive"; readonly piece: PieceOn; readonly at: Place; readonly from: "in-place" | { readonly zone: string; readonly spot: number } | { readonly off: Direction } }
  | { readonly change: "leave"; readonly id: number; readonly at: Place; readonly as: "cleared" | { readonly zone: string; readonly spot: number } }
  | { readonly change: "travel"; readonly id: number; readonly from: number; readonly to: number; readonly route?: readonly number[] }
  | { readonly change: "change"; readonly id: number; readonly at: Place; readonly becomes: { readonly piece?: string; readonly kind?: number; readonly state?: string | number } };

export function emptyBoard(width: number, height: number, zones: Readonly<Record<string, number>>): Board {
  return {
    width,
    height,
    cells: new Array<PieceOn | null>(width * height).fill(null),
    zones: Object.fromEntries(Object.entries(zones).map(([id, holds]) => [id, new Array<PieceOn | null>(holds).fill(null)])),
  };
}

const describe = (p: Place): string => (typeof p === "number" ? `cell ${p}` : `${p.zone} ${p.spot}`);

/**
 * The board after one event's changes. They happen together: everything that leaves or travels is
 * taken up first, then everything that arrives or travels is set down, so two pieces can trade
 * cells. A change that does not fit the board (a piece that is not where it says, a cell taken
 * twice) is a bug in the rules and throws.
 */
export function applyChanges(board: Board, changes: readonly Change[]): Board {
  if (changes.length === 0) return board;
  const cells = board.cells.slice();
  const zones: Record<string, (PieceOn | null)[]> = Object.fromEntries(Object.entries(board.zones).map(([id, spots]) => [id, spots.slice()]));
  const get = (p: Place): PieceOn | null => {
    if (typeof p === "number") {
      if (!Number.isInteger(p) || p < 0 || p >= cells.length) throw new Error(`no ${describe(p)} on the board`);
      return cells[p] ?? null;
    }
    const spots = zones[p.zone];
    if (!spots || !Number.isInteger(p.spot) || p.spot < 0 || p.spot >= spots.length) throw new Error(`no ${describe(p)} on the board`);
    return spots[p.spot] ?? null;
  };
  const set = (p: Place, piece: PieceOn | null): void => {
    if (typeof p === "number") cells[p] = piece;
    else zones[p.zone]![p.spot] = piece;
  };
  const take = (id: number, p: Place): PieceOn => {
    const there = get(p);
    if (!there || there.id !== id) throw new Error(`piece ${id} is not at ${describe(p)}`);
    set(p, null);
    return there;
  };
  const put = (p: Place, piece: PieceOn): void => {
    if (get(p)) throw new Error(`${describe(p)} is taken twice`);
    set(p, piece);
  };

  const moving: { piece: PieceOn; to: number }[] = [];
  for (const c of changes) {
    if (c.change === "leave") take(c.id, c.at);
    else if (c.change === "travel") moving.push({ piece: take(c.id, c.from), to: c.to });
  }
  for (const m of moving) put(m.to, m.piece);
  for (const c of changes) {
    if (c.change === "arrive") put(c.at, c.piece);
    else if (c.change === "change") {
      const was = get(c.at);
      if (!was || was.id !== c.id) throw new Error(`piece ${c.id} is not at ${describe(c.at)}`);
      const next: { id: number; piece: string; kind?: number; state?: string | number } = { id: was.id, piece: c.becomes.piece ?? was.piece };
      const kind = c.becomes.kind ?? was.kind;
      const state = c.becomes.state ?? was.state;
      if (kind !== undefined) next.kind = kind;
      if (state !== undefined) next.state = state;
      set(c.at, next);
    }
  }
  return { width: board.width, height: board.height, cells, zones };
}

/** What a board holds, as one line: the same for two boards exactly when they hold the same pieces in the same places. */
export function boardString(board: Board): string {
  const one = (p: PieceOn | null): string => (p ? `${p.id}:${p.piece}${p.kind === undefined ? "" : `.${p.kind}`}${p.state === undefined ? "" : `=${p.state}`}` : "-");
  const zones = Object.keys(board.zones)
    .sort()
    .map((z) => `${z}[${board.zones[z]!.map(one).join(" ")}]`);
  return [`${board.width}x${board.height}`, board.cells.map(one).join(" "), ...zones].join("|");
}
