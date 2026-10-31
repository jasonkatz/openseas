import { starPath, type StarShapeName } from "./stars.js";

/** A star for legends and the HUD, drawn as inline SVG with the same silhouettes as the chart. */
export function StarIcon(props: { shape: StarShapeName; color: string; mark?: string | null; hollow?: boolean; size?: number }) {
  const size = props.size ?? 22;
  const r = size * 0.42;
  const c = size / 2;
  const d = starPath(props.shape, c, c, r);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="tile-icon">
      {props.hollow ? (
        <path d={d} fill={props.color} fillOpacity={0.12} stroke={props.color} strokeWidth={Math.max(1.5, r * 0.14)} strokeLinejoin="round" />
      ) : (
        <>
          <path d={d} fill={props.color} stroke="rgba(255,255,255,0.55)" strokeWidth={Math.max(1, r * 0.08)} strokeLinejoin="round" />
          <circle cx={c} cy={c} r={r * 0.22} fill="rgba(255,255,255,0.75)" />
        </>
      )}
      {props.mark && <MarkGlyph x={c} y={c} r={r * 0.3} mark={props.mark} color={props.hollow ? props.color : "#0b1526"} />}
    </svg>
  );
}

function MarkGlyph({ x, y, r, mark, color }: { x: number; y: number; r: number; mark: string; color: string }) {
  const regular = (n: number, rot: number): string =>
    Array.from({ length: n }, (_, i) => `${(x + r * Math.cos(rot + (i * Math.PI * 2) / n)).toFixed(2)},${(y + r * Math.sin(rot + (i * Math.PI * 2) / n)).toFixed(2)}`).join(" ");
  switch (mark) {
    case "circle":
      return <circle cx={x} cy={y} r={r * 0.85} fill={color} />;
    case "square":
      return <rect x={x - r * 0.75} y={y - r * 0.75} width={r * 1.5} height={r * 1.5} fill={color} />;
    case "triangle":
      return <polygon points={regular(3, -Math.PI / 2)} fill={color} />;
    case "diamond":
      return <polygon points={regular(4, -Math.PI / 2)} fill={color} />;
    case "hexagon":
      return <polygon points={regular(6, 0)} fill={color} />;
    default:
      return <circle cx={x} cy={y} r={r * 0.5} fill={color} />;
  }
}
