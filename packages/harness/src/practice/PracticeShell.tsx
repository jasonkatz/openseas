import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isPrototypePuzzleId } from "@openseas/engine";
import { isMuted, setMuted, t, usePirate } from "@openseas/boards";
import { Link } from "../router.jsx";
import type { PracticeOutcome } from "./usePractice.js";
import type { BoardBasics, PracticePage } from "./usePracticePage.js";

const MARKS_KEY = "openseas.markTiles";

export function readMarksFlag(): boolean {
  try {
    return window.localStorage.getItem(MARKS_KEY) === "1";
  } catch {
    return false;
  }
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Eases a displayed number toward its target so score changes read as a tally, not a jump. */
export function useTally(target: number, ms = 450): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target < shown || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      return;
    }
    from.current = shown;
    const start = performance.now();
    let id = 0;
    const step = (now: number): void => {
      const k = Math.min(1, (now - start) / ms);
      setShown(Math.round(from.current + (target - from.current) * (1 - (1 - k) ** 3)));
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [target, ms]);
  return shown;
}

/** The "mark tiles" accessibility setting, shared by every board (rule 6). */
export function useShowMarks(): [boolean, (on: boolean) => void] {
  const [showMarks, setShowMarks] = useState(readMarksFlag);
  useEffect(() => {
    try {
      window.localStorage.setItem(MARKS_KEY, showMarks ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [showMarks]);
  return [showMarks, setShowMarks];
}

/** The HUD's three numbers and their labels. */
export interface Hud {
  score: number;
  moves: number;
  combo: number;
  /** The cap the moves bar counts down to; leave it out for counts that are not against a cap. */
  maxMoves?: number | undefined;
  /** Label for the moves stat when "Moves" is not the word (e.g. stars landed). */
  movesLabel?: string;
  /** Label for the score stat when "Score" is not the word (e.g. a rate). */
  scoreLabel?: string;
}

/** A state the HUD reads on its own: a score, a running combo, and a move count under its config's cap. */
interface Tallied {
  readonly score: number;
  readonly moveCount: number;
  readonly combo: number;
  readonly config: { readonly maxMoves: number };
}

interface ShellBase<S, M, C> {
  /** The page's round, bench and settings (`usePracticePage`). */
  page: PracticePage<S, M, C>;
  /** Leads the result card, above the score: what decided the round, where that matters most (a fight won or lost). */
  resultHeadline?: ReactNode;
  /** Art or extra lines on the start card above the how-to. */
  art?: ReactNode;
  /** Extra lines on the start card under the how-to. */
  howTo?: ReactNode;
  /** Stats shown beside the combo meter on wide screens and in the details panel on phones. */
  details?: ReactNode;
  /** The piece legend and the puzzle's own settings, shown below the board (wide) or in the panel (phones). The marks toggle follows it. */
  legend: ReactNode;
  /** Extra rows on the result card. */
  resultRows?: ReactNode;
  /** True while the board is in a dangerous state; colors the phone details button. */
  warn?: boolean;
  /** The board, given what every board takes. `interactive` is false when a panel covers it or no round is running. */
  board(basics: BoardBasics<S>): ReactNode;
}

/**
 * The HUD reads a state's score, move count and combo, and shows a lab round's tighter move cap
 * against the move count (the cap only keeps the log sane; the clock ends a round). `hud` replaces
 * any of them; a page that counts something else names its cap, if it has one, and a page whose
 * state does not carry all three numbers gives them all.
 */
export type ShellProps<S, M, C> = ShellBase<S, M, C> & (S extends Tallied ? { hud?: Partial<Hud> } : { hud: Hud });

/** The HUD for this render: the page's own numbers over what the state carries. */
function hudFor<S, M, C>(page: PracticePage<S, M, C>, own: Partial<Hud> | undefined): Hud {
  // The props type lets a page leave a number out only when its state is Tallied.
  const s = page.shown as unknown as Tallied;
  const base = page.puzzle.config as unknown as Tallied["config"];
  const counted = own?.moves === undefined;
  return {
    score: s.score,
    moves: s.moveCount,
    combo: s.combo,
    maxMoves: counted && s.config.maxMoves < base.maxMoves ? s.config.maxMoves : undefined,
    ...own,
  };
}

const COMBO_PIPS = 8;

/**
 * The practice page frame every puzzle shares: top bar, HUD, board well, start card, result card,
 * phone details panel, and the harness bench. It reads the page's round and bench; a page brings
 * its board, its own stats and lines, and its legend.
 */
export function PracticeShell<S, M, C>(p: ShellProps<S, M, C>) {
  const { page } = p;
  const { api, bench } = page;
  const { socketStatus, phase: piratePhase } = usePirate();
  const [muted, setMutedState] = useState(isMuted);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);
  const [splash, setSplash] = useState(0);
  const wide = useMediaQuery("(min-width: 900px)");
  const playing = page.playing;
  const reviewing = bench.reviewBar !== undefined;
  const hud = hudFor(page, (p as { hud?: Partial<Hud> }).hud);
  const score = useTally(hud.score);
  const lowTime = playing && api.timeLeft <= 10;
  const prefix = page.puzzle.id;
  // A prototype says it is one on its start card (ADR 0036).
  const eyebrow = isPrototypePuzzleId(prefix) ? t("harness.prototype_eyebrow") : t("practice.eyebrow");
  const legend = (
    <>
      {p.legend}
      <MarksToggle showMarks={page.showMarks} onChange={page.setShowMarks} />
    </>
  );

  useEffect(() => {
    if (playing) {
      setSplash((n) => n + 1);
      // A round started from the phone's bench sheet wants the board, not the sheet.
      setBenchOpen(false);
    }
  }, [playing]);

  const toggleMute = useCallback(() => {
    setMuted(!isMuted());
    setMutedState(isMuted());
  }, []);

  const statusClass = socketStatus === "open" ? "pip-live" : socketStatus === "connecting" ? "pip-wait" : "pip-off";
  const statusLong = socketStatus === "open" ? t("app.connected") : socketStatus === "connecting" ? t("app.connecting") : t("app.offline");
  const statusShort = socketStatus === "open" ? t("app.status_live") : socketStatus === "connecting" ? t("app.status_connecting") : t("app.status_offline");

  const backLink = (
    <Link to="/" className="icon-btn" aria-label={t("app.back")}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
  const statusPip = (
    <span className={`pip ${statusClass}`} title={statusLong}>
      <i aria-hidden="true" />
      {statusShort}
    </span>
  );
  const muteButton = (
    <button className="icon-btn" onClick={toggleMute} aria-label={muted ? t("app.unmute") : t("app.mute")} aria-pressed={muted} data-testid="toggle-sound">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
        {muted ? <path d="M16 9.5l5 5m0-5l-5 5" /> : <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />}
      </svg>
    </button>
  );
  const benchButton = !wide && (
    <button
      className={`icon-btn bench-btn ${benchOpen ? "is-open" : ""}`}
      onClick={() => setBenchOpen((o) => !o)}
      aria-expanded={benchOpen}
      aria-label={benchOpen ? t("harness.bench_hide") : t("harness.bench_show")}
      data-testid="bench-toggle"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16M4 12h10M4 17h13" />
        <circle cx="17.5" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
  const coreStats = (
    <>
      <div className="stat stat-score">
        <span className="stat-label">{hud.scoreLabel ?? t("practice.score")}</span>
        <span className="stat-value" data-testid="hud-score">
          <span key={hud.score} className={hud.score ? "bump" : undefined}>
            {score}
          </span>
          {!wide && hud.combo > 1 && (
            <b className={`combo-chip ${hud.combo >= 6 ? "hot" : ""}`} key={hud.combo}>
              ×{hud.combo}
            </b>
          )}
        </span>
      </div>
      <div className={`stat ${lowTime ? "stat-urgent" : ""}`}>
        <span className="stat-label">{t("practice.time")}</span>
        <span className={`stat-value ${lowTime ? "urgent" : ""}`} data-testid="hud-time">
          {fmt(api.timeLeft)}
        </span>
        <span className="bar" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (api.timeLeft / Math.max(1, api.roundSeconds)) * 100)}%` }} />
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{hud.movesLabel ?? t("practice.moves")}</span>
        <span className="stat-value" data-testid="hud-moves">
          {hud.moves}
          {hud.maxMoves !== undefined && <small>/{hud.maxMoves}</small>}
        </span>
        {hud.maxMoves !== undefined && (
          <span className="bar bar-moves" aria-hidden="true">
            <i style={{ width: `${Math.max(0, 1 - hud.moves / hud.maxMoves) * 100}%` }} />
          </span>
        )}
      </div>
    </>
  );
  const comboMeter = (
    <div className="stat stat-wide">
      <span className="stat-label">{t("practice.combo")}</span>
      <span className={`combo-meter ${hud.combo >= 6 ? "hot" : ""}`} aria-label={t("practice.combo_label", { count: hud.combo })}>
        {Array.from({ length: COMBO_PIPS }, (_, i) => (
          <i key={i} className={i < Math.min(COMBO_PIPS, hud.combo) ? "lit" : ""} />
        ))}
        <b data-testid="hud-combo" key={hud.combo}>
          {hud.combo ? t("practice.combo_label", { count: hud.combo }) : ""}
        </b>
      </span>
    </div>
  );

  const covered = detailsOpen || (benchOpen && !wide);
  const board = (
    <section className={`board-wrap ${lowTime ? "low-time" : ""} ${playing ? "is-playing" : ""}`}>
      {/* A step back or a jump in review redraws the board from scratch. */}
      <Fragment key={bench.reviewKey ?? "live"}>{p.board({ ...page.board, interactive: playing && !covered })}</Fragment>
      {playing && splash > 0 && (
        <div className="splash" key={splash} aria-hidden="true">
          {t(`${prefix}.go`)}
        </div>
      )}

      {reviewing && (
        <div className="review-bar" data-testid="review-bar">
          {bench.reviewBar}
        </div>
      )}

      {!playing && !reviewing && (
        <div className="board-veil">
          {api.phase === "idle" && (
            <div className="veil-card">
              <p className="eyebrow">{eyebrow}</p>
              <h2>{t(`${prefix}.title`)}</h2>
              {p.art}
              <p className="how">{t(`${prefix}.how_to`)}</p>
              {t(`${prefix}.how_to_keyboard`) !== "" && <p className="how how-kbd">{t(`${prefix}.how_to_keyboard`)}</p>}
              {p.howTo}
              {api.best > 0 && <p className="best-line">{t("practice.best", { score: api.best })}</p>}
              {!api.canRecord && socketStatus !== "connecting" && (
                <p className="note">{piratePhase === "needs-pirate" ? t("harness.needs_pirate_note") : piratePhase === "loading" ? t("app.loading") : t("app.offline")}</p>
              )}
              <div className="stack">
                <button className="btn btn-brass" onClick={api.startRecorded} disabled={!api.canRecord} data-testid="start-recorded">
                  {t("harness.recorded_start")}
                </button>
                <button className="btn btn-ghost" onClick={api.startUnrated} data-testid="start-unrated">
                  {t("practice.unrated_start")}
                </button>
                <button className="btn btn-lab" onClick={bench.startLab} disabled={!bench.labReady} data-testid="start-lab">
                  {t("harness.lab_start")}
                </button>
                <p className="lab-summary" data-testid="lab-summary">
                  {bench.labSummary}
                </p>
              </div>
            </div>
          )}
          {api.phase === "dealing" && (
            <p className="status">
              <span className="spinner" aria-hidden="true" />
              {t("app.connecting")}
            </p>
          )}
          {api.phase === "waiting" && (
            <p className="status">
              <span className="spinner" aria-hidden="true" />
              {t("practice.waiting_result")}
            </p>
          )}
          {api.phase === "result" && api.outcome && (
            <div className="veil-card" data-testid="result">
              <p className="eyebrow">{t("practice.round_over")}</p>
              {p.resultHeadline}
              <ResultBody outcome={api.outcome} rows={p.resultRows} />
              <div className="stack">
                <button
                  className="btn btn-brass"
                  onClick={api.outcome.kind === "lab" ? bench.startLab : api.canRecord ? api.startRecorded : api.startUnrated}
                  data-testid="restart"
                >
                  {t("practice.restart")}
                </button>
                <Link to="/" className="btn btn-ghost">
                  {t("app.back")}
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {!wide && detailsOpen && (
        <>
          <button className="hud-scrim" aria-label={t("practice.details_hide")} onClick={() => setDetailsOpen(false)} />
          <div className="hud-panel" data-testid="hud-panel">
            {statusPip}
            {comboMeter}
            {p.details}
            <div className="legend legend-inline">{legend}</div>
          </div>
        </>
      )}

      {!wide && benchOpen && (
        <div className="bench-sheet" data-testid="bench-sheet">
          <div className="bench-sheet-bar">
            <span className="eyebrow">{t("harness.bench_title")}</span>
            <button className="icon-btn" onClick={() => setBenchOpen(false)} aria-label={t("harness.bench_hide")}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {bench.bench}
        </div>
      )}
    </section>
  );

  if (wide) {
    return (
      <main className="page puzzle puzzle-bench">
        <header className="puzzle-bar">
          {backLink}
          <h1 className="puzzle-title">{t(`${prefix}.title`)}</h1>
          {statusPip}
          {muteButton}
        </header>
        <section className="hud" aria-live="off">
          {coreStats}
          {comboMeter}
          {p.details}
        </section>
        {board}
        <details className="legend" open>
          <summary>{t("practice.legend")}</summary>
          {legend}
        </details>
        <aside className="bench" data-testid="bench">
          {bench.bench}
        </aside>
      </main>
    );
  }

  return (
    <main className="page puzzle puzzle-compact">
      <header className="puzzle-bar puzzle-bar-compact has-bench">
        {backLink}
        <section className="hud-strip" aria-live="off">
          {coreStats}
        </section>
        {benchButton}
        <button
          className={`icon-btn details-btn ${p.warn && playing ? "warn" : ""}`}
          onClick={() => setDetailsOpen((o) => !o)}
          aria-expanded={detailsOpen}
          aria-label={detailsOpen ? t("practice.details_hide") : t("practice.details_show")}
          data-testid="toggle-details"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d={detailsOpen ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
          </svg>
          <i className={`dot ${statusClass}`} aria-hidden="true" />
        </button>
        {muteButton}
      </header>
      {board}
    </main>
  );
}

function ResultBody({ outcome, rows }: { outcome: PracticeOutcome; rows?: ReactNode }) {
  if (outcome.kind === "rejected") {
    return (
      <>
        <h2>{t("practice.result_rejected_title")}</h2>
        <p className="error">{t("practice.result_rejected", { reason: t(`practice.reject.${outcome.reason}`) })}</p>
      </>
    );
  }
  const r = outcome.kind === "recorded" ? outcome.result : outcome;
  const performance = outcome.kind === "recorded" ? outcome.result.performance : outcome.performance;
  return (
    <>
      <ResultScore score={r.score} />
      {outcome.newBest && <p className="best-badge">{t("practice.new_best")}</p>}
      <dl className="result-stats">
        <div>
          <dt>{t("practice.moves")}</dt>
          <dd>{r.moves}</dd>
        </div>
        <div>
          <dt>{t("practice.best_combo")}</dt>
          <dd>{r.bestCombo}</dd>
        </div>
        {rows}
        <div>
          <dt>{t("harness.performance")}</dt>
          <dd data-testid="result-performance" data-rating={performance.rating}>
            {t("harness.performance_value", { rating: performance.rating, tier: t(`tier.${performance.tier}`) })}
          </dd>
        </div>
      </dl>
      {outcome.kind === "recorded" ? (
        <p className="muted small">{outcome.result.verified ? t("harness.result_recorded") : t("practice.result_unverified")}</p>
      ) : outcome.kind === "lab" ? (
        <p className="muted small">{t("harness.result_lab")}</p>
      ) : (
        <p className="muted small">{t("harness.result_unrated")}</p>
      )}
    </>
  );
}

function ResultScore({ score }: { score: number }) {
  const [target, setTarget] = useState(0);
  useEffect(() => setTarget(score), [score]);
  const shown = useTally(target, 900);
  return (
    <p className="result-score" data-testid="result-score">
      {shown}
    </p>
  );
}

/** The marks toggle every legend ends with. */
export function MarksToggle({ showMarks, onChange }: { showMarks: boolean; onChange(on: boolean): void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={showMarks} onChange={(e) => onChange(e.target.checked)} data-testid="toggle-marks" />
      <span>
        {t("practice.setting_marks")} <small className="muted">{t("practice.setting_marks_hint")}</small>
      </span>
    </label>
  );
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
