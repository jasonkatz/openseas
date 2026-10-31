/** The twelve free pentominoes, as (x, y) cells with the bounding box origin at (0, 0). Index = shape. */
export const PENTOMINOES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]], // F
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], // I
  [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]], // L
  [[1, 0], [1, 1], [0, 2], [1, 2], [0, 3]], // N
  [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], // P
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]], // T
  [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], // U
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], // V
  [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]], // W
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], // X
  [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]], // Y
  [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]], // Z
];

export const PENTOMINO_LETTERS = ["F", "I", "L", "N", "P", "T", "U", "V", "W", "X", "Y", "Z"] as const;

export type Cells = ReadonlyArray<readonly [number, number]>;

function normalize(cells: Cells): Array<[number, number]> {
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of cells) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  return cells.map(([x, y]) => [x - minX, y - minY] as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Cells of `shape` rotated `rot` quarter turns clockwise, mirrored first when `flip`, normalized to origin. */
export function orient(shape: number, rot: number, flip: boolean): Array<[number, number]> {
  let cells: Cells = PENTOMINOES[shape] ?? [];
  if (flip) cells = cells.map(([x, y]) => [-x, y] as const);
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) cells = cells.map(([x, y]) => [-y, x] as const);
  return normalize(cells);
}

/** Width and height of an oriented shape's bounding box. */
export function extent(cells: Cells): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const [x, y] of cells) {
    w = Math.max(w, x + 1);
    h = Math.max(h, y + 1);
  }
  return { w, h };
}
