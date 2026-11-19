import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { tierFor } from "@openseas/engine";
import { PuzzleNumbersSchema } from "@openseas/content";
import { content, t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { formatNumber, type Refusal, type Threshold } from "../frame/numbers.js";
import { MODE_SECTIONS, NUMBER_MODES, humanize, labelOf, type ModeId, type NumberMode, type SectionId } from "../studio/modes.js";
import { useWidePanel } from "../studio/wide.js";
import { CurveChart, RatingScale } from "./charts.jsx";
import { configControls, roundControls, sliderRange, valueAt, type Control } from "./controls.js";
import { TUNING_GROUPS } from "./groups/index.js";

const shape = PuzzleNumbersSchema.shape;
const ROUND_BOUNDS = {
  roundSeconds: [shape.roundSeconds.minValue ?? 1, shape.roundSeconds.maxValue ?? 3600] as [number, number],
  paceSeconds: [bareMin(shape.paceSeconds), bareMax(shape.paceSeconds)] as [number, number],
};
function bareMin(s: { unwrap?: () => { minValue: number | null } }): number {
  return s.unwrap?.().minValue ?? 1;
}
function bareMax(s: { unwrap?: () => { maxValue: number | null } }): number {
  return s.unwrap?.().maxValue ?? 120;
}

const owns = (key: string, r: Refusal): boolean => r.key === key || r.key.startsWith(`${key}.`);

/** One section of a numbers panel: its controls, and the thresholds where it is the one that rates. */
export interface NumberSection {
  readonly id: SectionId;
  readonly mode: NumberMode;
  readonly controls: readonly Control[];
  readonly thresholds: boolean;
}

/**
 * Every number the studio tunes, in the sections the three numbers modes show them in
 * (studio/modes): a control for each key under `config`, in its group; the round's length; and
 * the live tier's window with the thresholds. Built from the puzzle's content file and bounded by
 * its wire schema (tuning/controls).
 */
export function useNumberSections(): readonly NumberSection[] {
  const { puzzle, shipped } = useFrame();
  return useMemo(() => {
    const groups = new Map(configControls(puzzle, TUNING_GROUPS[puzzle.id]).map((g) => [g.id as SectionId, g.controls]));
    const [roundSeconds, paceSeconds] = roundControls(shipped, ROUND_BOUNDS) as [Control, Control];
    const out: NumberSection[] = [];
    for (const mode of NUMBER_MODES) {
      for (const id of MODE_SECTIONS[mode]) {
        const controls = id === "round" ? [{ ...roundSeconds, description: t("studio.desc.round_seconds") }] : id === "rating" ? [{ ...paceSeconds, description: t("studio.desc.pace_seconds") }] : (groups.get(id) ?? []);
        if (controls.length > 0) out.push({ id, mode, controls, thresholds: id === "rating" });
      }
    }
    return out;
  }, [puzzle, shipped]);
}

/** The mode a number is tuned in, by its key in the content file. A changed leaf belongs to the control over it. */
export function modeOfKey(sections: readonly NumberSection[], key: string): NumberMode | null {
  if (key === "thresholds") return sections.find((s) => s.thresholds)?.mode ?? null;
  return sections.find((s) => s.controls.some((c) => c.key === key || key.startsWith(`${c.key}.`)))?.mode ?? null;
}

/** A refusal no control can claim (the engine's own check names no key): shown over the panel, whatever its mode. */
export function LooseRefusals({ sections }: { sections: readonly NumberSection[] }) {
  const { refusals } = useFrame();
  const known = [...sections.flatMap((s) => s.controls.map((c) => c.key)), "thresholds"];
  const loose = refusals.filter((r) => !known.some((k) => owns(k, r)));
  if (loose.length === 0) return null;
  return (
    <ul className="tune-refusals" role="alert" data-testid="refusals">
      {loose.map((r, i) => (
        <li key={i}>
          <code>{r.key}</code> {r.message}
        </li>
      ))}
    </ul>
  );
}

/** Whether a search finds any number at all. */
export function anyNumberMatch(sections: readonly NumberSection[], query: string): boolean {
  const q = query.trim().toLowerCase();
  return sections.some((s) => s.controls.some((c) => words(c).includes(q)) || (s.thresholds && `thresholds ${t("studio.group.rating")}`.toLowerCase().includes(q)));
}

function words(c: Control): string {
  return `${c.key} ${humanize(c.name)} ${c.branch ? humanize(c.branch) : ""} ${c.description ?? ""}`.toLowerCase();
}

/**
 * The numbers panels (DESIGN.md 3.14, ADR 0056): Setup, Tuning and Scoring are one list of
 * sections, of which the mode on the rail shows its own. Every section stays in the page while
 * another shows, so a value half typed outlasts a look elsewhere. A search shows the matching
 * numbers from all three, each under the mode it is tuned in, beside the words it finds (studio/TextPanel). It only ever writes the frame's
 * draft: what the draft means for the round on the board is the page's business (studio/useStudio).
 */
export function NumbersPanel({ sections, mode, query, hints, shown: visible }: { sections: readonly NumberSection[]; mode: ModeId; query: string; hints: boolean; shown: boolean }) {
  const frame = useFrame();
  const { shipped, tuned, refusals } = frame;
  const q = query.trim().toLowerCase();
  const hit = (c: Control): boolean => q === "" || words(c).includes(q);
  const ratingHit = q === "" || `thresholds ${t("studio.group.rating")}`.toLowerCase().includes(q);
  const shown = (s: NumberSection): boolean => (q === "" ? s.mode === mode : s.controls.some(hit) || (s.thresholds && ratingHit));
  const row = (c: Control, value: unknown): ReactNode => (
    <ControlRow key={c.key} control={c} value={value} hints={hints} hidden={!hit(c)} refusals={refusals.filter((r) => owns(c.key, r))} onSet={(v) => frame.setNumber(c.key, v)} onReset={() => frame.resetNumber(c.key)} />
  );
  return (
    <div className="tune" data-testid="tuning" hidden={!visible}>
      {sections.map((s) => (
        <section key={s.id} className="panel-sec tune-group" hidden={!shown(s)} data-mode-panel={s.mode} data-testid={`group-${s.id}`}>
          <h3 className="panel-cap">
            {q !== "" && <span className="panel-cap-mode">{t(`studio.mode.${s.mode}`)}</span>}
            {t(`studio.group.${s.id}`)}
          </h3>
          {s.controls.map((c) => row(c, c.key.startsWith("config.") ? valueAt(tuned.config, c.key) : tuned[c.key as "roundSeconds" | "paceSeconds"]))}
          {s.thresholds && (
            <ThresholdsControl
              shipped={shipped.thresholds}
              value={tuned.thresholds}
              hints={hints}
              hidden={!ratingHit}
              refusals={refusals.filter((r) => owns("thresholds", r))}
              onSet={(v) => frame.setNumber("thresholds", v)}
              onReset={() => frame.resetNumber("thresholds")}
            />
          )}
        </section>
      ))}
    </div>
  );
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The frame every control sits in: its key as a label, with the key itself and its line in the
 * title; a dot when it differs from the shipped value and a button that puts it back; and why it
 * is refused. A control that fits beside its label sits on the label's line; the rest sit under it.
 */
function Row({ name, branch, unit, changed, shipped, description, refusals, locked, block, hints, hidden, onReset, children, testKey }: {
  name: string;
  branch: string | null;
  unit: string | null;
  changed: boolean;
  shipped: string;
  description: string | null;
  refusals: readonly Refusal[];
  locked?: boolean;
  block?: boolean;
  hints: boolean;
  hidden?: boolean;
  onReset(): void;
  children: ReactNode;
  testKey: string;
}) {
  const said = labelOf(name, branch, unit);
  return (
    <div className={`num-row ${block ? "is-block" : ""} ${changed ? "is-changed" : ""} ${refusals.length ? "is-refused" : ""}`} hidden={hidden} data-testid={`control-${testKey}`} data-changed={changed ? "1" : "0"}>
      <div className="num-label" title={description ? `${testKey}: ${description}` : testKey}>
        <i className="num-dot" aria-hidden="true" />
        <span className="num-name">
          {said.branch && <small>{said.branch}</small>}
          {said.label}
        </span>
        {said.unit && <span className="num-unit">{t(`studio.unit.${said.unit}`)}</span>}
        {locked && <span className="num-unit">{t("studio.locked")}</span>}
      </div>
      <div className="num-ctl">{children}</div>
      {changed && (
        <button type="button" className="num-reset" onClick={onReset} aria-label={t("studio.reset_one", { key: name, value: shipped })} title={t("studio.reset_one", { key: name, value: shipped })} data-testid={`reset-${testKey}`}>
          <ResetIcon />
        </button>
      )}
      {description && <p className={`tune-desc ${hints ? "" : "sr-only"}`}>{description}</p>}
      {refusals.map((r, i) => (
        <p key={i} className="tune-refusal" role="alert" data-testid={`refusal-${testKey}`}>
          {r.message}
        </p>
      ))}
    </div>
  );
}

export function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path d="M5 9a8 8 0 1 1-1 6M5 4v5h5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ControlRow({ control: c, value, refusals, hints, hidden, onSet, onReset }: { control: Control; value: unknown; refusals: readonly Refusal[]; hints: boolean; hidden: boolean; onSet(v: unknown): void; onReset(): void }) {
  const changed = !same(value, c.shipped);
  // What is neither one number, a switch nor a choice needs the panel's whole width.
  const line = c.locked || ((c.kind === "slider" || c.kind === "stepper") && typeof value === "number") || (c.kind === "toggle" && typeof value === "boolean") || c.kind === "choice";
  const body = ((): ReactNode => {
    if (c.locked) return <output className="tune-value mono">{formatNumber(c.key, value)}</output>;
    // A link can put anything in a number's place; whatever the control cannot show is shown as it is.
    if ((c.kind === "slider" || c.kind === "stepper") && typeof value === "number") return <NumberControl control={c} value={value} onSet={onSet} />;
    if (c.kind === "curve" && Array.isArray(value) && value.every((v) => typeof v === "number")) return <CurveControl control={c} value={value as number[]} onSet={onSet} />;
    if (c.kind === "toggle" && typeof value === "boolean")
      return (
<input type="checkbox" role="switch" className="switch" checked={value} onChange={(e) => onSet(e.target.checked)} aria-label={c.name} data-testid={`input-${c.key}`} />
      );
    if (c.kind === "choice")
      return (
        <select value={String(value)} onChange={(e) => onSet(typeof c.shipped === "number" ? Number(e.target.value) : e.target.value)} data-testid={`input-${c.key}`}>
          {c.options.map((o) => (
            <option key={o} value={String(o)}>
              {o}
            </option>
          ))}
        </select>
      );
    if (c.kind === "text" && typeof value === "string") return <input type="text" className="mono" value={value} onChange={(e) => onSet(e.target.value)} data-testid={`input-${c.key}`} />;
    return <JsonControl testKey={c.key} value={value} onSet={onSet} />;
  })();
  return (
    <Row name={c.name} branch={c.branch} unit={c.unit} changed={changed} shipped={formatNumber(c.key, c.shipped)} description={c.description} refusals={refusals} locked={c.locked} block={!line} hints={hints} hidden={hidden} onReset={onReset} testKey={c.key}>
      {body}
    </Row>
  );
}

/** A number field that keeps what is typed until it is a number, and follows the draft when that changes under it. */
function NumberBox({ value, min, max, integer, onSet, testId, label }: { value: number; min: number | null; max: number | null; integer: boolean; onSet(v: number): void; testId?: string; label?: string }) {
  const [text, setText] = useState(String(value));
  const typed = useRef(value);
  useEffect(() => {
    if (typed.current !== value) setText(String(value));
    typed.current = value;
  }, [value]);
  return (
    <input
      type="number"
      className="tune-number mono"
      value={text}
      min={min ?? undefined}
      max={max ?? undefined}
      step={integer ? 1 : "any"}
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() === "" || !Number.isFinite(n)) return;
        typed.current = n;
        onSet(n);
      }}
      onBlur={() => setText(String(value))}
      data-testid={testId}
    />
  );
}

function NumberControl({ control: c, value, onSet }: { control: Control; value: number; onSet(v: number): void }) {
  const clamp = (n: number): number => Math.min(c.max ?? Infinity, Math.max(c.min ?? -Infinity, n));
  if (c.kind === "stepper") {
    return (
      <div className="tune-stepper">
        <button type="button" className="btn btn-mini btn-sq" onClick={() => onSet(clamp(value - 1))} disabled={c.min !== null && value <= c.min} aria-label={t("studio.less", { key: c.name })} data-testid={`less-${c.key}`}>
          −
        </button>
        <NumberBox value={value} min={c.min} max={c.max} integer={c.integer} onSet={onSet} testId={`input-${c.key}`} label={c.name} />
        <button type="button" className="btn btn-mini btn-sq" onClick={() => onSet(clamp(value + 1))} disabled={c.max !== null && value >= c.max} aria-label={t("studio.more", { key: c.name })} data-testid={`more-${c.key}`}>
          +
        </button>
      </div>
    );
  }
  const range = sliderRange(c, value);
  return (
    <div className="tune-slider">
      <input type="range" min={range.min} max={range.max} step={c.integer ? 1 : (range.max - range.min) / 200} value={value} onChange={(e) => onSet(Number(e.target.value))} aria-label={c.name} data-testid={`slider-${c.key}`} />
      <NumberBox value={value} min={c.min} max={c.max} integer={c.integer} onSet={onSet} testId={`input-${c.key}`} label={c.name} />
    </div>
  );
}

/**
 * A list of numbers as the curve it is, down the panel: an entry a row, with its place in the list,
 * a bar for its size and its own field. The buttons that grow and cut the list sit over it, so
 * they stay where they are however long it gets.
 */
function CurveControl({ control: c, value, onSet }: { control: Control; value: readonly number[]; onSet(v: number[]): void }) {
  const top = Math.max(1, ...value.map((v) => Math.abs(v)));
  const wide = useWidePanel();
  return (
    <div className={`tune-curve ${wide ? "is-wide" : ""}`} data-testid={`curve-${c.key}`}>
      <div className="curve-head">
        <span className="num-unit">{t("studio.curve_count", { count: value.length })}</span>
        <button type="button" className="btn btn-mini btn-sq" onClick={() => onSet(value.slice(0, -1))} disabled={value.length <= 1} aria-label={t("studio.curve_shorter", { key: c.name })} title={t("studio.curve_shorter", { key: c.name })} data-testid={`shorter-${c.key}`}>
          −
        </button>
        <button type="button" className="btn btn-mini btn-sq" onClick={() => onSet([...value, value[value.length - 1] ?? 0])} aria-label={t("studio.curve_longer", { key: c.name })} title={t("studio.curve_longer", { key: c.name })} data-testid={`longer-${c.key}`}>
          +
        </button>
      </div>
      {wide && <CurveChart name={c.name} value={value} shipped={Array.isArray(c.shipped) ? (c.shipped as number[]) : []} min={c.min} max={c.max} integer={c.integer} onSet={onSet} testId={`chart-${c.key}`} />}
      <ol className="curve-rows">
        {value.map((v, i) => (
          <li key={i}>
            <span className="curve-index mono">{i + 1}</span>
            <span className="curve-bar" aria-hidden="true">
              <i style={{ width: `${Math.max(2, (Math.abs(v) / top) * 100)}%` }} />
            </span>
            <NumberBox value={v} min={c.min} max={c.max} integer={c.integer} onSet={(n) => onSet(value.map((x, j) => (j === i ? n : x)))} testId={`input-${c.key}.${i}`} label={`${c.name} ${i + 1}`} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Whatever is neither a number, a list of them, a switch nor a choice: edited as the JSON the content file holds. */
function JsonControl({ testKey, value, onSet }: { testKey: string; value: unknown; onSet(v: unknown): void }) {
  const pretty = (v: unknown): string => JSON.stringify(v, null, 1) ?? "";
  const [text, setText] = useState(() => pretty(value));
  const [bad, setBad] = useState(false);
  const typed = useRef(value);
  useEffect(() => {
    if (!same(typed.current, value)) {
      setText(pretty(value));
      setBad(false);
    }
    typed.current = value;
  }, [value]);
  return (
    <>
      <textarea
        className="tune-json mono"
        rows={Math.min(10, text.split("\n").length + 1)}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const v: unknown = JSON.parse(e.target.value);
            typed.current = v;
            setBad(false);
            onSet(v);
          } catch {
            setBad(true);
          }
        }}
        data-testid={`input-${testKey}`}
      />
      {bad && <p className="tune-refusal">{t("studio.json_invalid")}</p>}
    </>
  );
}

/** The thresholds: the score each rating is reached at, one field a threshold, with the tier that rating falls in beside it. */
function ThresholdsControl({ shipped, value, refusals, hints, hidden, onSet, onReset }: { shipped: readonly Threshold[]; value: readonly Threshold[]; refusals: readonly Refusal[]; hints: boolean; hidden: boolean; onSet(v: unknown): void; onReset(): void }) {
  const rows = Array.isArray(value) && value.every((x) => x && typeof x.score === "number" && typeof x.rating === "number");
  const wide = useWidePanel();
  const { rounds } = useFrame();
  return (
    <Row name="thresholds" branch={null} unit="points" changed={!same(value, shipped)} shipped={formatNumber("thresholds", shipped)} description={t("studio.desc.thresholds")} refusals={refusals} block hints={hints} hidden={hidden} onReset={onReset} testKey="thresholds">
      {rows && wide && <RatingScale thresholds={value} shipped={shipped} rounds={rounds} />}
      {rows ? (
        <ol className="tune-thresholds">
          {value.map((th, i) => (
            <li key={i}>
              <span className="tune-rating">
                <b className="mono">{th.rating}</b> {t(`tier.${tierFor(th.rating, content.ratingTiers).key}`)}
              </span>
              <NumberBox value={th.score} min={0} max={null} integer onSet={(n) => onSet(value.map((x, j) => (j === i ? { ...x, score: n } : x)))} testId={`input-thresholds.${i}`} label={t("studio.threshold_score", { rating: th.rating })} />
            </li>
          ))}
        </ol>
      ) : (
        <JsonControl testKey="thresholds" value={value} onSet={onSet} />
      )}
    </Row>
  );
}
