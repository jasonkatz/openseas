import { useCallback, useEffect, useMemo, useState } from "react";
import { BATTLE_PERMILLE, battlePlanIllegalReason, type BattlePlan, type Station } from "@openseas/engine";
import { BattleBoard, t } from "@openseas/boards";
import type { CrewSpec, VoyageSetup } from "./scenario.js";
import { needsPlot, sailOn, startVoyage, step, type SimEntry, type TurnSample, type VoyageSim } from "./sim.js";
import { proveVoyage, voyageFile } from "./batch.js";
import { OutputHeatmap, PhaseLegend, TimelineCharts, type Measure } from "./Charts.jsx";
import { namer, stationName } from "./names.js";

const RATES = [1, 2, 4, 8] as const;
const pct = (permille: number): number => Math.round(permille / 10);
const noop = (): void => {};

export interface RunViewProps {
  setup: VoyageSetup;
  crew: readonly CrewSpec[];
  stations: readonly Station[];
  /** Sail to port as soon as the view opens (a link with `start=sail`, or a run opened from a batch). */
  autostart: boolean;
}

/** One voyage, turn by turn: the controls, the ship's state, the fight, the charts, the log and the replay proof. */
export function RunView({ setup, crew, stations, autostart }: RunViewProps) {
  const [sim, setSim] = useState<VoyageSim | null>(() => (autostart ? sailOn(startVoyage(setup), { stopForPlot: true }) : null));
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<(typeof RATES)[number]>(4);
  const [hover, setHover] = useState<number | null>(null);
  const [battleAt, setBattleAt] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const waiting = sim !== null && needsPlot(sim);
  const done = sim?.done ?? false;

  useEffect(() => {
    if (!playing) return;
    if (!sim || done || waiting) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setSim((s) => (s && !s.done && !needsPlot(s) ? step(s) : s)), 1000 / rate);
    return () => window.clearTimeout(id);
  }, [playing, sim, done, waiting, rate]);

  const begin = (): void => {
    setSim(startVoyage(setup));
    setBattleAt(null);
  };
  const playPause = (): void => {
    if (!sim) begin();
    setPlaying((p) => !p);
  };
  const next = (): void => setSim((s) => step(s ?? startVoyage(setup)));
  const toPort = (): void => {
    setPlaying(false);
    setSim((s) => sailOn(s ?? startVoyage(setup), { stopForPlot: setup.wheel === "you" }));
  };
  const onCommit = useCallback((plan: BattlePlan) => {
    setSim((s) => (s && needsPlot(s) && battlePlanIllegalReason(s.battle!, plan) === null ? step(s, { plan }) : s));
    setBattleAt(null);
  }, []);

  const name = useMemo(() => namer(crew, sim?.log ?? []), [crew, sim?.log]);
  const proof = useMemo(() => (sim?.done ? proveVoyage(sim) : null), [sim]);
  const ship = sim?.ship ?? null;
  const cfg = setup.ship;

  const measures: Measure[] = useMemo(() => {
    const percent = (v: number): string => `${Math.round(v)}%`;
    const maxTokens = Math.max(1, cfg.shipClass.baseTokens * 2 + cfg.rules.navTokens * 2);
    return [
      { id: "progress", label: t("harness.voyage.m_progress"), max: 100, value: (s) => s.progress / 10, format: percent },
      { id: "speed", label: t("harness.voyage.m_speed"), max: Math.ceil(cfg.rules.maxSpeed / 100) * 10, value: (s) => s.speed / 10, format: percent },
      { id: "water", label: t("harness.voyage.m_water"), max: 100, value: (s) => s.water / 10, format: percent },
      { id: "hull", label: t("harness.voyage.m_hull"), max: 100, value: (s) => (BATTLE_PERMILLE - s.damage) / 10, format: percent },
      { id: "loaded", label: t("harness.voyage.m_loaded"), max: Math.max(1, cfg.shipClass.cannons), value: (s) => s.loaded, format: (v) => String(v), step: true },
      { id: "tokens", label: t("harness.voyage.m_tokens"), max: maxTokens, value: (s) => s.tokens, format: (v) => String(v), step: true },
    ];
  }, [cfg]);

  const samples = sim?.samples ?? [];
  const shown: TurnSample | null = (hover !== null ? samples[hover] : samples[samples.length - 1]) ?? null;
  const battle = sim?.battles[sim.battles.length - 1] ?? null;
  // One stop per battle turn: the board as it stood after that turn, supplied for the next.
  const stops = useMemo(() => {
    if (!battle) return [];
    const last = new Map<number, number>();
    battle.states.forEach((s, i) => last.set(s.turn, i));
    return [...last.values()];
  }, [battle]);
  const stop = battleAt === null ? stops.length - 1 : Math.min(battleAt, stops.length - 1);
  const battleState = battle ? battle.states[stops[stop] ?? battle.states.length - 1]! : null;
  const melee = sim?.melees[sim.melees.length - 1] ?? null;
  const copy = (text: string, what: string): void => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(what),
      () => setCopied(null),
    );
  };

  return (
    <div className="vrun" data-testid="voyage-run">
      <div className="vcontrols">
        <button type="button" className="btn btn-brass btn-mini" onClick={begin} data-testid="voyage-sail">
          {sim ? t("harness.voyage.sail_again") : t("harness.voyage.sail")}
        </button>
        <button type="button" className="btn btn-ghost btn-mini" onClick={next} disabled={done || waiting} data-testid="voyage-step">
          {t("harness.voyage.step")}
        </button>
        <button type="button" className="btn btn-ghost btn-mini" onClick={playPause} disabled={done || waiting} data-testid="voyage-play">
          {playing ? t("harness.voyage.pause") : t("harness.voyage.play")}
        </button>
        <label className="bench-inline small">
          <span className="muted">{t("harness.voyage.rate")}</span>
          <select value={rate} onChange={(e) => setRate(Number(e.target.value) as (typeof RATES)[number])}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {t("harness.voyage.rate_option", { n: r })}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-mini" onClick={toPort} disabled={done || waiting} data-testid="voyage-to-port">
          {t("harness.voyage.to_port")}
        </button>
      </div>

      {!sim && <p className="muted vempty">{t("harness.voyage.empty")}</p>}

      {sim && ship && (
        <>
          <dl className="vstatus" data-testid="voyage-status">
            <div>
              <dt>{t("harness.voyage.s_phase")}</dt>
              <dd>
                <span className={`vchip vchip-${sim.phase}`} data-testid="voyage-phase" data-phase={sim.phase}>
                  {t(`harness.voyage.phase_${sim.phase}`)}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t("harness.voyage.s_turn")}</dt>
              <dd className="mono" data-testid="voyage-turn">
                {samples.length}
              </dd>
            </div>
            <div className="vstatus-wide">
              <dt>{t("harness.voyage.route_option_short", { from: t(`island.${setup.leg.from}`), to: t(`island.${setup.leg.to}`) })}</dt>
              <dd>
                <span className="water-meter progress-meter" aria-label={`${pct(shown?.progress ?? 0)}%`}>
                  <i style={{ width: `${pct(shown?.progress ?? 0)}%` }} />
                </span>
              </dd>
            </div>
            <div>
              <dt>{t("harness.voyage.s_hull")}</dt>
              <dd className="mono">{pct(BATTLE_PERMILLE - ship.damage)}%</dd>
            </div>
            <div>
              <dt>{t("harness.voyage.s_bilge")}</dt>
              <dd className="mono">{pct(ship.water)}%</dd>
            </div>
            <div>
              <dt>{t("harness.voyage.s_cannons")}</dt>
              <dd className="mono">
                {ship.loaded}/{cfg.shipClass.cannons}
              </dd>
            </div>
            <div>
              <dt>{t("harness.voyage.s_crew")}</dt>
              <dd className="small">{t("harness.voyage.s_crew_value", { pirates: ship.crew.filter((c) => !c.mate).length, hands: ship.crew.filter((c) => c.mate).length })}</dd>
            </div>
          </dl>

          {sim.done && <VoyageSummary sim={sim} name={name} />}

          {battle && battleState && (
            <section className="vpanel" data-testid="voyage-battle">
              <div className="bench-inline bench-inline-between">
                <h3>{t("harness.voyage.battle_title", { tier: t(`brigand.${battle.tierId}`) })}</h3>
                {battle.outcome && <span className="vchip">{t(`battle.outcome.${battle.outcome}`)}</span>}
              </div>
              {waiting && battleAt === null && (
                <div className="vplot" role="status" data-testid="voyage-your-plot">
                  <p>{t("harness.voyage.your_plot")}</p>
                  <button type="button" className="btn btn-ghost btn-mini" onClick={() => setSim((s) => (s ? step(s) : s))} data-testid="voyage-ai-plot">
                    {t("harness.voyage.ai_plot")}
                  </button>
                </div>
              )}
              <div className="vboard">
                <BattleBoard
                  key={`${sim.battles.length}`}
                  state={battleState}
                  interactive={waiting && battleAt === null}
                  showMarks={false}
                  showArcs
                  turnLeftMs={null}
                  turnMs={cfg.rules.turnSeconds * 1000}
                  commitSignal={0}
                  brigandName={t(`brigand.${battle.tierId}`)}
                  onCommit={onCommit}
                  onFrame={noop}
                  onEvents={noop}
                  onNudge={noop}
                />
              </div>
              {stops.length > 1 && (
                <label className="bench-inline small vscrub">
                  <span className="muted">{t("harness.voyage.battle_scrub", { n: battleState.turn, max: battleState.config.maxTurns })}</span>
                  <input
                    type="range"
                    min={0}
                    max={stops.length - 1}
                    value={stop}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBattleAt(v === stops.length - 1 ? null : v);
                    }}
                    data-testid="voyage-battle-scrub"
                    aria-label={t("harness.voyage.battle_scrub_label")}
                  />
                </label>
              )}
              <dl className="bench-dl">
                <div>
                  <dt>{t("battle.your_hull")}</dt>
                  <dd className="mono">{pct(BATTLE_PERMILLE - battleState.ships[0].damage)}%</dd>
                </div>
                <div>
                  <dt>{t("battle.their_hull")}</dt>
                  <dd className="mono">{pct(BATTLE_PERMILLE - battleState.ships[1].damage)}%</dd>
                </div>
                <div>
                  <dt>{t("battle.result_hits")}</dt>
                  <dd className="mono">{battleState.hits}</dd>
                </div>
                <div>
                  <dt>{t("battle.result_hits_taken")}</dt>
                  <dd className="mono">{battleState.hitsTaken}</dd>
                </div>
                <div>
                  <dt>{t("harness.voyage.battle_plotted")}</dt>
                  <dd className="small">{t("harness.voyage.battle_plotted_value", { ai: battle.plotters.filter((p) => p === "ai").length, you: battle.plotters.filter((p) => p === "you").length })}</dd>
                </div>
              </dl>
            </section>
          )}

          {melee && <MeleePanel melee={melee} name={name} />}

          <section className="vpanel">
            <div className="bench-inline bench-inline-between">
              <h3>{t("harness.voyage.charts_title")}</h3>
              <PhaseLegend />
            </div>
            {shown && <Readout sample={shown} stations={stations} cannons={cfg.shipClass.cannons} />}
            <TimelineCharts samples={samples} measures={measures} hover={hover} onHover={setHover} />
            <h4 className="vsub">{t("harness.voyage.chart_outputs")}</h4>
            <OutputHeatmap samples={samples} stations={stations} hover={hover} onHover={setHover} />
          </section>

          <section className="vpanel">
            <h3>{t("harness.voyage.log_title")}</h3>
            <ol className="vlog" data-testid="voyage-log">
              {sim.log.map((e, i) => (
                <li key={i} data-kind={e.kind}>
                  <span className="mono muted">{t("harness.voyage.log_turn", { n: e.turn })}</span> {logLine(e, name)}
                </li>
              ))}
            </ol>
          </section>

          {proof && (
            <section className="vpanel" data-testid="voyage-proof">
              <h3>{t("harness.voyage.proof_title")}</h3>
              <p className={proof.ok ? "ok" : "error"} data-testid="voyage-proof-result" data-ok={proof.ok ? "1" : "0"}>
                {proof.ok ? t("harness.voyage.proof_ok", { moves: proof.moves }) : t("harness.voyage.proof_bad", { log: proof.mismatch!.log, move: proof.mismatch!.move })}
              </p>
              <div className="bench-actions">
                <button type="button" className="btn btn-ghost btn-mini" onClick={() => copy(voyageFile(sim), "file")}>
                  {t("harness.voyage.copy_file")}
                </button>
                {copied === "file" && <span className="small ok">{t("harness.voyage.copied")}</span>}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Readout({ sample, stations, cannons }: { sample: TurnSample; stations: readonly Station[]; cannons: number }) {
  return (
    <p className="vreadout small" aria-live="polite" data-testid="voyage-readout">
      <b>{t("harness.voyage.log_turn", { n: sample.turn })}</b> · {sample.held ? t("harness.voyage.band_held") : t(`harness.voyage.phase_${sample.phase}`)} ·{" "}
      {t("harness.voyage.readout", {
        progress: pct(sample.progress),
        speed: pct(sample.speed),
        water: pct(sample.water),
        hull: pct(BATTLE_PERMILLE - sample.damage),
        loaded: sample.loaded,
        cannons,
        tokens: sample.tokens,
      })}
      <br />
      {stations.map((s) => `${stationName(s)} ${sample.outputs[s]}%`).join(" · ")}
    </p>
  );
}

function VoyageSummary({ sim, name }: { sim: VoyageSim; name(id: string): string }) {
  const turns = sim.samples.length;
  const seconds = turns * sim.setup.ship.rules.turnSeconds;
  const paid = Object.entries(sim.booty).filter(([, c]) => c > 0);
  return (
    <section className="vpanel vsummary" data-testid="voyage-summary">
      <h3>{t(`harness.voyage.end_${sim.phase}`, { turns, minutes: Math.floor(seconds / 60), seconds: seconds % 60, island: t(`island.${sim.setup.leg.to}`) })}</h3>
      {paid.length > 0 ? (
        <p className="small">{t("harness.voyage.booty_paid", { shares: paid.map(([id, c]) => `${name(id)} ${c}`).join(", ") })}</p>
      ) : (
        <p className="small muted">{t("harness.voyage.booty_none")}</p>
      )}
    </section>
  );
}

function MeleePanel({ melee, name }: { melee: NonNullable<VoyageSim["melees"][number]>; name(id: string): string }) {
  const s = melee.last;
  const crewBoards = s.boards.filter((b) => b.side === 0);
  const theirs = s.boards.filter((b) => b.side === 1);
  return (
    <section className="vpanel" data-testid="voyage-melee">
      <div className="bench-inline bench-inline-between">
        <h3>{t(melee.boarding === "boarded" ? "harness.voyage.melee_title_ours" : "harness.voyage.melee_title_theirs", { tier: t(`brigand.${melee.tierId}`) })}</h3>
        {melee.outcome && <span className="vchip">{t(`harness.voyage.melee_${melee.outcome}`)}</span>}
      </div>
      <p className="muted small">{t("harness.voyage.melee_blurb", { tick: s.tick, max: s.config.maxTick })}</p>
      <table className="vtable">
        <thead>
          <tr>
            <th>{t("harness.voyage.melee_board")}</th>
            <th>{t("harness.voyage.melee_points")}</th>
            <th>{t("harness.voyage.melee_sent")}</th>
            <th>{t("harness.voyage.melee_standing")}</th>
          </tr>
        </thead>
        <tbody>
          {crewBoards.map((b, i) => (
            <tr key={`c${i}`}>
              <td>{name(melee.fighters[i] ?? "")}</td>
              <td className="mono">{b.points}</td>
              <td className="mono">{b.sent}</td>
              <td>{b.out ? t("harness.voyage.melee_out") : t("harness.voyage.melee_up")}</td>
            </tr>
          ))}
          {theirs.map((b, i) => (
            <tr key={`b${i}`} className="vtable-foe">
              <td>{t("harness.voyage.melee_brigand_n", { n: i + 1 })}</td>
              <td className="mono">{b.points}</td>
              <td className="mono">{b.sent}</td>
              <td>{b.out ? t("harness.voyage.melee_out") : t("harness.voyage.melee_up")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** A log line in words: ids become names, ids of things become their names in the message table. */
function logLine(e: SimEntry, name: (id: string) => string): string {
  const v: Record<string, string | number> = { ...e.vars };
  if (typeof v.who === "string") v.who = name(v.who);
  if ("station" in v) v.station = stationName(String(v.station));
  if (typeof v.tier === "string") v.tier = t(`brigand.${v.tier}`);
  if (typeof v.island === "string") v.island = t(`island.${v.island}`);
  if (typeof v.action === "string") v.action = t(`harness.voyage.script_${v.action}`);
  if (typeof v.plotter === "string") v.plotter = t(`harness.voyage.plotter_${v.plotter}`);
  if (typeof v.outcome === "string") v.outcome = e.kind === "melee_ended" ? t(`harness.voyage.melee_${v.outcome}`) : t(`battle.outcome.${v.outcome}`);
  if (typeof v.hull === "number") v.hull = pct(BATTLE_PERMILLE - v.hull);
  if (typeof v.theirs === "number") v.theirs = pct(BATTLE_PERMILLE - v.theirs);
  // A station event without a station is standing down; a hand hired without one waits on deck.
  const kind = e.vars.station === "" ? (e.kind === "station" ? "station_none" : e.kind === "hired" ? "hired_deck" : e.kind) : e.kind;
  return t(`harness.voyage.log.${kind}`, v);
}
