import { useCallback } from "react";
import { ASSEMBLY_CORE, assemblyNextPlace, summarizeAssembly, type AssemblyConfig, type AssemblyMove, type AssemblyState } from "@openseas/engine";
import { content, ASSEMBLY_KINDS, AssemblyBoard, AssemblyPartIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { ASSEMBLY } from "../prototypes/assembly.js";
import type { StudioPuzzle } from "../puzzles.js";

const assembly = content.puzzles.assembly;

/** Assembly (prototype, ADR 0036): the shared board in the studio's frame. `entry` is the puzzle this page plays: the prototype, or the same puzzle on another engine (ADR 0097, ADR 0099). */
export function AssemblyPractice({ entry = ASSEMBLY }: { entry?: StudioPuzzle<AssemblyState, AssemblyMove, AssemblyConfig> } = {}) {
  const api = usePractice<AssemblyState, AssemblyMove, AssemblyConfig>({
    puzzle: "assembly",
    def: entry.def,
    config: assembly.config,
    roundSeconds: assembly.roundSeconds,
    summarize: summarizeAssembly,
  });
  const studio = useStudio(entry, api);
  const { state } = api;
  const cfg = state.config;

  const onSwap = useCallback((a: number, b: number) => void api.apply({ type: "swap", a, b }), [api]);
  const onFit = useCallback((slot: number, cell: number) => void api.apply({ type: "fit", slot, cell }), [api]);

  const chains = cfg.chainCap > 1;
  const cores = cfg.maxCores > 0 || cfg.startCores > 0;

  return (
    <PracticeShell
      puzzle="assembly"
      eyebrow={entry === ASSEMBLY ? t("studio.prototype_eyebrow") : t("rungs.eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={state.score}
      moves={state.moveCount}
      movesLabel={t("assembly.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < entry.config.maxMoves ? cfg.maxMoves : undefined}
      combo={state.chain}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("assembly.go")}
      howTo={
        <>
          {chains && <p className="how how-kbd">{t("assembly.chain_note")}</p>}
          {cores && <p className="how how-kbd">{t("assembly.core_note")}</p>}
          <p className="how how-kbd">{t("assembly.hint_note")}</p>
        </>
      }
      details={
        chains ? (
          <>
            <div className="stat stat-wide">
              <span className="stat-label">{t("assembly.chain")}</span>
              <span className="stat-value" data-testid="hud-chain">
                {state.chain > 0 ? t("assembly.chain_value", { count: state.chain }) : t("assembly.chain_none")}
              </span>
            </div>
            <div className="stat stat-wide">
              <span className="stat-label">{t("assembly.next_fit")}</span>
              <span className="stat-value" data-testid="hud-next-fit">
                {t("assembly.next_fit_value", { count: assemblyNextPlace(state) })}
              </span>
            </div>
          </>
        ) : null
      }
      resultRows={
        <>
          <div>
            <dt>{t("assembly.result_fits")}</dt>
            <dd>{state.fits}</dd>
          </div>
          {chains && (
            <div>
              <dt>{t("assembly.result_best_chain")}</dt>
              <dd>{state.bestChain}</dd>
            </div>
          )}
          <div>
            <dt>{t("assembly.result_big")}</dt>
            <dd>{state.bigFits}</dd>
          </div>
          {cores && (
            <div>
              <dt>{t("assembly.result_cores")}</dt>
              <dd>{state.coresUsed}</dd>
            </div>
          )}
          <div>
            <dt>{t("assembly.result_swaps")}</dt>
            <dd>{state.swaps}</dd>
          </div>
        </>
      }
      legend={
        <>
          <p className="muted small proto-note">{t("assembly.legend_parts")}</p>
          <ul className="specials">
            {ASSEMBLY_KINDS.map((k, i) => (
              <li key={k.id}>
                <AssemblyPartIcon kind={i} />
                <span>{t(`assembly.kind.${k.id}`)}</span>
              </li>
            ))}
            {cores && (
              <li>
                <AssemblyPartIcon kind={ASSEMBLY_CORE} />
                <span>{t("assembly.kind.core")}</span>
              </li>
            )}
          </ul>
          <p className="muted small proto-note">{t("assembly.legend_tray")}</p>
          {chains && <p className="muted small proto-note">{t("assembly.chain_note")}</p>}
        </>
      }
      board={(interactive) => (
        <AssemblyBoard state={state} version={api.version} interactive={interactive} hints={studio.hints} onSwap={onSwap} onFit={onFit} onFrame={api.markRendered} />
      )}
    />
  );
}
