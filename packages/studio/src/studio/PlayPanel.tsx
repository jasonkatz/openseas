import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { puzzleStages, withoutNumbers } from "../frame/numbers.js";
import { RoundList } from "./RoundList.jsx";
import type { Preset } from "../scenario/presets.js";

const presetName = (id: string): string =>
  id.startsWith("deck_") ? t("studio.preset.deck", { n: id.slice(5) }) : id.startsWith("board_") ? t("studio.preset.board", { n: id.slice(6) }) : t(`studio.preset.${id}`);

/**
 * The Play panel (DESIGN.md 3.14, ADR 0056, ADR 0067): what the next round is dealt on, and the
 * rounds finished on this page. A stage and a starting point to play from and the seed above; the
 * rounds below, each with the numbers it was dealt on, so a change can be judged against the round
 * before it or against one picked out. Dealing again and holding up the shipped numbers are on the
 * transport bar under the board, where every mode reaches them.
 */
export function PlayPanel({ onStart }: { onStart(seed?: string): void }) {
  const frame = useFrame();
  const { puzzle, scenario, setScenario, refusals, report } = frame;
  const seed = report.seed ?? scenario.seed;
  const pinned = scenario.seed !== null;
  const presets = puzzle.presets.filter((p: Preset) => Object.keys(p.overrides).length > 0 || p.roundSeconds !== undefined);
  const applyPreset = (id: string): void => {
    const p = presets.find((x) => x.id === id);
    if (p) setScenario({ ...withoutNumbers(scenario), overrides: p.overrides, roundSeconds: p.roundSeconds ?? null });
  };
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

      <RoundList onStart={onStart} ready={refusals.length === 0} />
    </div>
  );
}
