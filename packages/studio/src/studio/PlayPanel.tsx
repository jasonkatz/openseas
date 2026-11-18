import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { puzzleStages, withoutNumbers } from "../frame/numbers.js";
import { localSeed, type PracticePhase } from "../practice/usePractice.js";
import type { Preset } from "../scenario/presets.js";

const presetName = (id: string): string =>
  id.startsWith("deck_") ? t("studio.preset.deck", { n: id.slice(5) }) : id.startsWith("board_") ? t("studio.preset.board", { n: id.slice(6) }) : t(`studio.preset.${id}`);

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;

/**
 * The Play panel (DESIGN.md 3.14, ADR 0056): everything about the round on the board and nothing
 * about the puzzle's numbers. A starting point to play from, the seed, the round dealt again, the
 * shipped numbers held against the draft's on the same seed, and the last few rounds finished on
 * this page, so a change can be judged against the round before it.
 */
export function PlayPanel({ phase, onStart }: { phase: PracticePhase; onStart(seed?: string): void }) {
  const frame = useFrame();
  const { puzzle, scenario, setScenario, refusals, changes, report, rounds } = frame;
  const seed = report.seed ?? scenario.seed;
  const pinned = scenario.seed !== null;
  const presets = puzzle.presets.filter((p: Preset) => Object.keys(p.overrides).length > 0 || p.roundSeconds !== undefined);
  const applyPreset = (id: string): void => {
    const p = presets.find((x) => x.id === id);
    if (p) setScenario({ ...withoutNumbers(scenario), overrides: p.overrides, roundSeconds: p.roundSeconds ?? null });
  };
  const hold = (on: boolean) => (): void => frame.setComparing(on);
  const stages = puzzleStages(puzzle);

  return (
    <div className="tune" data-testid="play-panel">
      {stages.length > 0 && (
        <section className="panel-sec">
          <h3 className="panel-cap">{t("studio.stage")}</h3>
          <select value={scenario.stage ?? "full"} aria-label={t("studio.stage")} onChange={(e) => setScenario({ ...scenario, stage: e.target.value === "full" ? null : e.target.value })} data-testid="stage-pick">
            {[...stages.map((s) => s.id), "full"].map((id, i) => (
              <option key={id} value={id}>
                {`${i + 1}. ${t(`${puzzle.id}.stage.${id}`)}`}
              </option>
            ))}
          </select>
          <p className="panel-note">{t("studio.stage_note")}</p>
        </section>
      )}
      {presets.length > 0 && (
        <section className="panel-sec">
          <h3 className="panel-cap">{t("studio.start_from")}</h3>
          <select
            value=""
            aria-label={t("studio.start_from")}
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
        </section>
      )}

      <section className="panel-sec">
        <h3 className="panel-cap">{t("studio.seed")}</h3>
        <div className="tune-link-form">
          <input
            type="text"
            className="mono"
            value={scenario.seed ?? ""}
            placeholder={seed && !pinned ? seed : t("studio.seed_fresh")}
            onChange={(e) => setScenario({ ...scenario, seed: e.target.value.trim() || null })}
            spellCheck={false}
            autoCapitalize="none"
            aria-label={t("studio.seed")}
            data-testid="seed-input"
          />
          <button type="button" className="btn btn-mini" aria-pressed={pinned} disabled={!pinned && !seed} onClick={() => setScenario({ ...scenario, seed: pinned ? null : seed })} data-testid="seed-pin">
            {pinned ? t("studio.seed_unpin") : t("studio.seed_pin")}
          </button>
        </div>
        <p className="panel-note">{pinned ? t("studio.seed_pinned_note") : t("studio.seed_fresh_note")}</p>
      </section>

      <section className="panel-sec">
        <h3 className="panel-cap">{t("studio.round")}</h3>
        <div className="tune-actions">
          <button type="button" className="btn btn-mini btn-brass" disabled={!seed || refusals.length > 0} onClick={() => onStart(seed ?? undefined)} data-testid="seed-replay">
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

      <section className="panel-sec">
        <h3 className="panel-cap">{t("studio.compare_title")}</h3>
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
            data-testid="compare"
          >
            {t("studio.compare")}
          </button>
        </div>
        <p className="panel-note">{t("studio.compare_hint")}</p>
      </section>

      <section className="panel-sec" data-testid="last-rounds">
        <h3 className="panel-cap">{t("studio.rounds")}</h3>
        {rounds.length === 0 ? (
          <p className="panel-note">{t("studio.rounds_none")}</p>
        ) : (
          <ol className="rounds">
            {[...rounds].reverse().map((r, i) => (
              <li key={rounds.length - i} data-testid="last-round" data-tuned={r.tuned ? "1" : "0"}>
                <code className="mono rounds-seed" title={r.seed}>
                  {r.seed}
                </code>
                <span className="muted">{r.tuned ? t("studio.rounds_draft") : t("studio.rounds_shipped")}</span>
                <span className="muted mono">{clock(r.seconds)}</span>
                <span className="muted">{r.tier ? t(`tier.${r.tier}`) : ""}</span>
                <b className="mono">{r.score}</b>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
