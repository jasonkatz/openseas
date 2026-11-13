import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Station } from "@openseas/engine";
import { t } from "@openseas/boards";
import type { TurnSample } from "./sim.js";
import { stationName } from "./names.js";

/**
 * The voyage bench's charts, drawn as plain SVG at the size they are shown. Each chart is one
 * measure on one axis (small multiples share the turn axis, never a second scale); colors come from
 * the `--vchart-*` tokens in harness.css; text stays in the text colors; every chart answers a hover.
 */

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** A tick step of 1, 2 or 5 times a power of ten giving about `count` ticks over `span`. */
function niceStep(span: number, count: number): number {
  const raw = Math.max(1, span / Math.max(1, count));
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

export interface Measure {
  readonly id: string;
  readonly label: string;
  readonly max: number;
  value(s: TurnSample): number;
  format(v: number): string;
  /** Draw as steps (a count), not a line. */
  readonly step?: boolean;
}

const GUTTER = 40;
const RIGHT = 10;
const MULTIPLE_H = 64;

/** Where a turn's column sits, and which column a pointer is over. */
function columns(width: number, n: number) {
  const plot = Math.max(1, width - GUTTER - RIGHT);
  const cell = plot / Math.max(1, n);
  return {
    cell,
    x: (i: number) => GUTTER + (i + 0.5) * cell,
    left: (i: number) => GUTTER + i * cell,
    at: (px: number) => Math.max(0, Math.min(n - 1, Math.floor((px - GUTTER) / cell))),
  };
}

/** Battle, melee and held turns as shaded bands behind every multiple. */
function PhaseBands({ samples, width, height }: { samples: readonly TurnSample[]; width: number; height: number }) {
  const c = columns(width, samples.length);
  return (
    <g aria-hidden="true">
      {samples.map((s, i) => {
        const kind = s.phase !== "flying" ? s.phase : s.held ? "held" : null;
        return kind ? <rect key={i} x={c.left(i)} y={0} width={Math.max(1, c.cell)} height={height} className={`vchart-band vchart-band-${kind}`} /> : null;
      })}
    </g>
  );
}

export function PhaseLegend() {
  return (
    <ul className="vchart-legend" aria-label={t("harness.voyage.chart_legend")}>
      {(["battle", "melee", "held"] as const).map((k) => (
        <li key={k}>
          <i className={`vchart-swatch vchart-band-${k}`} aria-hidden="true" />
          {t(`harness.voyage.band_${k}`)}
        </li>
      ))}
    </ul>
  );
}

function Multiple({ samples, measure, width, hover, onHover, axis }: { samples: readonly TurnSample[]; measure: Measure; width: number; hover: number | null; onHover(i: number | null): void; axis: boolean }) {
  const n = samples.length;
  const c = columns(width, n);
  const top = 6;
  const h = MULTIPLE_H;
  const y = (v: number) => top + (h - top) * (1 - Math.max(0, Math.min(measure.max, v)) / measure.max);
  let d = "";
  samples.forEach((s, i) => {
    const vx = c.x(i);
    const vy = y(measure.value(s));
    if (i === 0) d = `M${vx},${vy}`;
    else if (measure.step) d += `H${vx}V${vy}`;
    else d += `L${vx},${vy}`;
  });
  const tickStep = niceStep(n, Math.max(2, Math.floor(width / 90)));
  const xticks: number[] = [];
  for (let turn = tickStep; turn <= (samples[n - 1]?.turn ?? 0); turn += tickStep) xticks.push(turn);
  const turnIndex = (turn: number) => samples.findIndex((s) => s.turn === turn);
  const hs = hover !== null ? samples[hover] : undefined;
  return (
    <svg
      width={width}
      height={h + (axis ? 18 : 2)}
      className="vchart"
      role="img"
      aria-label={measure.label}
      onPointerMove={(e) => onHover(c.at(e.clientX - e.currentTarget.getBoundingClientRect().left))}
      onPointerLeave={() => onHover(null)}
      data-testid={`vchart-${measure.id}`}
    >
      <PhaseBands samples={samples} width={width} height={h} />
      <line x1={GUTTER} x2={width - RIGHT} y1={h} y2={h} className="vchart-axis" />
      <line x1={GUTTER} x2={width - RIGHT} y1={top} y2={top} className="vchart-grid" />
      <text x={GUTTER - 6} y={top + 4} className="vchart-tick" textAnchor="end">
        {measure.format(measure.max)}
      </text>
      <text x={GUTTER - 6} y={h} className="vchart-tick" textAnchor="end">
        {measure.format(0)}
      </text>
      <path d={d} className="vchart-line" />
      {hs && (
        <>
          <line x1={c.x(hover!)} x2={c.x(hover!)} y1={top} y2={h} className="vchart-cursor" />
          <circle cx={c.x(hover!)} cy={y(measure.value(hs))} r={4} className="vchart-dot" />
        </>
      )}
      {axis &&
        xticks.map((turn) => {
          const i = turnIndex(turn);
          return i < 0 ? null : (
            <text key={turn} x={c.x(i)} y={h + 14} className="vchart-tick" textAnchor="middle">
              {turn}
            </text>
          );
        })}
    </svg>
  );
}

/** The ship turn by turn: one small chart per measure on the same turn axis, the phase behind each. */
export function TimelineCharts({ samples, measures, hover, onHover }: { samples: readonly TurnSample[]; measures: readonly Measure[]; hover: number | null; onHover(i: number | null): void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="vchart-stack">
      {width > 0 &&
        measures.map((m, k) => (
          <figure key={m.id} className="vchart-figure">
            <figcaption>{m.label}</figcaption>
            <Multiple samples={samples} measure={m} width={width} hover={hover} onHover={onHover} axis={k === measures.length - 1} />
          </figure>
        ))}
      {width > 0 && <p className="vchart-axis-label muted small">{t("harness.voyage.axis_turn")}</p>}
    </div>
  );
}

const HEAT_GUTTER = 96;
const ROW_H = 16;

/** Each station's output per turn as a percent of par: one row per station, darker for less. */
export function OutputHeatmap({ samples, stations, hover, onHover }: { samples: readonly TurnSample[]; stations: readonly Station[]; hover: number | null; onHover(i: number | null): void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = samples.length;
  const plot = Math.max(1, width - HEAT_GUTTER - RIGHT);
  const cell = plot / Math.max(1, n);
  const gap = cell > 6 ? 1 : 0;
  const at = (px: number) => Math.max(0, Math.min(n - 1, Math.floor((px - HEAT_GUTTER) / cell)));
  const h = stations.length * (ROW_H + 2);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={h}
          className="vchart"
          role="img"
          aria-label={t("harness.voyage.chart_outputs")}
          onPointerMove={(e) => onHover(at(e.clientX - e.currentTarget.getBoundingClientRect().left))}
          onPointerLeave={() => onHover(null)}
          data-testid="vchart-outputs"
        >
          {stations.map((st, r) => (
            <g key={st}>
              <text x={HEAT_GUTTER - 8} y={r * (ROW_H + 2) + ROW_H - 4} className="vchart-tick" textAnchor="end">
                {stationName(st)}
              </text>
              {samples.map((s, i) => {
                const v = s.outputs[st];
                return (
                  <rect
                    key={i}
                    x={HEAT_GUTTER + i * cell}
                    y={r * (ROW_H + 2)}
                    width={Math.max(0.5, cell - gap)}
                    height={ROW_H}
                    className="vchart-heat"
                    fillOpacity={v <= 0 ? 0.05 : 0.15 + (0.85 * Math.min(200, v)) / 200}
                  />
                );
              })}
            </g>
          ))}
          {hover !== null && <rect x={HEAT_GUTTER + hover * cell} y={0} width={Math.max(1, cell)} height={h} className="vchart-heat-cursor" />}
        </svg>
      )}
      <div className="vchart-scale" aria-hidden="true">
        <span>0%</span>
        <i />
        <span>{t("harness.voyage.scale_par")}</span>
        <i />
        <span>200%</span>
      </div>
    </div>
  );
}

/** How many voyages took how long: one column per span of turns. */
export function Histogram({ values, label, unit }: { values: readonly number[]; label: string; unit: (lo: number, hi: number, count: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (values.length === 0) return <div ref={ref} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const size = niceStep(hi - lo + 1, 16);
  const start = Math.floor(lo / size) * size;
  const bins = Math.floor((hi - start) / size) + 1;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of values) counts[Math.floor((v - start) / size)]! += 1;
  const top = Math.max(...counts);
  const h = 110;
  const plot = Math.max(1, width - GUTTER - RIGHT);
  const band = plot / bins;
  const bar = Math.min(24, Math.max(2, band - 2));
  const y = (c: number) => 8 + (h - 8) * (1 - c / top);
  const labelEvery = Math.max(1, Math.ceil(bins / Math.max(1, Math.floor(plot / 48))));
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={h + 18} className="vchart" role="img" aria-label={label} onPointerLeave={() => setHover(null)} data-testid="vchart-histogram">
          <line x1={GUTTER} x2={width - RIGHT} y1={h} y2={h} className="vchart-axis" />
          <text x={GUTTER - 6} y={12} className="vchart-tick" textAnchor="end">
            {top}
          </text>
          <text x={GUTTER - 6} y={h} className="vchart-tick" textAnchor="end">
            0
          </text>
          {counts.map((c, i) => {
            const x = GUTTER + i * band + (band - bar) / 2;
            const yy = y(c);
            const r = Math.min(4, bar / 2, h - yy);
            return (
              <g key={i} onPointerEnter={() => setHover(i)}>
                <rect x={GUTTER + i * band} y={0} width={band} height={h} fill="transparent" />
                {c > 0 && <path d={`M${x},${h}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bar - r}Q${x + bar},${yy} ${x + bar},${yy + r}V${h}Z`} className={`vchart-bar ${hover === i ? "is-hover" : ""}`} />}
                {i % labelEvery === 0 && (
                  <text x={GUTTER + i * band + band / 2} y={h + 14} className="vchart-tick" textAnchor="middle">
                    {start + i * size}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <p className="muted small vchart-readout" aria-live="polite">
        {hover !== null ? unit(start + hover * size, start + (hover + 1) * size - 1, counts[hover]!) : label}
      </p>
    </div>
  );
}

export interface Part {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly icon: ReactNode;
}

/** One whole split into parts: a tall segmented bar with each part's share inside, and a legend. */
export function SegmentedBar({ parts, label }: { parts: readonly Part[]; label: string }) {
  const total = parts.reduce((n, p) => n + p.count, 0);
  if (total === 0) return null;
  const pct = (c: number) => Math.round((c * 100) / total);
  return (
    <div className="vseg" data-testid="vchart-outcomes">
      <div className="vseg-bar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.count}`).join(", ")}`}>
        {parts.map((p) =>
          p.count > 0 ? (
            <span key={p.id} className={`vseg-part vseg-${p.id}`} style={{ flexGrow: p.count }} title={`${p.label}: ${p.count} (${pct(p.count)}%)`}>
              {pct(p.count) >= 12 ? `${pct(p.count)}%` : ""}
            </span>
          ) : null,
        )}
      </div>
      <ul className="vchart-legend">
        {parts.map((p) => (
          <li key={p.id}>
            <i className={`vchart-swatch vseg-${p.id}`} aria-hidden="true" />
            {p.icon} {p.label} <span className="muted">{p.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
