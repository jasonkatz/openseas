import { useCallback, useEffect, useRef, useState } from "react";
import type { BilgingState, MoveReport } from "@openseas/engine";
import type { PuzzleResult, ServerMessage } from "@openseas/protocol";
import { sfx } from "../audio.js";
import { BilgingBoard } from "../bilging/BilgingBoard.jsx";
import { BilgingRound } from "../bilging/round.js";
import { content, t } from "../content.js";
import { Link } from "../router.jsx";
import { usePirate } from "../state/PirateProvider.jsx";

type Phase = "idle" | "starting" | "playing" | "waiting" | "result";
type Outcome =
  | { kind: "rated"; result: PuzzleResult }
  | { kind: "rejected"; reason: string }
  | { kind: "unrated"; score: number; moves: number; bestCombo: number };

const bilging = content.puzzles.bilging;
const MARKS_KEY = "openseas.markTiles";

function readMarks(): boolean {
  try {
    return window.localStorage.getItem(MARKS_KEY) === "1";
  } catch {
    return false;
  }
}

export function BilgingPractice() {
  const { pirate, socket, socketStatus, setPirate } = usePirate();
  const [phase, setPhase] = useState<Phase>("idle");
  const [state, setState] = useState<BilgingState | null>(null);
  const [report, setReport] = useState<MoveReport | null>(null);
  const [version, setVersion] = useState(0);
  const [timeLeft, setTimeLeft] = useState(bilging.roundSeconds);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showMarks, setShowMarks] = useState(readMarks);
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
          if (rep) {
            if (rep.points > 0) {
              const special = rep.rounds.some((x) => x.groups.some((g) => g.cause !== "match"));
              if (special) sfx.special();
              sfx.clear(rep.rounds.length);
            } else sfx.swap();
          }
        },
        onFinished: () => {
          sfx.end();
          if (rated) setPhase("waiting");
          else {
            const s = round.current?.state;
            if (s) setOutcome({ kind: "unrated", score: s.score, moves: s.moveCount, bestCombo: s.bestCombo });
            setPhase("result");
          }
        },
      });
      round.current = r;
      sessionId.current = rated?.sessionId ?? null;
      setOutcome(null);
      setPhase("playing");
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
          case "puzzle.result":
            if (m.sessionId !== sessionId.current) return;
            setOutcome({ kind: "rated", result: m });
            setPhase("result");
            if (pirate) {
              const others = pirate.ratings.filter((r) => r.puzzle !== m.rating.puzzle);
              setPirate({ ...pirate, ratings: [...others, m.rating] });
            }
            break;
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

  // Round clock.
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => {
      const r = round.current;
      if (!r) return;
      const left = Math.max(0, Math.ceil((r.opts.deadlineAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) r.finish();
    }, 200);
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

  const playing = phase === "playing";
  const waterPct = state ? Math.round((state.waterRow / state.config.height) * 100) : 0;

  return (
    <main className="page puzzle">
      <header className="puzzle-bar">
        <Link to="/" className="back" aria-label="Back">
          ←
        </Link>
        <h1 className="puzzle-title">{t("bilging.title")}</h1>
        <span className={`pip ${socketStatus === "open" ? "pip-live" : "pip-off"}`} title={socketStatus}>
          {socketStatus === "open" ? t("app.connected") : socketStatus === "connecting" ? t("app.connecting") : t("app.offline")}
        </span>
      </header>

      <section className="hud" aria-live="off">
        <div className="stat">
          <span className="stat-label">{t("bilging.score")}</span>
          <span className="stat-value" data-testid="hud-score">
            {state?.score ?? 0}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("bilging.time")}</span>
          <span className={`stat-value ${playing && timeLeft <= 10 ? "urgent" : ""}`} data-testid="hud-time">
            {fmt(playing ? timeLeft : bilging.roundSeconds)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("bilging.moves")}</span>
          <span className="stat-value" data-testid="hud-moves">
            {state?.moveCount ?? 0}
            <small>/{bilging.config.maxMoves}</small>
          </span>
        </div>
        <div className="stat stat-wide">
          <span className="stat-label">{t("bilging.combo")}</span>
          <span className="combo-meter" aria-label={t("bilging.combo_label", { count: state?.combo ?? 0 })}>
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} className={i < Math.min(8, state?.combo ?? 0) ? "lit" : ""} />
            ))}
            <b data-testid="hud-combo">{state?.combo ? t("bilging.combo_label", { count: state.combo }) : ""}</b>
          </span>
        </div>
        <div className="stat stat-wide">
          <span className="stat-label">{t("bilging.water")}</span>
          <span className="water-meter">
            <i style={{ width: `${waterPct}%` }} />
          </span>
        </div>
      </section>

      <section className="board-wrap">
        <BilgingBoard state={state} report={report} version={version} interactive={playing} showMarks={showMarks} onSwap={onSwap} preview={preview} onFrame={onFrame} />

        {phase !== "playing" && (
          <div className="board-veil">
            {phase === "idle" && (
              <div className="veil-card">
                <p className="how">{t("bilging.how_to")}</p>
                <p className="how how-kbd">{t("bilging.how_to_keyboard")}</p>
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
            {phase === "starting" && <p className="status">{t("app.connecting")}</p>}
            {phase === "waiting" && <p className="status">{t("bilging.waiting_result")}</p>}
            {phase === "result" && outcome && (
              <div className="veil-card" data-testid="result">
                <h2>{t("bilging.round_over")}</h2>
                <ResultBody outcome={outcome} />
                <div className="stack">
                  <button className="btn btn-brass" onClick={canRate ? startRated : startUnrated} data-testid="restart">
                    {t("bilging.restart")}
                  </button>
                  <Link to="/" className="btn btn-ghost">
                    ←
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <aside className="legend">
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
      </aside>
    </main>
  );
}

function ResultBody({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "rejected") return <p className="error">{t("bilging.result_rejected", { reason: t(`bilging.reject.${outcome.reason}`) })}</p>;
  if (outcome.kind === "unrated") {
    return (
      <>
        <p className="big">{t("bilging.result_score", { score: outcome.score, moves: outcome.moves })}</p>
        <p>{t("bilging.result_best_combo", { combo: outcome.bestCombo })}</p>
        <p className="muted">{t("bilging.result_unrated")}</p>
      </>
    );
  }
  const r = outcome.result;
  return (
    <>
      <p className="big">{t("bilging.result_score", { score: r.score, moves: r.moves })}</p>
      <p>{t("bilging.result_best_combo", { combo: r.bestCombo })}</p>
      <p className="muted">{r.verified ? t("bilging.result_verified") : t("bilging.result_unverified")}</p>
      <p className="tier-line">{t(`bilging.tier_${r.tierChange}`, { tier: t(`tier.${r.rating.tier}`) })}</p>
    </>
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
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="4" fill={color} stroke={special ? "#d4a548" : "none"} strokeWidth="1" />
      {special ? specialBody : markBody}
    </svg>
  );
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
