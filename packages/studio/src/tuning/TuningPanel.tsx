import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { tierFor } from "@openseas/engine";
import { PuzzleNumbersSchema } from "@openseas/content";
import { content, t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { formatNumber, withoutNumbers, type Refusal, type Threshold } from "../frame/numbers.js";
import { localSeed, type PracticePhase } from "../practice/usePractice.js";
import { playLink } from "../scenario/codec.js";
import type { Preset } from "../scenario/presets.js";
import { DraftSection } from "../service/DraftSection.jsx";
import { TesterLinks } from "../service/TesterLinks.jsx";
import { readRestart, writeRestart } from "../studio/useStudio.js";
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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const presetName = (id: string): string =>
  id.startsWith("deck_") ? t("harness.preset.deck", { n: id.slice(5) }) : id.startsWith("board_") ? t("harness.preset.board", { n: id.slice(6) }) : t(`harness.preset.${id}`);

/**
 * The tuning panel (DESIGN.md 3.14): the seed, then a control for every key under `config`, for
 * the round's length, the live tier's window and each threshold. It is built from the puzzle's
 * content file and bounded by its wire schema (tuning/controls), and it only ever writes the
 * frame's draft: what the draft means for the round on the board is the page's business
 * (studio/useStudio).
 */
export function TuningPanel({ phase, onStart }: { phase: PracticePhase; onStart(seed?: string): void }) {
  const frame = useFrame();
  const { puzzle, scenario, setScenario, shipped, tuned, refusals, changes, report } = frame;
  const [restart, setRestart] = useState(readRestart);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const groups = useMemo(() => configControls(puzzle, TUNING_GROUPS[puzzle.id]), [puzzle]);
  const round = useMemo(() => roundControls(shipped, ROUND_BOUNDS), [shipped]);
  const known = useMemo(() => [...groups.flatMap((g) => g.controls.map((c) => c.key)), "roundSeconds", "paceSeconds", "thresholds"], [groups]);
  const owns = (key: string, r: Refusal): boolean => r.key === key || r.key.startsWith(`${key}.`);
  // A refusal no control can claim (the engine's own check names no key) is shown above them all.
  const loose = refusals.filter((r) => !known.some((k) => owns(k, r)));

  const seed = report.seed ?? scenario.seed;
  const pinned = scenario.seed !== null;
  const presets = puzzle.presets.filter((p: Preset) => Object.keys(p.overrides).length > 0 || p.roundSeconds !== undefined);
  const applyPreset = (id: string): void => {
    const p = presets.find((x) => x.id === id);
    if (p) setScenario({ ...withoutNumbers(scenario), overrides: p.overrides, roundSeconds: p.roundSeconds ?? null });
  };
  const hold = (on: boolean) => (): void => frame.setComparing(on);

  const row = (c: Control, value: unknown): ReactNode => (
    <ControlRow key={c.key} control={c} value={value} refusals={refusals.filter((r) => owns(c.key, r))} onSet={(v) => frame.setNumber(c.key, v)} onReset={() => frame.resetNumber(c.key)} />
  );

  return (
    <div className="tune" data-testid="tuning">
      <section className="tune-seed">
        <label className="tune-field">
          <span className="stat-label">{t("studio.seed")}</span>
          <input
            type="text"
            className="mono"
            value={scenario.seed ?? ""}
            placeholder={seed && !pinned ? seed : t("studio.seed_fresh")}
            onChange={(e) => setScenario({ ...scenario, seed: e.target.value.trim() || null })}
            spellCheck={false}
            autoCapitalize="none"
            data-testid="seed-input"
          />
        </label>
        <div className="tune-actions">
          <button type="button" className="btn btn-mini" aria-pressed={pinned} disabled={!pinned && !seed} onClick={() => setScenario({ ...scenario, seed: pinned ? null : seed })} data-testid="seed-pin">
            {pinned ? t("studio.seed_unpin") : t("studio.seed_pin")}
          </button>
          <button type="button" className="btn btn-mini" disabled={!seed || refusals.length > 0} onClick={() => onStart(seed ?? undefined)} data-testid="seed-replay">
            {t("studio.seed_replay")}
          </button>
          <button
            type="button"
            className="btn btn-mini"
            disabled={refusals.length > 0}
            onClick={() => {
              const next = localSeed();
              if (pinned) setScenario({ ...scenario, seed: next });
              onStart(next);
            }}
            data-testid="seed-new"
          >
            {t("studio.seed_new")}
          </button>
        </div>
      </section>

      <section className="tune-draft">
        <div className="tune-actions">
          <button
            type="button"
            className={`btn btn-mini ${frame.comparing ? "is-held" : ""}`}
            disabled={changes.length === 0 || phase === "idle"}
            onPointerDown={hold(true)}
            onPointerUp={hold(false)}
            onPointerLeave={hold(false)}
            onPointerCancel={hold(false)}
            onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && frame.setComparing(true)}
            onKeyUp={hold(false)}
            onBlur={hold(false)}
            aria-pressed={frame.comparing}
            title={t("studio.compare_hint")}
            data-testid="compare"
          >
            {t("studio.compare")}
          </button>
          <button type="button" className="btn btn-mini" disabled={changes.length === 0 && refusals.length === 0} onClick={frame.resetNumbers} data-testid="reset-all">
            {t("studio.reset_all")}
          </button>
          <button
            type="button"
            className="btn btn-mini"
            disabled={refusals.length > 0}
            onClick={() => void copyText(playLink(window.location.origin, puzzle.id, scenario)).then((ok) => setCopied(ok ? t("studio.copied") : t("studio.copy_failed")))}
            data-testid="copy-play-link"
          >
            {copied ?? t("studio.copy_play_link")}
          </button>
        </div>
        <p className="muted small" data-testid="changed-count">
          {refusals.length > 0 ? t("studio.refused_note") : changes.length === 0 ? t("studio.changed_none") : t("studio.changed_count", { count: changes.length })}
        </p>
        <label className="tune-check">
          <input
            type="checkbox"
            checked={restart}
            onChange={(e) => {
              setRestart(e.target.checked);
              writeRestart(e.target.checked);
            }}
            data-testid="restart-on-change"
          />
          <span>{t("studio.restart_on_change")}</span>
        </label>
        {presets.length > 0 && (
          <label className="tune-field">
            <span className="stat-label">{t("studio.start_from")}</span>
            <select
              value=""
              onChange={(e) => {
                applyPreset(e.target.value);
                e.target.value = "";
              }}
              data-testid="start-from"
            >
              <option value="">{t("studio.start_from_pick")}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {presetName(p.id)}
                </option>
              ))}
            </select>
          </label>
        )}
        {loose.length > 0 && (
          <ul className="tune-refusals" role="alert" data-testid="refusals">
            {loose.map((r, i) => (
              <li key={i}>
                <code>{r.key}</code> {r.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <DraftSection />
      <TesterLinks />

      {groups.map((g) => (
        <details key={g.id} className="tune-group" open data-testid={`group-${g.id}`}>
          <summary>{t(`studio.group.${g.id}`)}</summary>
          {g.controls.map((c) => row(c, valueAt(tuned.config, c.key)))}
        </details>
      ))}
      <details className="tune-group" open data-testid="group-rating">
        <summary>{t("studio.group.rating")}</summary>
        {round.map((c) => row({ ...c, description: t(c.key === "roundSeconds" ? "studio.desc.round_seconds" : "studio.desc.pace_seconds") }, tuned[c.key as "roundSeconds" | "paceSeconds"]))}
        <ThresholdsControl
          shipped={shipped.thresholds}
          value={tuned.thresholds}
          refusals={refusals.filter((r) => owns("thresholds", r))}
          onSet={(v) => frame.setNumber("thresholds", v)}
          onReset={() => frame.resetNumber("thresholds")}
        />
      </details>
    </div>
  );
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The frame every control sits in: its key as the content file spells it, a dot that puts it back, its line, and why it is refused. */
function Row({ name, branch, unit, changed, shipped, description, refusals, locked, onReset, children, testKey }: {
  name: string;
  branch: string | null;
  unit: string | null;
  changed: boolean;
  shipped: string;
  description: string | null;
  refusals: readonly Refusal[];
  locked?: boolean;
  onReset(): void;
  children: ReactNode;
  testKey: string;
}) {
  return (
    <div className={`tune-row ${changed ? "is-changed" : ""} ${refusals.length ? "is-refused" : ""}`} data-testid={`control-${testKey}`} data-changed={changed ? "1" : "0"}>
      <div className="tune-head">
        <code className="tune-key">
          {branch && <span className="tune-branch">{branch}.</span>}
          {name}
        </code>
        {unit && <span className="tune-unit">{t(`studio.unit.${unit}`)}</span>}
        {locked && <span className="tune-unit">{t("studio.locked")}</span>}
        {changed && (
          <button type="button" className="tune-dot" onClick={onReset} aria-label={t("studio.reset_one", { key: name, value: shipped })} title={t("studio.reset_one", { key: name, value: shipped })} data-testid={`reset-${testKey}`} />
        )}
      </div>
      {description && <p className="tune-desc">{description}</p>}
      {children}
      {refusals.map((r, i) => (
        <p key={i} className="tune-refusal" role="alert" data-testid={`refusal-${testKey}`}>
          {r.message}
        </p>
      ))}
    </div>
  );
}

function ControlRow({ control: c, value, refusals, onSet, onReset }: { control: Control; value: unknown; refusals: readonly Refusal[]; onSet(v: unknown): void; onReset(): void }) {
  const changed = !same(value, c.shipped);
  const body = ((): ReactNode => {
    if (c.locked) return <output className="tune-value mono">{formatNumber(c.key, value)}</output>;
    // A link can put anything in a number's place; whatever the control cannot show is shown as it is.
    if ((c.kind === "slider" || c.kind === "stepper") && typeof value === "number") return <NumberControl control={c} value={value} onSet={onSet} />;
    if (c.kind === "curve" && Array.isArray(value) && value.every((v) => typeof v === "number")) return <CurveControl control={c} value={value as number[]} onSet={onSet} />;
    if (c.kind === "toggle" && typeof value === "boolean")
      return (
        <label className="tune-check">
          <input type="checkbox" checked={value} onChange={(e) => onSet(e.target.checked)} data-testid={`input-${c.key}`} />
          <span className="mono">{String(value)}</span>
        </label>
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
    <Row name={c.name} branch={c.branch} unit={c.unit} changed={changed} shipped={formatNumber(c.key, c.shipped)} description={c.description} refusals={refusals} locked={c.locked} onReset={onReset} testKey={c.key}>
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
        <button type="button" className="btn btn-mini" onClick={() => onSet(clamp(value - 1))} disabled={c.min !== null && value <= c.min} aria-label={t("studio.less", { key: c.name })} data-testid={`less-${c.key}`}>
          −
        </button>
        <NumberBox value={value} min={c.min} max={c.max} integer={c.integer} onSet={onSet} testId={`input-${c.key}`} label={c.name} />
        <button type="button" className="btn btn-mini" onClick={() => onSet(clamp(value + 1))} disabled={c.max !== null && value >= c.max} aria-label={t("studio.more", { key: c.name })} data-testid={`more-${c.key}`}>
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

/** A list of numbers as the curve it is: a bar an entry, each with its own field, and the end of the list to grow or cut. */
function CurveControl({ control: c, value, onSet }: { control: Control; value: readonly number[]; onSet(v: number[]): void }) {
  const top = Math.max(1, ...value.map((v) => Math.abs(v)));
  return (
    <div className="tune-curve" data-testid={`curve-${c.key}`}>
      <div className="tune-bars" aria-hidden="true">
        {value.map((v, i) => (
          <i key={i} style={{ height: `${Math.max(4, (Math.abs(v) / top) * 100)}%` }} />
        ))}
      </div>
      <div className="tune-cells">
        {value.map((v, i) => (
          <NumberBox key={i} value={v} min={c.min} max={c.max} integer={c.integer} onSet={(n) => onSet(value.map((x, j) => (j === i ? n : x)))} testId={`input-${c.key}.${i}`} label={`${c.name} ${i + 1}`} />
        ))}
        <button type="button" className="btn btn-mini" onClick={() => onSet(value.slice(0, -1))} disabled={value.length <= 1} aria-label={t("studio.curve_shorter", { key: c.name })} data-testid={`shorter-${c.key}`}>
          −
        </button>
        <button type="button" className="btn btn-mini" onClick={() => onSet([...value, value[value.length - 1] ?? 0])} aria-label={t("studio.curve_longer", { key: c.name })} data-testid={`longer-${c.key}`}>
          +
        </button>
      </div>
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
function ThresholdsControl({ shipped, value, refusals, onSet, onReset }: { shipped: readonly Threshold[]; value: readonly Threshold[]; refusals: readonly Refusal[]; onSet(v: unknown): void; onReset(): void }) {
  const rows = Array.isArray(value) && value.every((x) => x && typeof x.score === "number" && typeof x.rating === "number");
  return (
    <Row name="thresholds" branch={null} unit="points" changed={!same(value, shipped)} shipped={formatNumber("thresholds", shipped)} description={t("studio.desc.thresholds")} refusals={refusals} onReset={onReset} testKey="thresholds">
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
