import { useCallback } from "react";
import { SALVAGE_CRATE, salvageStreakPercentAt, summarizeSalvage, type SalvageConfig, type SalvageMove, type SalvageState } from "@openseas/engine";
import { content, KindIcon, KINDS, SalvageBoard, SpriteIcon, spriteName, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { SALVAGE } from "../prototypes/salvage.js";

const salvage = content.puzzles.salvage;

/** Salvage (prototype, ADR 0036): the shared board in the studio's frame. */
export function SalvagePractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice<SalvageState, SalvageMove, SalvageConfig>({
    puzzle: "salvage",
    def: SALVAGE.def,
    config: salvage.config,
    roundSeconds: salvage.roundSeconds,
    summarize: summarizeSalvage,
  });
  const studio = useStudio(SALVAGE, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onTether = useCallback((cells: readonly number[], loop: boolean) => void api.apply({ type: "tether", cells: [...cells], loop }), [api]);

  const crates = shown.cells.filter((p) => p.kind === SALVAGE_CRATE).length;
  const kinds = KINDS.slice(0, cfg.kinds);

  return (
    <PracticeShell
      puzzle="salvage"
      eyebrow={t("harness.prototype_eyebrow")}
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
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {kinds.map((k, i) => (
              <li key={k.id}>
                <KindIcon kind={i} marks={showMarks} sprite={{ puzzle: "salvage", name: spriteName("debris", i) }} />
                <span>{t(`salvage.kind.${k.id}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <CrateIcon />
              <span>{t("salvage.legend_crate")}</span>
            </li>
            <li>
              <CouplerIcon />
              <span>{t("salvage.legend_coupler")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("salvage.legend_floor")}</p>
          <p className="muted small proto-note">{t("salvage.streak_note")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      board={(interactive) => (
        <SalvageBoard state={shown} version={api.version} interactive={interactive} showMarks={showMarks} hints={studio.hints} onTether={onTether} onFrame={api.markRendered} />
      )}
    />
  );
}

function CrateIcon() {
  const vector = (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#b9793c" stroke="#53361b" strokeWidth="1.4" />
      <path d="M7 3v18M17 3v18" stroke="#5d3e1e" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="3" fill="#d4a548" stroke="#6a5324" />
    </svg>
  );
  return <SpriteIcon puzzle="salvage" name="crate" fallback={vector} />;
}

function CouplerIcon() {
  const vector = (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      {[
        [6, 6],
        [18, 6],
        [6, 18],
        [18, 18],
      ].map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r="2.6" fill="#e9eef7" stroke="#747a85" />
      ))}
      <circle cx="12" cy="12" r="7.5" fill="#e9eef7" stroke="#747a85" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="3.6" fill="#142642" stroke="#747a85" />
    </svg>
  );
  return <SpriteIcon puzzle="salvage" name="coupler" fallback={vector} />;
}

