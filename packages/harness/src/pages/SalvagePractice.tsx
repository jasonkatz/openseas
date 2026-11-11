import { useCallback } from "react";
import { SALVAGE_CRATE, salvageStreakPercentAt } from "@openseas/engine";
import { KindIcon, KINDS, SalvageBoard, SpriteIcon, spriteName, t } from "@openseas/boards";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePracticePage } from "../practice/usePracticePage.js";
import { SALVAGE } from "../prototypes/salvage.js";

/** Salvage (prototype, ADR 0036): the practice frame round the shared board, with the bench beside it. */
export function SalvagePractice() {
  const page = usePracticePage(SALVAGE);
  const { shown, showMarks } = page;
  const { state, apply } = page.api;
  const cfg = shown.config;

  const onTether = useCallback((cells: readonly number[], loop: boolean) => void apply({ type: "tether", cells: [...cells], loop }), [apply]);

  const crates = shown.cells.filter((p) => p.kind === SALVAGE_CRATE).length;
  const kinds = KINDS.slice(0, cfg.kinds);

  return (
    <PracticeShell
      page={page}
      hud={{ movesLabel: t("salvage.moves") }}
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
        </>
      }
      board={(b) => <SalvageBoard {...b} onTether={onTether} />}
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

