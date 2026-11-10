import { INK, KINDS, PIPS, hex, kindStyle, mix, shapePoints } from "./art.js";

export interface KindIconProps {
  kind: number;
  size?: number;
  /** Draw the kind's pips, as the board does with marks on. */
  marks?: boolean;
  hollow?: boolean;
  /** Override the kind's color. */
  color?: number;
}

/** A placeholder piece as an inline SVG, for legends and HUD rows: the same silhouette and color the board draws (ADR 0036). */
export function KindIcon({ kind, size = 22, marks = false, hollow = false, color }: KindIconProps) {
  const style = kindStyle(kind);
  const fill = color ?? style.color;
  const r = 9;
  const pts = shapePoints(style.shape, 12, 12, r);
  const d = pts ? `M${pts.map((v, i) => (i % 2 === 0 ? `${v.toFixed(2)},` : `${v.toFixed(2)} `)).join("")}Z` : null;
  const common = hollow
    ? { fill: hex(fill), fillOpacity: 0.12, stroke: hex(fill), strokeWidth: 1.6 }
    : { fill: hex(fill), stroke: hex(mix(fill, INK.black, 0.45)), strokeWidth: 1.2 };
  const pips = PIPS[kind % KINDS.length]!;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="kind-icon">
      {d ? <path d={d} strokeLinejoin="round" {...common} /> : <circle cx="12" cy="12" r={r} {...common} />}
      {marks && !hollow && pips.map(([dx, dy], i) => <circle key={i} cx={12 + dx * 3.2} cy={12 + dy * 3.2} r="1.15" fill="#000" fillOpacity="0.78" />)}
    </svg>
  );
}
