import { TierPace, t, type TierPaceValue } from "@openseas/boards";
import { useTally, type ShellProps } from "./PracticeShell.jsx";

const COMBO_PIPS = 8;

/** Score with the live tier, time and moves: the three stats every shell leads with. */
export function CoreStats({ p, wide, pace, lowTime }: { p: ShellProps; wide: boolean; pace: TierPaceValue | null; lowTime: boolean }) {
  const score = useTally(p.score);
  return (
    <>
      <div className="stat stat-score">
        <span className="stat-label">{p.scoreLabel ?? t("practice.score")}</span>
        <span className="stat-value" data-testid="hud-score">
          <span key={p.score} className={p.score ? "bump" : undefined}>
            {score}
          </span>
          {!wide && p.combo > 1 && (
            <b className={`combo-chip ${p.combo >= 6 ? "hot" : ""}`} key={p.combo}>
              ×{p.combo}
            </b>
          )}
          {!wide && <TierPace pace={pace} label={false} />}
        </span>
        {wide && <TierPace pace={pace} />}
      </div>
      <div className={`stat ${lowTime ? "stat-urgent" : ""}`}>
        <span className="stat-label">{t("practice.time")}</span>
        <span className={`stat-value ${lowTime ? "urgent" : ""}`} data-testid="hud-time">
          {fmt(p.timeLeft)}
        </span>
        <span className="bar" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (p.timeLeft / Math.max(1, p.roundSeconds)) * 100)}%` }} />
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{p.movesLabel ?? t("practice.moves")}</span>
        <span className="stat-value" data-testid="hud-moves">
          {p.moves}
          {p.maxMoves !== undefined && <small>/{p.maxMoves}</small>}
        </span>
        {p.maxMoves !== undefined && (
          <span className="bar bar-moves" aria-hidden="true">
            <i style={{ width: `${Math.max(0, 1 - p.moves / p.maxMoves) * 100}%` }} />
          </span>
        )}
      </div>
    </>
  );
}

export function ComboMeter({ combo }: { combo: number }) {
  return (
    <div className="stat stat-wide">
      <span className="stat-label">{t("practice.combo")}</span>
      <span className={`combo-meter ${combo >= 6 ? "hot" : ""}`} aria-label={t("practice.combo_label", { count: combo })}>
        {Array.from({ length: COMBO_PIPS }, (_, i) => (
          <i key={i} className={i < Math.min(COMBO_PIPS, combo) ? "lit" : ""} />
        ))}
        <b data-testid="hud-combo" key={combo}>
          {combo ? t("practice.combo_label", { count: combo }) : ""}
        </b>
      </span>
    </div>
  );
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
