import { useState } from "react";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { formatNumber } from "../frame/numbers.js";
import { numbersOf, sameNumbers, scoreDelta, type PlayedRound } from "../frame/rounds.js";
import { humanize } from "./modes.js";

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;
/** How many changed numbers a round shows before it says how many more. */
const SHOWN_CHANGES = 4;

const BASELINE_KEY = (puzzle: string): string => `openseas.studio.baseline.${puzzle}`;
function readBaseline(puzzle: string): number | null {
  try {
    const n = Number(window.sessionStorage.getItem(BASELINE_KEY(puzzle)));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function writeBaseline(puzzle: string, id: number | null): void {
  try {
    if (id === null) window.sessionStorage.removeItem(BASELINE_KEY(puzzle));
    else window.sessionStorage.setItem(BASELINE_KEY(puzzle), String(id));
  } catch {
    /* private mode */
  }
}

/**
 * The rounds finished on this page, newest first (DESIGN.md 3.14, ADR 0068): the main thing in the
 * Play panel. Each says how it went, how its score stands against the round before or against the
 * one picked as the baseline, and which numbers it was dealt on; it can be played again on its
 * seed, and its numbers laid back over the draft once the owner says so.
 */
export function RoundList({ onStart, ready }: { onStart(seed?: string): void; ready: boolean }) {
  const { puzzle, rounds } = useFrame();
  const [baseline, setBaselineState] = useState<number | null>(() => readBaseline(puzzle.id));
  // A baseline that fell off the end of the list measures nothing.
  const base = baseline !== null && rounds.some((r) => r.id === baseline) ? baseline : null;
  const setBaseline = (id: number | null): void => {
    setBaselineState(id);
    writeBaseline(puzzle.id, id);
  };

  return (
    <section className="panel-sec" data-testid="last-rounds">
      <h3 className="panel-cap">{t("studio.rounds")}</h3>
      {rounds.length === 0 ? (
        <p className="panel-note">{t("studio.rounds_none")}</p>
      ) : (
        <>
          <p className="panel-note">{t("studio.rounds_note")}</p>
          <ol className="rounds">
            {[...rounds].reverse().map((r) => (
              <RoundRow key={r.id} round={r} delta={scoreDelta(rounds, r.id, base)} measured={base !== null && base !== r.id ? "base" : "prev"} isBase={base === r.id} onBase={() => setBaseline(base === r.id ? null : r.id)} onStart={onStart} ready={ready} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function RoundRow({ round, delta, measured, isBase, onBase, onStart, ready }: { round: PlayedRound; delta: number | null; measured: "base" | "prev"; isBase: boolean; onBase(): void; onStart(seed?: string): void; ready: boolean }) {
  const { puzzle, scenario, setScenario } = useFrame();
  const [asking, setAsking] = useState(false);
  const r = round.summary;
  const already = sameNumbers(numbersOf(scenario), round.numbers);
  const stage = round.numbers.stage;
  const more = round.changes.length - SHOWN_CHANGES;
  const drafted = round.changes.length > 0;
  return (
    <li className={`round ${isBase ? "is-base" : ""}`} data-testid="last-round" data-tuned={r.tuned ? "1" : "0"} data-round={round.id}>
      <div className="round-line">
        <b className="mono round-score">{r.score}</b>
        <span>{r.tier ? t(`tier.${r.tier}`) : ""}</span>
        {/* A draft that changes nothing plays the shipped numbers: the tag says what was played, not what was held. */}
        <span className={`round-tag ${drafted ? "is-draft" : ""}`}>{drafted ? t("studio.rounds_draft") : t("studio.rounds_shipped")}</span>
        <span className="muted mono">{clock(r.seconds)}</span>
        <span className="muted">{t("studio.round.moves", { count: r.moves })}</span>
        {delta !== null && (
          <span className={`mono round-delta ${delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}`} title={measured === "base" ? t("studio.round.against_base") : t("studio.round.against_prev")} data-testid="round-delta">
            {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : "="}
          </span>
        )}
      </div>
      <div className="round-line muted">
        <code className="mono rounds-seed" title={r.seed}>
          {r.seed}
        </code>
        {stage && <span>{t(`${puzzle.id}.stage.${stage}`)}</span>}
        <span>{t("studio.round.combo", { count: round.bestCombo })}</span>
      </div>
      {round.changes.length === 0 ? (
        <p className="round-changes muted">{t("studio.round.shipped_numbers")}</p>
      ) : (
        <ul className="round-changes" data-testid="round-changes">
          {round.changes.slice(0, SHOWN_CHANGES).map((c) => (
            <li key={c.key} title={c.key}>
              {humanize(c.key.split(".").at(-1) ?? c.key)} <span className="mono muted">{formatNumber(c.key, c.shipped)}</span> → <b className="mono">{formatNumber(c.key, c.value)}</b>
            </li>
          ))}
          {more > 0 && <li className="muted">{t("studio.round.more", { count: more })}</li>}
        </ul>
      )}
      {asking ? (
        <div className="round-actions is-asking" data-testid="round-use-ask">
          <span>{t("studio.round.use_confirm")}</span>
          <button
            type="button"
            className="btn btn-mini btn-brass"
            onClick={() => {
              setAsking(false);
              setScenario({ ...scenario, ...round.numbers });
            }}
            data-testid="round-use-yes"
          >
            {t("studio.round.use_yes")}
          </button>
          <button type="button" className="btn btn-mini" onClick={() => setAsking(false)}>
            {t("studio.round.use_no")}
          </button>
        </div>
      ) : (
        <div className="round-actions">
          <button type="button" className="btn btn-mini" disabled={!ready} onClick={() => onStart(r.seed)} data-testid="round-replay">
            {t("studio.round.replay")}
          </button>
          <button type="button" className="btn btn-mini" hidden={already} onClick={() => setAsking(true)} data-testid="round-use">
            {t("studio.round.use")}
          </button>
          <button type="button" className={`btn btn-mini btn-sq ${isBase ? "is-held" : ""}`} aria-pressed={isBase} aria-label={isBase ? t("studio.round.baseline_off") : t("studio.round.baseline")} title={isBase ? t("studio.round.baseline_off") : t("studio.round.baseline")} onClick={onBase} data-testid="round-baseline">
            ★
          </button>
        </div>
      )}
    </li>
  );
}
