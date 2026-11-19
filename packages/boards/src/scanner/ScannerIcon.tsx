import { pictogramUrl } from "../kit/pictogram.js";
import { css, FONT } from "../look/tokens.js";
import { SCANNER_PIECES } from "./pieces.js";

/** The seven things a cell can show: a lit ping is a ping that carries the mark's tab. */
export type ScannerCell = "fog" | "clear" | "ping" | "lit" | "found" | "spooked" | "miss";

/**
 * One cell as the board draws it, for a legend: a square of the board's ground with what stands on
 * it. The ground is part of the picture, since fog is a plate against it and a clear cell is the
 * ground itself with its dot. The pieces are the drawings the board bakes.
 */
export function ScannerCellIcon({ cell, size = 24 }: { cell: ScannerCell; size?: number }) {
  const piece = cell === "clear" || cell === "ping" ? null : cell === "lit" ? SCANNER_PIECES.tab : SCANNER_PIECES[cell];
  const number = cell === "ping" || cell === "lit";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="kind-icon">
      <rect width="24" height="24" rx="4" fill={css("ground")} />
      {piece && <image href={pictogramUrl(`scanner:${cell === "lit" ? "tab" : cell}`, piece.color, piece.paint, 48)} x="2" y="2" width="20" height="20" />}
      {cell === "clear" && <circle cx="12" cy="12" r="1.4" fill={css("line")} />}
      {number && (
        <text x="12" y="16.8" textAnchor="middle" fontFamily={FONT.mono} fontSize="13" fontWeight="700" fill={css("cream")}>
          3
        </text>
      )}
    </svg>
  );
}
