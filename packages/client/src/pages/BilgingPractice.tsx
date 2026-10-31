import { useCallback, useEffect, useRef, useState } from "react";
import { createBilgingGame, type BilgingState, type ClearRound, type MoveReport } from "@openseas/engine";
import type { PuzzleResult, ServerMessage } from "@openseas/protocol";
import { isMuted, setMuted, sfx } from "../audio.js";
import { BilgingBoard } from "../bilging/BilgingBoard.jsx";
import { BilgingRound } from "../bilging/round.js";
import { content, t } from "../content.js";
import { Link } from "../router.jsx";
import { usePirate } from "../state/PirateProvider.jsx";

type Phase = "idle" | "starting" | "playing" | "waiting" | "result";
type Outcome =
  | { kind: "rated"; result: PuzzleResult; newBest: boolean }
  | { kind: "rejected"; reason: string }
  | { kind: "unrated"; score: number; moves: number; bestCombo: number; newBest: boolean };

const bilging = content.puzzles.bilging;
const MARKS_KEY = "openseas.markTiles";
const BEST_KEY = "openseas.bilging.best";
const COMBO_PIPS = 8;

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function readBest(): number {
  try {
    return Number(window.localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Records a finished round's score; true when it beats the stored best. */
function recordBest(score: number): boolean {
  if (score <= readBest()) return false;
  try {
    window.localStorage.setItem(BEST_KEY, String(score));
  } catch {
    /* private mode */
  }
  return true;
}

function useMediaQuery(query: string): boolean {
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
function useTally(target: number, ms = 450): number {
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

export function BilgingPractice() {
  const { pirate, socket, socketStatus, setPirate } = usePirate();
  const [phase, setPhase] = useState<Phase>("idle");
  // A fixed board sits behind the start card so the page never opens on an empty hull.
  const [state, setState] = useState<BilgingState | null>(() => createBilgingGame("menu", bilging.config));
  const [report, setReport] = useState<MoveReport | null>(null);
  const [version, setVersion] = useState(0);
  const [timeLeft, setTimeLeft] = useState(bilging.roundSeconds);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showMarks, setShowMarks] = useState(() => readFlag(MARKS_KEY));
  const [muted, setMutedState] = useState(isMuted);
  const [best, setBest] = useState(readBest);
  const [splash, setSplash] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const wide = useMediaQuery("(min-width: 900px)");
  const round = useRef<BilgingRound | null>(null);
  const sessionId = useRef<string | null>(null);
  const canRate = socketStatus === "open" && pirate !== null;

  const beginRound = useCallback(
    (seed: string, deadlineAt: number, rated: { sessionId: string } | null) => {
      round.current?.abandon();
      const r = new BilgingRound({
        seed,
        config: bilging.config,
        deadlineAt,
        rated: rated ? { socket, sessionId: rated.sessionId } : null,
        onChange: (s, rep) => {
          setState(s);
          setReport(rep);
          setVersion((v) => v + 1);
          if (rep) sfx.swap();
        },
        onFinished: () => {
          sfx.end();
          if (rated) setPhase("waiting");
          else {
            const s = round.current?.state;
            if (s) {
              const newBest = recordBest(s.score);
              if (newBest) setBest(s.score);
              setOutcome({ kind: "unrated", score: s.score, moves: s.moveCount, bestCombo: s.bestCombo, newBest });
            }
            setPhase("result");
          }
        },
      });
      round.current = r;
      sessionId.current = rated?.sessionId ?? null;
      setOutcome(null);
      setTimeLeft(Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)));
      setPhase("playing");
      setSplash((n) => n + 1);
      sfx.start();
    },
    [socket],
  );

  const startUnrated = useCallback(() => {
    const seed = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    beginRound(seed, Date.now() + bilging.roundSeconds * 1000, null);
  }, [beginRound]);

  const startRated = useCallback(() => {
    setPhase("starting");
    if (!socket.send({ type: "puzzle.start", puzzle: "bilging" })) startUnrated();
  }, [socket, startUnrated]);

  // Server messages for this page.
  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "puzzle.started":
            beginRound(m.seed, m.deadlineAt - socket.clockOffset, { sessionId: m.sessionId });
            break;
          case "puzzle.result": {
            if (m.sessionId !== sessionId.current) return;
            const newBest = recordBest(m.score);
            if (newBest) setBest(m.score);
            setOutcome({ kind: "rated", result: m, newBest });
            setPhase("result");
            if (pirate) {
              const others = pirate.ratings.filter((r) => r.puzzle !== m.rating.puzzle);
              setPirate({ ...pirate, ratings: [...others, m.rating] });
            }
            break;
          }
          case "puzzle.rejected":
            if (m.sessionId !== sessionId.current) return;
            round.current?.abandon();
            setOutcome({ kind: "rejected", reason: m.reason });
            setPhase("result");
            break;
          default:
            break;
        }
      }),
    [socket, beginRound, pirate, setPirate],
  );

  // Round clock, with a tick for each of the last ten seconds.
  useEffect(() => {
    if (phase !== "playing") return;
    let last = -1;
    const id = window.setInterval(() => {
      const r = round.current;
      if (!r) return;
      const left = Math.max(0, Math.ceil((r.opts.deadlineAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left !== last && left > 0 && left <= 10) sfx.tick(left <= 5);
      last = left;
      if (left <= 0) r.finish();
    }, 100);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => () => round.current?.abandon(), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MARKS_KEY, showMarks ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [showMarks]);

  const onSwap = useCallback((col: number, row: number) => {
    round.current?.swap(col, row);
  }, []);
  const preview = useCallback((col: number, row: number) => round.current?.preview(col, row) ?? [], []);
  const onFrame = useCallback(() => round.current?.metrics.markRendered(), []);
  const onClear = useCallback((r: ClearRound) => {
    const causes = new Set(r.groups.map((g) => g.cause));
    if (causes.has("keg")) sfx.keg();
    if (causes.has("ink")) sfx.ink();
    if (causes.has("barnacle")) sfx.barnacle();
    if (causes.has("match")) sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
  }, []);
  const toggleMute = useCallback(() => {
    setMuted(!isMuted());
    setMutedState(isMuted());
  }, []);

  const playing = phase === "playing";
  const score = useTally(state?.score ?? 0);
  const combo = state?.combo ?? 0;
  const waterFrac = state ? state.waterRow / state.config.height : bilging.config.initialWaterRow / bilging.config.height;
  const danger = waterFrac >= 0.5;
  const shownTime = phase === "idle" ? bilging.roundSeconds : timeLeft;
  const lowTime = playing && timeLeft <= 10;
  const moves = state?.moveCount ?? 0;

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
  const coreStats = (
    <>
      <div className="stat stat-score">
        <span className="stat-label">{t("bilging.score")}</span>
        <span className="stat-value" data-testid="hud-score">
          <span key={state?.score ?? 0} className={state?.score ? "bump" : undefined}>
            {score}
          </span>
          {!wide && combo > 1 && (
            <b className={`combo-chip ${combo >= 6 ? "hot" : ""}`} key={combo}>
              ×{combo}
            </b>
          )}
        </span>
      </div>
      <div className={`stat ${lowTime ? "stat-urgent" : ""}`}>
        <span className="stat-label">{t("bilging.time")}</span>
        <span className={`stat-value ${lowTime ? "urgent" : ""}`} data-testid="hud-time">
          {fmt(shownTime)}
        </span>
        <span className="bar" aria-hidden="true">
          <i style={{ width: `${(shownTime / bilging.roundSeconds) * 100}%` }} />
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{t("bilging.moves")}</span>
        <span className="stat-value" data-testid="hud-moves">
          {moves}
          <small>/{bilging.config.maxMoves}</small>
        </span>
        <span className="bar bar-moves" aria-hidden="true">
          <i style={{ width: `${(1 - moves / bilging.config.maxMoves) * 100}%` }} />
        </span>
      </div>
    </>
  );
  const comboAndWater = (
    <>
      <div className="stat stat-wide">
        <span className="stat-label">{t("bilging.combo")}</span>
        <span className={`combo-meter ${combo >= 6 ? "hot" : ""}`} aria-label={t("bilging.combo_label", { count: combo })}>
          {Array.from({ length: COMBO_PIPS }, (_, i) => (
            <i key={i} className={i < Math.min(COMBO_PIPS, combo) ? "lit" : ""} />
          ))}
          <b data-testid="hud-combo" key={combo}>
            {combo ? t("bilging.combo_label", { count: combo }) : ""}
          </b>
        </span>
      </div>
      <div className="stat stat-wide">
        <span className="stat-label">{t("bilging.water")}</span>
        <span className="water-row">
          <span className={`water-meter ${danger ? "danger" : ""}`}>
            <i style={{ width: `${Math.round(waterFrac * 100)}%` }} />
          </span>
          {danger && playing && <em className="water-warn">{t("bilging.water_danger")}</em>}
        </span>
      </div>
    </>
  );
  const legendBody = (
    <>
      <ul className="specials">
        {(["keg", "ink", "barnacle"] as const).map((k) => (
          <li key={k}>
            <TileIcon color={bilging.specials[k].color} special={k} />
            <span>
              <b>{t(bilging.specials[k].nameKey)}</b> {t(`bilging.special.${k}_help`)}
            </span>
          </li>
        ))}
      </ul>
      <ul className="kinds">
        {bilging.pieces.slice(0, bilging.config.pieceKinds).map((p) => (
          <li key={p.nameKey}>
            <TileIcon color={p.color} mark={showMarks ? p.mark : null} />
            <span>{t(p.nameKey)}</span>
          </li>
        ))}
      </ul>
      <label className="toggle">
        <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} data-testid="toggle-marks" />
        <span>
          {t("bilging.setting_marks")} <small className="muted">{t("bilging.setting_marks_hint")}</small>
        </span>
      </label>
    </>
  );

  const board = (
    <section className={`board-wrap ${lowTime ? "low-time" : ""} ${playing ? "is-playing" : ""}`}>
      <BilgingBoard
        state={state}
        report={report}
        version={version}
        interactive={playing && !detailsOpen}
        showMarks={showMarks}
        onSwap={onSwap}
        preview={preview}
        onFrame={onFrame}
        onClear={onClear}
      />
      {playing && splash > 0 && (
        <div className="splash" key={splash} aria-hidden="true">
          {t("bilging.go")}
        </div>
      )}

      {!playing && (
        <div className="board-veil">
          {phase === "idle" && (
            <div className="veil-card">
              <p className="eyebrow">{t("bilging.eyebrow")}</p>
              <h2>{t("bilging.title")}</h2>
              <div className="tile-row" aria-hidden="true">
                {bilging.pieces.slice(0, bilging.config.pieceKinds).map((p, i) => (
                  <span key={p.nameKey} style={{ animationDelay: `${i * 70}ms` }}>
                    <TileIcon color={p.color} mark={showMarks ? p.mark : null} />
                  </span>
                ))}
              </div>
              <p className="how">{t("bilging.how_to")}</p>
              <p className="how how-kbd">{t("bilging.how_to_keyboard")}</p>
              {best > 0 && <p className="best-line">{t("bilging.best", { score: best })}</p>}
              {!canRate && socketStatus !== "connecting" && <p className="note">{t("app.offline")}</p>}
              <div className="stack">
                <button className="btn btn-brass" onClick={startRated} disabled={!canRate} data-testid="start-rated">
                  {t("bilging.start")}
                </button>
                <button className="btn btn-ghost" onClick={startUnrated} data-testid="start-unrated">
                  {t("bilging.unrated_start")}
                </button>
              </div>
            </div>
          )}
          {phase === "starting" && (
            <p className="status">
              <span className="spinner" aria-hidden="true" />
              {t("app.connecting")}
            </p>
          )}
          {phase === "waiting" && (
            <p className="status">
              <span className="spinner" aria-hidden="true" />
              {t("bilging.waiting_result")}
            </p>
          )}
          {phase === "result" && outcome && (
            <div className="veil-card" data-testid="result">
              <p className="eyebrow">{t("bilging.round_over")}</p>
              <ResultBody outcome={outcome} />
              <div className="stack">
                <button className="btn btn-brass" onClick={canRate ? startRated : startUnrated} data-testid="restart">
                  {t("bilging.restart")}
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
          <button className="hud-scrim" aria-label={t("bilging.details_hide")} onClick={() => setDetailsOpen(false)} />
          <div className="hud-panel" data-testid="hud-panel">
            {statusPip}
            {comboAndWater}
            <div className="legend legend-inline">{legendBody}</div>
          </div>
        </>
      )}
    </section>
  );

  if (wide) {
    return (
      <main className="page puzzle">
        <header className="puzzle-bar">
          {backLink}
          <h1 className="puzzle-title">{t("bilging.title")}</h1>
          {statusPip}
          {muteButton}
        </header>
        <section className="hud" aria-live="off">
          {coreStats}
          {comboAndWater}
        </section>
        {board}
        <details className="legend" open>
          <summary>{t("bilging.legend")}</summary>
          {legendBody}
        </details>
      </main>
    );
  }

  // Phones: the top bar is the HUD, so the board gets every other pixel. Details open over the board.
  return (
    <main className="page puzzle puzzle-compact">
      <header className="puzzle-bar puzzle-bar-compact">
        {backLink}
        <section className="hud-strip" aria-live="off">
          {coreStats}
        </section>
        <button
          className={`icon-btn details-btn ${danger && playing ? "warn" : ""}`}
          onClick={() => setDetailsOpen((o) => !o)}
          aria-expanded={detailsOpen}
          aria-label={detailsOpen ? t("bilging.details_hide") : t("bilging.details_show")}
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

function ResultBody({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "rejected") {
    return (
      <>
        <h2>{t("bilging.result_rejected_title")}</h2>
        <p className="error">{t("bilging.result_rejected", { reason: t(`bilging.reject.${outcome.reason}`) })}</p>
      </>
    );
  }
  const r = outcome.kind === "rated" ? outcome.result : outcome;
  return (
    <>
      <ResultScore score={r.score} />
      {outcome.newBest && <p className="best-badge">{t("bilging.new_best")}</p>}
      <dl className="result-stats">
        <div>
          <dt>{t("bilging.moves")}</dt>
          <dd>{r.moves}</dd>
        </div>
        <div>
          <dt>{t("bilging.best_combo")}</dt>
          <dd>{r.bestCombo}</dd>
        </div>
        {outcome.kind === "rated" && (
          <div>
            <dt>{t("bilging.standing")}</dt>
            <dd>{t(`tier.${outcome.result.rating.tier}`)}</dd>
          </div>
        )}
      </dl>
      {outcome.kind === "rated" ? (
        <>
          <p className={`tier-line tier-${outcome.result.tierChange}`}>
            {t(`bilging.tier_${outcome.result.tierChange}`, { tier: t(`tier.${outcome.result.rating.tier}`) })}
          </p>
          <p className="muted small">{outcome.result.verified ? t("bilging.result_verified") : t("bilging.result_unverified")}</p>
        </>
      ) : (
        <p className="muted small">{t("bilging.result_unrated")}</p>
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

function TileIcon({ color, mark, special }: { color: string; mark?: string | null; special?: "keg" | "ink" | "barnacle" }) {
  const ink = "#0b1526";
  const markBody = (() => {
    switch (mark) {
      case "circle":
        return <circle cx="12" cy="12" r="3.2" fill={ink} opacity=".75" />;
      case "square":
        return <rect x="8.8" y="8.8" width="6.4" height="6.4" fill={ink} opacity=".75" />;
      case "triangle":
        return <polygon points="12,8.2 15.8,15 8.2,15" fill={ink} opacity=".75" />;
      case "diamond":
        return <polygon points="12,7.8 16.2,12 12,16.2 7.8,12" fill={ink} opacity=".75" />;
      case "hexagon":
        return <polygon points="12,8 15.5,10 15.5,14 12,16 8.5,14 8.5,10" fill={ink} opacity=".75" />;
      case "star":
        return <polygon points="12,7.5 13.2,10.6 16.5,10.8 13.9,12.9 14.8,16.2 12,14.4 9.2,16.2 10.1,12.9 7.5,10.8 10.8,10.6" fill={ink} opacity=".75" />;
      case "gear":
        return (
          <g fill={ink} opacity=".75">
            <circle cx="12" cy="12" r="3.6" />
            <circle cx="12" cy="12" r="1.5" fill={color} />
          </g>
        );
      default:
        return null;
    }
  })();
  const specialBody = (() => {
    switch (special) {
      case "keg":
        return (
          <g>
            <circle cx="12" cy="13.5" r="4" fill="#f2f0e6" />
            <rect x="11" y="8" width="2" height="2.5" fill="#f2f0e6" />
            <circle cx="15.5" cy="6.5" r="1.3" fill="#ffb347" />
          </g>
        );
      case "ink":
        return (
          <g fill="#c084fc">
            <circle cx="9.5" cy="12" r="3" />
            <circle cx="14.5" cy="11" r="2.6" />
            <circle cx="12" cy="14.5" r="3.2" />
          </g>
        );
      case "barnacle":
        return (
          <g fill="#f2f0e6">
            <polygon points="12,6 17,11 14.5,11 12,8.5 9.5,11 7,11" />
            <rect x="7.5" y="13" width="9" height="1.4" opacity=".7" />
            <rect x="8.8" y="15.5" width="6.4" height="1.4" opacity=".45" />
          </g>
        );
      default:
        return null;
    }
  })();
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="tile-icon">
      <rect x="2" y="3.2" width="20" height="20" rx="4.4" fill="#000" opacity=".35" />
      <rect x="2" y="2" width="20" height="20" rx="4.4" fill={color} stroke={special ? "#d4a548" : "none"} strokeWidth="1.2" />
      <rect x="4" y="3.5" width="16" height="6" rx="3" fill="#fff" opacity=".2" />
      {special ? specialBody : markBody}
    </svg>
  );
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
