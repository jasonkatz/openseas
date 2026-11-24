/** How far apart two columns' centres stand, in cells: close enough that round pieces nest. */
export const HEX_DX = 0.88;

/**
 * The refinery's tower laid out as a honeycomb: `cols` columns of `rows` pieces, every other
 * column half a piece lower. Which columns sit low is the engine's (`refiningLowered`): the board
 * is told it as `phase`, the parity of the draws so far.
 */
export class HexGrid {
  cell = 40;
  ox = 0;
  oy = 0;
  phase = 0;

  constructor(
    public cols: number,
    public rows: number,
  ) {}

  /** Fit the tower into a `width` by `height` area, centred, with `top` cells of room above it. */
  fit(width: number, height: number, opts: { margin?: number; top?: number; maxCell?: number } = {}): void {
    const margin = opts.margin ?? 10;
    const top = opts.top ?? 0;
    const cell = Math.floor(Math.min((width - margin * 2) / this.span(), (height - margin * 2) / (this.rows + 0.5 + top)));
    this.cell = Math.max(12, Math.min(opts.maxCell ?? 96, cell));
    this.ox = Math.floor((width - this.width) / 2);
    this.oy = Math.floor((height - this.cell * (this.rows + 0.5 + top)) / 2 + this.cell * top);
  }

  /** The tower's width in cells. */
  private span(): number {
    return 1 + (this.cols - 1) * HEX_DX;
  }

  get width(): number {
    return this.span() * this.cell;
  }

  get height(): number {
    return (this.rows + 0.5) * this.cell;
  }

  lowered(col: number): boolean {
    return ((col + this.phase) & 1) === 1;
  }

  /** The centre of a column, or of a cell by index. */
  cx(col: number): number {
    return this.ox + (0.5 + col * HEX_DX) * this.cell;
  }
  x(index: number): number {
    return this.cx(index % this.cols);
  }
  y(index: number): number {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    return this.oy + (row + 0.5 + (this.lowered(col) ? 0.5 : 0)) * this.cell;
  }

  /** The cell whose centre is nearest a point, or null when the point is off every piece. */
  at(px: number, py: number): { col: number; row: number; index: number } | null {
    let best = -1;
    let bestD = (this.cell * 0.6) ** 2;
    for (let i = 0; i < this.cols * this.rows; i++) {
      const d = (px - this.x(i)) ** 2 + (py - this.y(i)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    return { col: best % this.cols, row: Math.floor(best / this.cols), index: best };
  }
}
