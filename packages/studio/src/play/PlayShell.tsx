import { useCallback, useEffect, useState } from "react";
import type { PuzzleId } from "@openseas/engine";
import { isMuted, setMuted, t, useTierPace } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { formatNumber } from "../frame/numbers.js";
import { ComboMeter, CoreStats } from "../practice/Hud.jsx";
import { ResultScore, type ShellProps } from "../practice/PracticeShell.jsx";
import { localSeed } from "../practice/usePractice.js";

/**
 * A puzzle with nothing around it (ADR 0042 decision 11): one bar of HUD, the board, a start card
 * and a result card, and a sheet that says which seed is on the board and which numbers differ
 * from the shipped ones. No way back to the studio, no sign-in, no round sent anywhere. If the
 * current build refuses the link's numbers, the page says so and deals nothing.
 */
export function PlayShell(p: ShellProps) {
  const frame = useFrame();
  const { scenario, setScenario, numbers, refusals, changes, report } = frame;
  const [muted, setMutedState] = useState(isMuted);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [splash, setSplash] = useState(0);
  const playing = p.phase === "playing";
  const idle = p.phase === "idle";
  const refused = refusals.length > 0;
  // Between rounds the page still knows the content length; the tuned one is what the next round runs.
  const shown: ShellProps = idle ? { ...p, roundSeconds: numbers.roundSeconds, timeLeft: numbers.roundSeconds } : p;
  const lowTime = playing && p.timeLeft <= 10;
  const pace = useTierPace({ puzzle: p.puzzle as PuzzleId, points: p.pacePoints ?? p.score, playing, elapsed: p.roundSeconds - p.timeLeft, project: p.paceProject, numbers });

  useEffect(() => {
    if (playing) setSplash((n) => n + 1);
  }, [playing]);

  const toggleMute = useCallback(() => {
    setMuted(!isMuted());
    setMutedState(isMuted());
  }, []);
  const start = useCallback(
    (seed?: string) => {
      setSheetOpen(false);
      p.onStartLab?.(seed);
    },
    [p],
  );
  /** A fresh deal, and the link's own seed let go so the next round is fresh too. */
  const newSeed = useCallback(() => {
    if (scenario.seed !== null) setScenario({ ...scenario, seed: null });
    start(localSeed());
  }, [scenario, setScenario, start]);

  const seed = report.seed ?? scenario.seed;
  const outcome = p.phase === "result" && p.outcome && p.outcome.kind !== "rejected" && p.outcome.kind !== "recorded" ? p.outcome : null;

  return (
    <main className="page puzzle puzzle-compact play" data-testid="play">
      <header className="puzzle-bar puzzle-bar-compact play-bar">
        <section className="hud-strip" aria-live="off">
          <CoreStats p={shown} wide={false} pace={pace} lowTime={lowTime} />
        </section>
        <button
          className={`icon-btn details-btn ${p.warn && playing ? "warn" : ""}`}
          onClick={() => setSheetOpen((o) => !o)}
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? t("practice.details_hide") : t("practice.details_show")}
          data-testid="toggle-details"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d={sheetOpen ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
          </svg>
          {changes.length > 0 && <i className="dot play-dot" aria-hidden="true" />}
        </button>
        <button className="icon-btn" onClick={toggleMute} aria-label={muted ? t("app.unmute") : t("app.mute")} aria-pressed={muted} data-testid="toggle-sound">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
            {muted ? <path d="M16 9.5l5 5m0-5l-5 5" /> : <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />}
          </svg>
        </button>
      </header>

      <section className={`board-wrap ${lowTime ? "low-time" : ""} ${playing ? "is-playing" : ""}`}>
        {!refused && p.board(playing && !sheetOpen)}
        {playing && splash > 0 && (
          <div className="splash" key={splash} aria-hidden="true">
            {p.splash}
          </div>
        )}

        {refused && (
          <div className="board-veil">
            <div className="veil-card" data-testid="play-refused">
              <p className="eyebrow">{t(`${p.puzzle}.title`)}</p>
              <h2>{t("play.refused_title")}</h2>
              <p className="how">{t("play.refused")}</p>
              <ul className="play-list">
                {refusals.map((r, i) => (
                  <li key={i}>
                    <code>{r.key}</code> {r.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {!refused && !playing && (
          <div className="board-veil">
            {idle && (
              <div className="veil-card">
                <p className="eyebrow">{p.eyebrow ?? t("practice.eyebrow")}</p>
                <h2>{t(`${p.puzzle}.title`)}</h2>
                {p.art}
                <p className="how">{t(`${p.puzzle}.how_to`)}</p>
                {t(`${p.puzzle}.how_to_keyboard`) !== "" && <p className="how how-kbd">{t(`${p.puzzle}.how_to_keyboard`)}</p>}
                {p.howTo}
                {changes.length > 0 && (
                  <p className="note" data-testid="play-tuned">
                    {t("play.tuned", { count: changes.length })}
                  </p>
                )}
                <div className="stack">
                  <button className="btn btn-brass" onClick={() => start()} data-testid="play-start">
                    {t("play.start")}
                  </button>
                </div>
              </div>
            )}
            {outcome && (
              <div className="veil-card" data-testid="result">
                <p className="eyebrow">{t("practice.round_over")}</p>
                {p.resultHeadline}
                <p className="result-tier" data-testid="result-tier" data-tier={outcome.performance.tier}>
                  {t("practice.round_tier", { tier: t(`tier.${outcome.performance.tier}`) })}
                </p>
                <ResultScore score={outcome.score} />
                <dl className="result-stats">
                  <div>
                    <dt>{t("practice.moves")}</dt>
                    <dd>{outcome.moves}</dd>
                  </div>
                  <div>
                    <dt>{t("practice.best_combo")}</dt>
                    <dd>{outcome.bestCombo}</dd>
                  </div>
                  {p.resultRows}
                </dl>
                {report.replayMismatch && (
                  <p className="error" data-testid="replay-mismatch">
                    {t("play.replay_mismatch")}
                  </p>
                )}
                <div className="stack">
                  <button className="btn btn-brass" onClick={() => start()} data-testid="restart">
                    {t("practice.restart")}
                  </button>
                  {scenario.seed !== null && (
                    <button className="btn btn-ghost" onClick={newSeed} data-testid="result-new-seed">
                      {t("play.new_seed")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {sheetOpen && (
          <>
            <button className="hud-scrim" aria-label={t("practice.details_hide")} onClick={() => setSheetOpen(false)} />
            <div className="hud-panel play-sheet" data-testid="hud-panel">
              {!refused && (
                <section className="play-round">
                  <p className="play-seed" data-testid="play-seed">
                    {seed ? t("play.seed", { seed }) : t("play.seed_fresh")}
                  </p>
                  <div className="play-actions">
                    <button className="btn btn-mini" onClick={() => start(seed ?? undefined)} data-testid="play-restart">
                      {t("play.restart")}
                    </button>
                    <button className="btn btn-mini" onClick={newSeed} data-testid="play-new-seed">
                      {t("play.new_seed")}
                    </button>
                  </div>
                </section>
              )}
              <section className="play-changes" data-testid="play-changes">
                <span className="stat-label">{t("play.changes_title")}</span>
                {changes.length === 0 ? (
                  <p className="muted small">{refused ? t("play.refused") : t("play.changes_none")}</p>
                ) : (
                  <ul className="play-list">
                    {changes.map((c) => (
                      <li key={c.key} data-key={c.key}>
                        <code>{c.key}</code> <b>{formatNumber(c.key, c.value)}</b> <span className="muted">{t("play.shipped", { value: formatNumber(c.key, c.shipped) })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {!refused && (
                <>
                  <ComboMeter combo={p.combo} />
                  {p.details}
                  <div className="legend legend-inline">{p.legend}</div>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
