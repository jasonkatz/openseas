import { pictogramUrl } from "../kit/pictogram.js";
import { css, FONT } from "../look/tokens.js";
import { SCANNER_PIECES } from "./pieces.js";

/** The six things a cell can show. */
export type ScannerCell = "fog" | "clear" | "ping" | "found" | "spooked" | "miss";

/**
 * One cell as the board draws it, for a legend: a square of the board's ground with what stands on
 * it. The ground is part of the picture, since fog is a plate against it and a clear cell is the
 * ground itself with its dot. The pieces are the drawings the board bakes.
 */
export function ScannerCellIcon({ cell, size = 24 }: { cell: ScannerCell; size?: number }) {
  const piece = cell === "clear" || cell === "ping" ? null : SCANNER_PIECES[cell];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="kind-icon">
      <rect width="24" height="24" rx="4" fill={css("ground")} />
      {piece && <image href={pictogramUrl(`scanner:${cell}`, piece.color, piece.paint, 48)} x="2" y="2" width="20" height="20" />}
      {cell === "clear" && <circle cx="12" cy="12" r="1.4" fill={css("line")} />}
      {cell === "ping" && (
        <text x="12" y="16.8" textAnchor="middle" fontFamily={FONT.mono} fontSize="13" fontWeight="700" fill={css("cream")}>
          3
        </text>
      )}
    </svg>
  );
}
