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

export function BilgingPractice() {
  const { pirate, socket, socketStatus, setPirate } = usePirate();
  const [phase, setPhase] = useState<Phase>("idle");
  const [state, setState] = useState<BilgingState | null>(null);
  const [report, setReport] = useState<MoveReport | null>(null);
  const [version, setVersion] = useState(0);
  const [timeLeft, setTimeLeft] = useState(bilging.roundSeconds);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
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
        <BilgingBoard state={state} report={report} version={version} interactive={playing} onSwap={onSwap} preview={preview} onFrame={onFrame} />

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
        <h2 className="section-title">{t("bilging.legend")}</h2>
        <ul>
          {bilging.pieces.slice(0, bilging.config.pieceKinds).map((p) => (
            <li key={p.nameKey}>
              <ShapeIcon shape={p.shape} color={p.color} />
              <span>{t(p.nameKey)}</span>
            </li>
          ))}
        </ul>
        <ul className="specials">
          {(["keg", "ink", "barnacle"] as const).map((k) => (
            <li key={k}>
              <ShapeIcon shape={k} color={bilging.specials[k].color} />
              <span>
                <b>{t(bilging.specials[k].nameKey)}</b> {t(`bilging.special.${k}_help`)}
              </span>
            </li>
          ))}
        </ul>
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

function ShapeIcon({ shape, color }: { shape: string; color: string }) {
  const c = color;
  const body = (() => {
    switch (shape) {
      case "circle":
        return <circle cx="12" cy="12" r="8" fill={c} />;
      case "square":
        return <rect x="4" y="4" width="16" height="16" rx="2" fill={c} />;
      case "triangle":
        return <polygon points="12,3 21,19 3,19" fill={c} />;
      case "diamond":
        return <polygon points="12,2 20,12 12,22 4,12" fill={c} />;
      case "hexagon":
        return <polygon points="12,2 20.6,7 20.6,17 12,22 3.4,17 3.4,7" fill={c} />;
      case "star":
        return <polygon points="12,2 14.9,8.6 22,9.3 16.6,14 18.2,21 12,17.3 5.8,21 7.4,14 2,9.3 9.1,8.6" fill={c} />;
      case "gear":
        return (
          <g fill={c}>
            <circle cx="12" cy="12" r="7" />
            {Array.from({ length: 8 }, (_, i) => (
              <rect key={i} x="10.5" y="1" width="3" height="5" transform={`rotate(${i * 45} 12 12)`} />
            ))}
            <circle cx="12" cy="12" r="2.5" fill="#070e1a" />
          </g>
        );
      case "keg":
        return (
          <g>
            <rect x="6" y="5" width="12" height="15" rx="3" fill={c} />
            <rect x="6" y="9" width="12" height="1.5" fill="#d4a548" />
            <rect x="6" y="15" width="12" height="1.5" fill="#d4a548" />
            <circle cx="17" cy="3" r="1.6" fill="#f0604d" />
          </g>
        );
      case "ink":
        return (
          <g fill={c}>
            <circle cx="9" cy="10" r="5.5" />
            <circle cx="15" cy="9" r="5" />
            <circle cx="12" cy="15" r="6" />
          </g>
        );
      case "barnacle":
        return <polygon points="3,20 7,9 10,20 13,5 16,20 18,12 21,20" fill={c} />;
      default:
        return <rect x="4" y="4" width="16" height="16" fill={c} />;
    }
  })();
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {body}
    </svg>
  );
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
