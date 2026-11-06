import { useEffect, useMemo, useRef, useState } from "react";
import { STATIONS, type Station } from "@openseas/engine";
import { content, t } from "@openseas/boards";
import { MAX_RUNS, resolveScenario, type VoyageScenario } from "./scenario.js";
import { batchStats, runBatch, type RunSummary } from "./batch.js";
import type { BatchReply, BatchRequest } from "./batch.worker.js";
import { Histogram, SegmentedBar } from "./Charts.jsx";
import { stationName } from "./names.js";

type BatchState = { status: "idle" } | { status: "running"; done: number; total: number } | { status: "done"; runs: readonly RunSummary[]; cancelled: boolean } | { status: "error"; message: string };

/** Sails batches in a worker, or on the page where workers are not to be had. */
function useBatch() {
  const [state, setState] = useState<BatchState>({ status: "idle" });
  const worker = useRef<Worker | null>(null);
  const abort = useRef<AbortController | null>(null);
  const partial = useRef<number>(0);

  const stop = (): void => {
    worker.current?.terminate();
    worker.current = null;
    abort.current?.abort();
    abort.current = null;
  };
  useEffect(() => stop, []);

  const start = (scenario: VoyageScenario, runs: number): void => {
    stop();
    partial.current = 0;
    setState({ status: "running", done: 0, total: runs });
    let w: Worker | null = null;
    try {
      w = new Worker(new URL("./batch.worker.ts", import.meta.url), { type: "module" });
    } catch {
      w = null;
    }
    if (w) {
      worker.current = w;
      w.onmessage = (e: MessageEvent<BatchReply>) => {
        const m = e.data;
        if (m.type === "progress") {
          partial.current = m.done;
          setState({ status: "running", done: m.done, total: runs });
        } else if (m.type === "done") {
          setState({ status: "done", runs: m.runs, cancelled: false });
          stop();
        } else {
          setState({ status: "error", message: m.message });
          stop();
        }
      };
      w.onerror = (e) => {
        setState({ status: "error", message: e.message });
        stop();
      };
      w.postMessage({ scenario, runs } satisfies BatchRequest);
      return;
    }
    const r = resolveScenario(content, scenario);
    if (!r.ok) {
      setState({ status: "error", message: r.errors.join("\n") });
      return;
    }
    const ctl = new AbortController();
    abort.current = ctl;
    void runBatch(r.setup, runs, (done) => setState({ status: "running", done, total: runs }), ctl.signal).then((out) => setState({ status: "done", runs: out, cancelled: ctl.signal.aborted }));
  };
  const cancel = (): void => {
    stop();
    setState({ status: "idle" });
  };
  return { state, start, cancel };
}

export interface BatchViewProps {
  scenario: VoyageScenario;
  valid: boolean;
  onRuns(n: number): void;
  /** Open one run of the batch as a single voyage. */
  onOpen(seed: string): void;
  stations: readonly Station[];
  /** Sail the batch as soon as the view opens (a link with `start=batch`). */
  autostart: boolean;
}

const fixed1 = (n: number | null): string => (n === null ? "–" : (Math.round(n * 10) / 10).toString());

export function BatchView({ scenario, valid, onRuns, onOpen, stations, autostart }: BatchViewProps) {
  const { state, start, cancel } = useBatch();
  const started = useRef(false);
  useEffect(() => {
    if (!autostart || started.current || !valid) return;
    started.current = true;
    start(scenario, scenario.runs);
    // Once, on the scenario the link opened with.
  }, []);
  const runs = state.status === "done" ? state.runs : null;
  const stats = useMemo(() => (runs ? batchStats(runs) : null), [runs]);
  const [sort, setSort] = useState<"seed" | "turns" | "booty">("seed");
  const sorted = useMemo(() => {
    if (!runs) return [];
    const out = [...runs];
    if (sort === "turns") out.sort((a, b) => b.turns - a.turns);
    if (sort === "booty") out.sort((a, b) => b.booty - a.booty);
    return out;
  }, [runs, sort]);

  return (
    <div className="vbatch" data-testid="voyage-batch">
      <div className="vcontrols">
        <label className="bench-inline small">
          <span className="muted">{t("harness.voyage.batch_runs")}</span>
          <input className="vnum" type="number" min={1} max={MAX_RUNS} value={scenario.runs} onChange={(e) => onRuns(Math.max(1, Math.min(MAX_RUNS, Math.round(Number(e.target.value) || 1))))} data-testid="voyage-batch-runs" />
        </label>
        {state.status === "running" ? (
          <button type="button" className="btn btn-ghost btn-mini" onClick={cancel} data-testid="voyage-batch-cancel">
            {t("harness.voyage.batch_cancel")}
          </button>
        ) : (
          <button type="button" className="btn btn-brass btn-mini" disabled={!valid} onClick={() => start(scenario, scenario.runs)} data-testid="voyage-batch-run">
            {t("harness.voyage.batch_run", { n: scenario.runs })}
          </button>
        )}
      </div>
      <p className="muted small">{t("harness.voyage.batch_blurb", { seed: scenario.seed })}</p>

      {state.status === "running" && (
        <div className="vprogress" data-testid="voyage-batch-progress">
          <span className="water-meter progress-meter" aria-label={`${state.done}/${state.total}`}>
            <i style={{ width: `${(state.done * 100) / state.total}%` }} />
          </span>
          <small className="muted">{t("harness.voyage.batch_progress", { done: state.done, total: state.total })}</small>
        </div>
      )}
      {state.status === "error" && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}

      {stats && runs && (
        <>
          <div className="vtiles" data-testid="voyage-batch-stats">
            <Tile label={t("harness.voyage.tile_arrived")} value={`${stats.arrived}/${stats.runs}`} note={stats.adrift + stats.abandoned > 0 ? t("harness.voyage.tile_arrived_note", { adrift: stats.adrift, abandoned: stats.abandoned }) : null} />
            <Tile label={t("harness.voyage.tile_turns")} value={stats.turns ? String(stats.turns.median) : "–"} note={stats.turns ? t("harness.voyage.tile_turns_note", { p90: stats.turns.p90, min: stats.turns.min, max: stats.turns.max }) : null} />
            <Tile label={t("harness.voyage.tile_hailed")} value={`${Math.round((stats.hailed * 100) / stats.runs)}%`} note={t("harness.voyage.tile_hailed_note", { engaged: stats.engaged })} />
            <Tile label={t("harness.voyage.tile_won")} value={stats.winRate === null ? "–" : `${Math.round(stats.winRate)}%`} note={stats.engaged ? t("harness.voyage.tile_won_note", { boardings: stats.boardings, engaged: stats.engaged }) : null} />
            <Tile label={t("harness.voyage.tile_booty")} value={String(Math.round(stats.meanBooty))} note={t("harness.voyage.tile_booty_note")} />
          </div>

          {stats.engaged > 0 && (
            <section className="vpanel">
              <h3>{t("harness.voyage.batch_outcomes")}</h3>
              <SegmentedBar
                label={t("harness.voyage.batch_outcomes")}
                parts={[
                  { id: "won", label: t("harness.voyage.part_won"), count: (stats.outcomes.boarded ?? 0) + (stats.outcomes.crippled ?? 0), icon: "✓" },
                  { id: "lost", label: t("harness.voyage.part_lost"), count: (stats.outcomes.boarded_by ?? 0) + (stats.outcomes.crippled_by ?? 0), icon: "✗" },
                  { id: "neither", label: t("harness.voyage.part_neither"), count: (stats.outcomes.broke_off ?? 0) + (stats.outcomes.disengaged ?? 0), icon: "–" },
                ]}
              />
              <dl className="bench-dl">
                {(Object.entries(stats.outcomes) as Array<[string, number]>).map(([o, n]) => (
                  <div key={o}>
                    <dt>{t(`battle.outcome.${o}`)}</dt>
                    <dd className="mono">{n}</dd>
                  </div>
                ))}
                <div>
                  <dt>{t("harness.voyage.batch_battle_turns")}</dt>
                  <dd className="mono">{fixed1(stats.meanBattleTurns)}</dd>
                </div>
                <div>
                  <dt>{t("harness.voyage.batch_hits")}</dt>
                  <dd className="mono">
                    {fixed1(stats.meanHits)} / {fixed1(stats.meanHitsTaken)}
                  </dd>
                </div>
                {Object.entries(stats.tiers).map(([tier, n]) => (
                  <div key={tier}>
                    <dt>{t("harness.voyage.batch_hailed_by", { tier: t(`brigand.${tier}`) })}</dt>
                    <dd className="mono">{n}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="vpanel">
            <h3>{t("harness.voyage.batch_turns")}</h3>
            <Histogram
              values={runs.filter((r) => r.phase === "arrived").map((r) => r.turns)}
              label={t("harness.voyage.batch_turns_hint")}
              unit={(lo, hi, count) => t("harness.voyage.batch_turns_bin", { lo, hi, count })}
            />
          </section>

          <section className="vpanel">
            <h3>{t("harness.voyage.batch_ship")}</h3>
            <dl className="bench-dl">
              <div>
                <dt>{t("harness.voyage.batch_speed")}</dt>
                <dd className="mono">{Math.round(stats.meanSpeed / 10)}%</dd>
              </div>
              <div>
                <dt>{t("harness.voyage.batch_peak_water")}</dt>
                <dd className="mono">{Math.round(stats.meanPeakWater / 10)}%</dd>
              </div>
              <div>
                <dt>{t("harness.voyage.batch_peak_damage")}</dt>
                <dd className="mono">{Math.round(stats.meanPeakDamage / 10)}%</dd>
              </div>
              {STATIONS.filter((s) => stations.includes(s)).map((s) => (
                <div key={s}>
                  <dt>{t("harness.voyage.batch_output", { station: stationName(s) })}</dt>
                  <dd className="mono">{stats.outputs[s]}%</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="vpanel">
            <div className="bench-inline bench-inline-between">
              <h3>{t("harness.voyage.batch_list")}</h3>
              <label className="bench-inline small">
                <span className="muted">{t("harness.voyage.batch_sort")}</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="seed">{t("harness.voyage.batch_sort_seed")}</option>
                  <option value="turns">{t("harness.voyage.batch_sort_turns")}</option>
                  <option value="booty">{t("harness.voyage.batch_sort_booty")}</option>
                </select>
              </label>
            </div>
            <div className="vtable-wrap">
              <table className="vtable" data-testid="voyage-batch-list">
                <thead>
                  <tr>
                    <th>{t("harness.seed")}</th>
                    <th>{t("harness.voyage.col_end")}</th>
                    <th>{t("harness.voyage.col_turns")}</th>
                    <th>{t("harness.voyage.col_brigand")}</th>
                    <th>{t("harness.voyage.col_booty")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.seed}>
                      <td className="mono small">{r.seed}</td>
                      <td>{t(`harness.voyage.phase_${r.phase}`)}</td>
                      <td className="mono">{r.turns}</td>
                      <td className="small">{r.hailedBy ? `${t(`brigand.${r.hailedBy}`)}${r.outcome ? ` · ${t(`harness.voyage.short_${r.outcome}`)}` : ""}` : "–"}</td>
                      <td className="mono">{r.booty}</td>
                      <td>
                        <button type="button" className="btn btn-ghost btn-mini" onClick={() => onOpen(r.seed)} title={t("harness.voyage.batch_open_hint")} data-testid="voyage-batch-open">
                          {t("harness.voyage.batch_open")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string | null }) {
  return (
    <div className="vtile">
      <span className="vtile-label">{label}</span>
      <span className="vtile-value">{value}</span>
      {note && <span className="vtile-note muted small">{note}</span>}
    </div>
  );
}
