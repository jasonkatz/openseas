import { useCallback } from "react";
import { SALVAGE_CRATE, salvageStreakPercentAt, summarizeSalvage, type SalvageConfig, type SalvageMove, type SalvageState } from "@openseas/engine";
import { content, SALVAGE_KINDS, SalvageBoard, SalvageCrateIcon, SalvageDebrisIcon, SalvageRubbleIcon, SalvageVolatileIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { SALVAGE } from "../prototypes/salvage.js";
import type { StudioPuzzle } from "../puzzles.js";

const salvage = content.puzzles.salvage;

/** Salvage (prototype, ADR 0036): the shared board in the studio's frame. `entry` is the puzzle this page plays: Salvage, or the same puzzle on another engine (ADR 0097). */
export function SalvagePractice({ entry = SALVAGE }: { entry?: StudioPuzzle<SalvageState, SalvageMove, SalvageConfig> } = {}) {
  const api = usePractice<SalvageState, SalvageMove, SalvageConfig>({
    puzzle: "salvage",
    def: entry.def,
    config: salvage.config,
    roundSeconds: salvage.roundSeconds,
    summarize: summarizeSalvage,
  });
  const studio = useStudio(entry, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onTether = useCallback((cells: readonly number[], loop: boolean) => void api.apply({ type: "tether", cells: [...cells], loop }), [api]);

  const crates = shown.cells.filter((p) => p.kind === SALVAGE_CRATE).length;
  const kinds = SALVAGE_KINDS.slice(0, cfg.kinds);

  return (
    <PracticeShell
      puzzle="salvage"
      eyebrow={entry === SALVAGE ? t("studio.prototype_eyebrow") : t("rungs.eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("salvage.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < SALVAGE.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.combo}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("salvage.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("salvage.streak_note")}</p>
          <p className="how how-kbd">{t("salvage.order_note")}</p>
          <p className="how how-kbd">{t("salvage.volatile_note")}</p>
          <p className="how how-kbd">{t("salvage.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("salvage.crates")}</span>
            <span className="stat-value" data-testid="hud-crates">
              {t("salvage.crates_label", { count: crates, max: cfg.maxCrates })}
            </span>
          </div>
          {shown.order && (
            <div className="stat stat-wide">
              <span className="stat-label">{t("salvage.order_stat")}</span>
              <span className="stat-value" data-testid="hud-order" data-kind={shown.order.kind}>
                <SalvageDebrisIcon kind={shown.order.kind} size={18} /> {t("salvage.order_value", { kind: t(`salvage.kind.${SALVAGE_KINDS[shown.order.kind]!.id}`), length: cfg.orderLength })}
              </span>
            </div>
          )}
          <div className="stat stat-wide">
            <span className="stat-label">{t("salvage.streak_stat")}</span>
            <span className="stat-value" data-testid="hud-streak">
              {shown.combo > 0 ? t("salvage.streak_value", { count: shown.combo, percent: salvageStreakPercentAt(cfg, shown.combo) }) : t("salvage.streak_none")}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("salvage.result_longest")}</dt>
            <dd>{state.longest}</dd>
          </div>
          <div>
            <dt>{t("salvage.result_loops")}</dt>
            <dd>{state.loops}</dd>
          </div>
          <div>
            <dt>{t("salvage.result_netted")}</dt>
            <dd>{state.cratesNetted}</dd>
          </div>
          <div>
            <dt>{t("salvage.result_floor")}</dt>
            <dd>{state.cratesFloor}</dd>
          </div>
          {state.order && (
            <div>
              <dt>{t("salvage.result_orders")}</dt>
              <dd>{state.ordersFilled}</dd>
            </div>
          )}
          {cfg.volatileEvery > 0 && (
            <>
              <div>
                <dt>{t("salvage.result_defused")}</dt>
                <dd>{state.defused}</dd>
              </div>
              <div>
                <dt>{t("salvage.result_blasts")}</dt>
                <dd>{state.blasts}</dd>
              </div>
            </>
          )}
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {kinds.map((k, i) => (
              <li key={k.id}>
                <SalvageDebrisIcon kind={i} />
                <span>{t(`salvage.kind.${k.id}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <SalvageCrateIcon />
              <span>{t("salvage.legend_crate")}</span>
            </li>
            <li>
              <SalvageVolatileIcon kind={0} fuse={3} />
              <span>{t("salvage.legend_volatile")}</span>
            </li>
            <li>
              <SalvageRubbleIcon />
              <span>{t("salvage.legend_rubble")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("salvage.legend_floor")}</p>
          <p className="muted small proto-note">{t("salvage.streak_note")}</p>
        </>
      }
      board={(interactive) => (
        <SalvageBoard state={shown} version={api.version} interactive={interactive} hints={studio.hints} onTether={onTether} onFrame={api.markRendered} />
      )}
    />
  );
}
