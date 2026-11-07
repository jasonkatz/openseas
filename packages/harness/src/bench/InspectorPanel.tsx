import { useEffect, useState } from "react";
import { t, type LoggedMove } from "@openseas/boards";
import type { PracticeApi, PracticeOutcome, RoundInfo } from "../practice/usePractice.js";
import type { HarnessPuzzle } from "../puzzles.js";
import type { Replay } from "../review/replay.js";
import { diffConfig } from "../scenario/overrides.js";
import { copyText, describeMove, valueToText } from "./format.js";

export interface InspectorPanelProps<S, M, C> {
  puzzle: HarnessPuzzle<S, M, C>;
  api: PracticeApi<S, M, C>;
  /** The state being shown: the live one, or the reviewed one. */
  shown: S;
  shownHash: string;
  /** Replay-from-seed of the finished round, when it has run. */
  check: Replay<S, M> | null;
  onExport(): void;
  onReview(): void;
  onReviewAt(index: number): void;
  onStop(): void;
  onClear(): void;
}

const MODE_KEY: Record<RoundInfo<unknown>["mode"], string> = { recorded: "harness.round_mode_recorded", unrated: "harness.round_mode_unrated", lab: "harness.round_mode_lab" };

/** What the engine holds right now, what differs from content, the move log, and the round's checks. */
export function InspectorPanel<S, M, C>(p: InspectorPanelProps<S, M, C>) {
  const { puzzle, api, shown, check } = p;
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  const summary = puzzle.def.summarize(shown);
  const s = shown as { combo?: number; tick?: number };
  const round = api.round;
  const diff = round ? diffConfig(puzzle.config, round.config) : {};
  const playing = api.phase === "playing";
  const canReview = !playing && api.log.length > 0;

  return (
    <>
      <section className="bench-section" data-testid="round-panel">
        <h3>{t("harness.round")}</h3>
        {round ? (
          <dl className="bench-dl">
            <div>
              <dt>{t("harness.round_mode")}</dt>
              <dd data-testid="round-mode">{t(MODE_KEY[round.mode])}</dd>
            </div>
            <div>
              <dt>{t("harness.seed")}</dt>
              <dd className="mono" data-testid="round-seed">
                {round.seed}
              </dd>
            </div>
            {round.sessionId && (
              <div>
                <dt>{t("harness.round_session")}</dt>
                <dd className="mono">{round.sessionId}</dd>
              </div>
            )}
            <div>
              <dt>{t("harness.seconds")}</dt>
              <dd>{round.roundSeconds}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted small">{t("harness.round_none")}</p>
        )}
        <div className="bench-actions">
          {playing && (
            <button type="button" className="btn btn-mini" onClick={p.onStop} data-testid="stop-round">
              {t("harness.round_stop")}
            </button>
          )}
          {api.log.length > 0 && (
            <button
              type="button"
              className="btn btn-mini"
              onClick={() => {
                p.onExport();
                setCopied(t("harness.copied"));
              }}
              data-testid="round-export"
            >
              {copied ?? t("harness.round_export")}
            </button>
          )}
          {canReview && (
            <button type="button" className="btn btn-mini" onClick={p.onReview} data-testid="round-review">
              {t("harness.round_review")}
            </button>
          )}
          {!playing && round && (
            <button type="button" className="btn btn-ghost btn-mini" onClick={p.onClear} data-testid="round-clear">
              {t("harness.round_reset")}
            </button>
          )}
        </div>
      </section>

      <section className="bench-section" data-testid="inspector">
        <h3>{t("harness.inspector")}</h3>
        <p className="small" data-testid="inspector-summary">
          {t("harness.inspector_summary", { score: summary.score, moves: summary.moves, combo: s.combo ?? 0, bestCombo: summary.bestCombo })}
          {typeof s.tick === "number" && ` · ${t("harness.inspector_tick", { tick: s.tick })}`}
        </p>
        <p className="small mono">
          {t("harness.inspector_hash")} <b data-testid="inspector-hash">{p.shownHash}</b>
        </p>
        {Object.keys(diff).length > 0 && (
          <details className="bench-details" open>
            <summary>{t("harness.inspector_diff", { count: Object.keys(diff).length })}</summary>
            <ul className="config-diff mono small" data-testid="inspector-diff">
              {Object.entries(diff).map(([path, value]) => (
                <li key={path}>
                  {path} = {valueToText(value)}
                </li>
              ))}
            </ul>
          </details>
        )}
        <details className="bench-details">
          <summary>{t("harness.inspector_state")}</summary>
          <button type="button" className="btn btn-ghost btn-mini" onClick={() => void copyText(JSON.stringify(shown, null, 2))}>
            {t("harness.inspector_state_copy")}
          </button>
          <pre className="bench-pre" data-testid="inspector-state">
            {JSON.stringify(shown, null, 1)}
          </pre>
        </details>
        <details className="bench-details" open>
          <summary>{t("harness.inspector_log", { count: api.log.length })}</summary>
          {api.log.length === 0 ? (
            <p className="muted small">{t("harness.inspector_log_empty")}</p>
          ) : (
            <>
              <p className="muted small">{t("harness.inspector_log_hint")}</p>
              <LogList log={api.log} canJump={canReview} onJump={p.onReviewAt} divergedAt={check?.divergedAt ?? null} />
            </>
          )}
        </details>
      </section>

      <section className="bench-section" data-testid="checks">
        <h3>{t("harness.checks")}</h3>
        <ReplayCheck check={check} phase={api.phase} logLength={api.log.length} />
        <ServerCheck outcome={api.outcome} phase={api.phase} local={summary.score} round={round} />
      </section>
    </>
  );
}

function LogList<M>({ log, canJump, onJump, divergedAt }: { log: readonly LoggedMove<M>[]; canJump: boolean; onJump(index: number): void; divergedAt: number | null }) {
  // The newest moves matter most while playing; the list scrolls, newest last, and is capped for the DOM's sake.
  const cap = 400;
  const start = Math.max(0, log.length - cap);
  const slice = log.slice(start);
  return (
    <ol className="move-log mono small" start={start} data-testid="inspector-log">
      {start > 0 && <li className="muted">…</li>}
      {slice.map((m) => (
        <li key={m.seq} className={divergedAt !== null && m.seq >= divergedAt ? "is-bad" : ""}>
          {canJump ? (
            <button type="button" onClick={() => onJump(m.seq + 1)}>
              {describeMove(m.move)} <span className="muted">{m.hash}</span>
            </button>
          ) : (
            <span>
              {describeMove(m.move)} <span className="muted">{m.hash}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function ReplayCheck<S, M>({ check, phase, logLength }: { check: Replay<S, M> | null; phase: string; logLength: number }) {
  if (!check) {
    return (
      <p className="small muted" data-testid="check-replay">
        {phase === "playing" || logLength === 0 ? t("harness.check_replay_pending") : t("harness.check_replay_pending")}
      </p>
    );
  }
  if (check.error) {
    return (
      <p className="small error" data-testid="check-replay" data-outcome="illegal">
        {t("harness.check_replay_illegal", { seq: check.error.atSeq, message: check.error.message })}
      </p>
    );
  }
  if (check.divergedAt !== null) {
    return (
      <p className="small error" data-testid="check-replay" data-outcome="diverged">
        {t("harness.check_replay_diverged", { seq: check.divergedAt })}
      </p>
    );
  }
  return (
    <p className="small ok" data-testid="check-replay" data-outcome="ok">
      {t("harness.check_replay_ok", { count: check.steps.length })}
    </p>
  );
}

function ServerCheck({ outcome, phase, local, round }: { outcome: PracticeOutcome | null; phase: string; local: number; round: RoundInfo<unknown> | null }) {
  if (!round || round.mode !== "recorded") return null;
  if (phase === "waiting") return <p className="small muted">{t("harness.check_server_waiting")}</p>;
  if (!outcome) return null;
  if (outcome.kind === "rejected") {
    return (
      <p className="small error" data-testid="check-server">
        {t("harness.check_server_rejected", { reason: t(`practice.reject.${outcome.reason}`) })}
      </p>
    );
  }
  if (outcome.kind !== "recorded") return null;
  const same = outcome.result.score === local && outcome.result.verified;
  return (
    <p className={`small ${same ? "ok" : "error"}`} data-testid="check-server">
      {same ? t("harness.check_server_verified", { score: outcome.result.score }) : t("harness.check_server_differs", { score: outcome.result.score, local })}
    </p>
  );
}
