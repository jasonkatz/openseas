import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { content, t } from "@openseas/boards";
import { tierFor } from "@openseas/engine";
import type { Threshold } from "../frame/numbers.js";
import type { PlayedRound } from "../frame/rounds.js";
import { useBox } from "../studio/useBox.js";

/** A number held to a control's bounds and its kind. */
function clamp(v: number, min: number | null, max: number | null, integer: boolean): number {
  let n = integer ? Math.round(v) : Number(v.toFixed(3));
  if (min !== null) n = Math.max(min, n);
  if (max !== null) n = Math.min(max, n);
  return n;
}

/** A round number at or over `v`, for a chart's top. */
function niceTop(v: number): number {
  if (v <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
}

/**
 * A curve drawn large, in a panel opened wide (ADR 0068): one bar a step, as tall as its value,
 * with the value on it and the shipped value as a dashed mark where the draft has moved it.
 * Pressing a bar sets it to where the press is, and dragging across paints the steps passed over,
 * so a curve's shape is drawn rather than typed. The fields under it stay for exact numbers.
 */
export function CurveChart({
  name,
  value,
  shipped,
  min,
  max,
  integer,
  onSet,
  testId,
}: {
  name: string;
  value: readonly number[];
  shipped: readonly number[];
  min: number | null;
  max: number | null;
  integer: boolean;
  onSet(v: number[]): void;
  testId: string;
}) {
  const plot = useRef<HTMLDivElement>(null);
  // The scale holds still while a hand is on the chart, or the bars would run from it.
  const held = useRef<{ lo: number; hi: number; values: number[] } | null>(null);
  const lo = Math.min(0, min ?? 0, ...value, ...shipped);
  // Room above the tallest step to draw it taller, but never past what the schema allows.
  const hi = Math.min(max ?? Infinity, niceTop(Math.max(...value, ...shipped, 1) * 1.5));
  const scale = held.current ?? { lo, hi };
  const pct = (v: number): number => ((v - scale.lo) / (scale.hi - scale.lo || 1)) * 100;
  const zero = pct(Math.max(scale.lo, 0));

  const paint = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const h = held.current;
    const box = plot.current?.getBoundingClientRect();
    if (!h || !box) return;
    const i = Math.floor(((e.clientX - box.left) / box.width) * value.length);
    if (i < 0 || i >= value.length) return;
    const frac = 1 - (e.clientY - box.top) / box.height;
    const v = clamp(h.lo + frac * (h.hi - h.lo), min, max, integer);
    if (h.values[i] === v) return;
    h.values = h.values.map((x, j) => (j === i ? v : x));
    onSet(h.values);
  };
  const letGo = (): void => {
    held.current = null;
  };

  return (
    <div className="curve-chart" role="img" aria-label={t("studio.curve_chart", { key: name })} data-testid={testId}>
      <div
        ref={plot}
        className="chart-plot"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          held.current = { lo, hi, values: [...value] };
          paint(e);
        }}
        onPointerMove={paint}
        onPointerUp={letGo}
        onPointerCancel={letGo}
      >
        <i className="chart-zero" style={{ bottom: `${zero}%` }} />
        {value.map((v, i) => {
          const low = Math.min(pct(v), zero);
          const was = shipped[i];
          return (
            <div key={i} className="chart-col">
              <div
                className={`chart-bar ${was !== undefined && was !== v ? "is-changed" : ""}`}
                style={{
                  bottom: `${low}%`,
                  height: `${Math.max(0.6, Math.abs(pct(v) - zero))}%`,
                }}
              >
                <span className="chart-val mono">{v}</span>
              </div>
              {was !== undefined && was !== v && <i className="chart-ghost" style={{ bottom: `${pct(was)}%` }} title={t("studio.shipped_value", { value: was })} />}
            </div>
          );
        })}
      </div>
      <div className="chart-index" aria-hidden="true">
        {value.map((_, i) => (
          <span key={i} className="mono">
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

const SCALE_W = 440;
const SH = 96;

/**
 * The thresholds as a scale, in a panel opened wide (ADR 0068): the score each rating is reached
 * at, marked on one line with its tier, and the rounds finished on the page as dots along it, so
 * the owner sees where play lands against what the ratings ask.
 */
export function RatingScale({ thresholds, shipped, rounds }: { thresholds: readonly Threshold[]; shipped: readonly Threshold[]; rounds: readonly PlayedRound[] }) {
  // A unit of the scale is a pixel, so its words keep their size however wide the panel opens.
  const room = useRef<HTMLDivElement>(null);
  const measured = useBox(room).width;
  const width = measured > 0 ? Math.round(measured) : SCALE_W;
  const scores = rounds.map((r) => r.summary.score);
  const end = niceTop(Math.max(1, ...thresholds.map((th) => th.score), ...shipped.map((th) => th.score), ...scores) * 1.1);
  const x = (s: number): number => 20 + (Math.max(0, s) / end) * (width - 40);
  const line = 52;
  return (
    <div ref={room} className="rating-room">
      <svg viewBox={`0 0 ${width} ${SH}`} width={width} height={SH} className="rating-scale" role="img" aria-label={t("studio.rating_scale")} data-testid="rating-scale">
        <line x1={x(0)} x2={x(end)} y1={line} y2={line} className="chart-axis" />
        {/* Where the shipped thresholds stood, for the ones the draft has moved. */}
        {shipped.map((th, i) =>
          thresholds[i] && thresholds[i]!.score !== th.score ? <line key={`s${i}`} x1={x(th.score)} x2={x(th.score)} y1={line - 6} y2={line + 6} className="scale-ghost" /> : null,
        )}
        {thresholds.map((th, i) => (
          <g key={i} className={`scale-mark ${shipped[i] && shipped[i]!.score !== th.score ? "is-changed" : ""}`}>
            <line x1={x(th.score)} x2={x(th.score)} y1={line - 8} y2={line + 8} />
            {/* Neighbouring tiers take turns above the line, so close thresholds do not print over each other. */}
            <text x={x(th.score)} y={line - (i % 2 === 0 ? 14 : 30)} textAnchor="middle">
              {t(`tier.${tierFor(th.rating, content.ratingTiers).key}`)}
            </text>
            <text x={x(th.score)} y={line + (i % 2 === 0 ? 22 : 36)} textAnchor="middle" className="scale-score">
              {th.score}
            </text>
          </g>
        ))}
        {rounds.map((r) => (
          <circle key={r.id} cx={x(r.summary.score)} cy={line} r={4} className={`scale-round ${r.changes.length > 0 ? "is-draft" : ""}`} data-testid="scale-round">
            <title>{`${r.summary.seed}: ${r.summary.score}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
