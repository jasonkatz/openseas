import { useEffect, useState } from "react";
import { t } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { SPEEDS, shareLink, type Scenario } from "../scenario/codec.js";
import { findSeed } from "../review/replay.js";
import type { Validation } from "../scenario/validate.js";
import { ConfigEditor } from "./ConfigEditor.jsx";
import { copyText } from "./format.js";

export interface ScenarioPanelProps<S, M, C> {
  puzzle: HarnessPuzzle<S, M, C>;
  scenario: Scenario;
  labConfig: C;
  validation: Validation;
  /** True while a round runs: the form is read-only until it ends. */
  locked: boolean;
  onChange(next: Scenario): void;
  onStart(): void;
}

export function ScenarioPanel<S, M, C>({ puzzle, scenario, labConfig, validation, locked, onChange, onStart }: ScenarioPanelProps<S, M, C>) {
  const [probe, setProbe] = useState(0);
  const [found, setFound] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const presets = puzzle.presets;
  const applyPreset = (id: string): void => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    onChange({
      ...scenario,
      overrides: { ...scenario.overrides, ...p.overrides },
      roundSeconds: p.roundSeconds ?? scenario.roundSeconds,
      speed: p.speed ?? scenario.speed,
    });
  };
  const search = (): void => {
    const pr = puzzle.probes[probe];
    if (!pr || !validation.ok) return;
    setSearching(true);
    setFound(null);
    // Let the button repaint before a few thousand boards are generated.
    window.setTimeout(() => {
      const prefix = `${puzzle.id}-${pr.id}${pr.vars ? `-${Object.values(pr.vars).join("-")}` : ""}-${Math.random().toString(36).slice(2, 6)}`;
      const seed = findSeed(puzzle.def, labConfig, pr.test, prefix, 5000);
      setSearching(false);
      setFound(seed === null ? "" : seed);
      if (seed !== null) onChange({ ...scenario, seed });
    }, 0);
  };
  const copyLink = (): void => {
    void copyText(shareLink(window.location.origin, window.location.pathname, scenario)).then((ok) => setCopied(ok ? t("harness.copied") : t("harness.copy_failed")));
  };
  const presetName = (id: string): string =>
    id.startsWith("deck_") ? t("harness.preset.deck", { n: id.slice(5) }) : id.startsWith("board_") ? t("harness.preset.board", { n: id.slice(6) }) : t(`harness.preset.${id}`);

  const overrideCount = Object.keys(scenario.overrides).length;
  if (locked) {
    return (
      <section className="bench-section" data-testid="scenario">
        <h3>{t("harness.scenario")}</h3>
        <p className="muted small mono" data-testid="scenario-locked">
          {scenario.seed ? t("harness.lab_seed", { seed: scenario.seed }) : t("harness.lab_random_seed")} · {overrideCount ? t("harness.lab_overrides", { count: overrideCount }) : t("harness.lab_no_overrides")} ·{" "}
          {scenario.roundSeconds ?? puzzle.roundSeconds}s
        </p>
        <p className="muted small">{t("harness.scenario_locked")}</p>
      </section>
    );
  }

  return (
    <section className="bench-section" data-testid="scenario">
      <h3>{t("harness.scenario")}</h3>
      <p className="muted small">{t("harness.scenario_blurb")}</p>
      <fieldset className="bench-fields">
        <label className="bench-row">
          <span>{t("harness.seed")}</span>
          <span className="bench-inline">
            <input
              type="text"
              value={scenario.seed ?? ""}
              placeholder={t("harness.seed_placeholder")}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              data-testid="scenario-seed"
              onChange={(e) => onChange({ ...scenario, seed: e.target.value.trim() || null })}
            />
            <button type="button" className="btn btn-mini" onClick={() => onChange({ ...scenario, seed: `lab-${Math.random().toString(36).slice(2, 8)}` })}>
              {t("harness.seed_random")}
            </button>
          </span>
        </label>
        {puzzle.probes.length > 0 && (
          <div className="bench-row">
            <span>{t("harness.seed_find")}</span>
            <span className="bench-inline">
              <select value={probe} onChange={(e) => setProbe(Number(e.target.value))} data-testid="seed-probe">
                {puzzle.probes.map((p, i) => (
                  <option key={`${p.id}-${i}`} value={i}>
                    {t(`harness.probe.${puzzle.id}.${p.id}`, p.vars)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-mini" onClick={search} disabled={searching || !validation.ok} data-testid="seed-find">
                {searching ? t("harness.seed_searching") : t("harness.seed_find_button")}
              </button>
            </span>
            {found !== null && (
              <small className="muted" data-testid="seed-found">
                {found ? t("harness.seed_found", { seed: found }) : t("harness.seed_not_found", { tries: 5000 })}
              </small>
            )}
          </div>
        )}
        <label className="bench-row">
          <span>{t("harness.seconds")}</span>
          <input
            type="number"
            min={5}
            max={1800}
            value={scenario.roundSeconds ?? puzzle.roundSeconds}
            data-testid="scenario-seconds"
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange({ ...scenario, roundSeconds: Number.isInteger(n) && n > 0 && n !== puzzle.roundSeconds ? n : null });
            }}
          />
        </label>
        <label className="bench-row">
          <span>{t("harness.preset")}</span>
          <select value="" onChange={(e) => applyPreset(e.target.value)} data-testid="scenario-preset">
            <option value="">{t("harness.preset_none")}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {presetName(p.id)}
              </option>
            ))}
          </select>
        </label>
        <div className="bench-row bench-row-stack">
          <span className="bench-inline bench-inline-between">
            <span>{t("harness.config")}</span>
            <button type="button" className="btn btn-mini" onClick={() => onChange({ ...scenario, overrides: {} })} disabled={Object.keys(scenario.overrides).length === 0} data-testid="config-reset">
              {t("harness.config_reset")}
            </button>
          </span>
          <ConfigEditor puzzle={puzzle} overrides={scenario.overrides} onChange={(overrides) => onChange({ ...scenario, overrides })} disabled={false} />
          {!validation.ok && (
            <div className="error small" role="alert" data-testid="config-errors">
              <p>{t("harness.config_errors")}</p>
              <ul>
                {validation.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <label className="bench-row">
          <span>{t("harness.speed")}</span>
          <span className="bench-inline">
            <select value={scenario.speed} onChange={(e) => onChange({ ...scenario, speed: Number(e.target.value) })} data-testid="scenario-speed">
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {t("harness.speed_label", { rate: s })}
                </option>
              ))}
            </select>
            <label className="bench-check">
              <input type="checkbox" checked={scenario.paused} onChange={(e) => onChange({ ...scenario, paused: e.target.checked })} data-testid="scenario-paused" />
              <span>{t("harness.start_paused")}</span>
            </label>
          </span>
        </label>
        {puzzle.hints && (
          <label className="bench-row">
            <span>{t("harness.hints")}</span>
            <input type="checkbox" checked={scenario.hints} onChange={(e) => onChange({ ...scenario, hints: e.target.checked })} data-testid="scenario-hints" />
          </label>
        )}
      </fieldset>
      <div className="bench-actions">
        <button type="button" className="btn btn-lab" onClick={onStart} disabled={!validation.ok} data-testid="bench-start-lab">
          {t("harness.lab_start")}
        </button>
        <button type="button" className="btn btn-ghost btn-mini" onClick={copyLink} data-testid="scenario-link">
          {copied ?? t("harness.link_copy")}
        </button>
      </div>
    </section>
  );
}
