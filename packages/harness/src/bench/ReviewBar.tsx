import { t } from "@openseas/boards";
import type { Replay } from "../review/replay.js";
import { describeMove } from "./format.js";

export interface ReviewBarProps<S, M> {
  replay: Replay<S, M>;
  index: number;
  onIndex(index: number): void;
  onExit(): void;
}

/** Steps through a replayed log on the board: the opening at 0, then the state after each move. */
export function ReviewBar<S, M>({ replay, index, onIndex, onExit }: ReviewBarProps<S, M>) {
  const total = replay.steps.length;
  const step = index > 0 ? (replay.steps[index - 1] ?? null) : null;
  const diverged = step !== null && replay.divergedAt !== null && step.seq >= replay.divergedAt;
  const refusedNext = replay.error !== null && index === total;
  return (
    <>
      <div className="review-controls">
        <span className="eyebrow">{t("harness.review")}</span>
        <button type="button" className="btn btn-mini" onClick={() => onIndex(0)} disabled={index === 0} aria-label={t("harness.review_start")}>
          «
        </button>
        <button type="button" className="btn btn-mini" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label={t("harness.review_prev")} data-testid="review-prev">
          ‹
        </button>
        <input type="range" min={0} max={total} value={index} onChange={(e) => onIndex(Number(e.target.value))} aria-label={t("harness.review_step", { index, total })} data-testid="review-slider" />
        <button type="button" className="btn btn-mini" onClick={() => onIndex(index + 1)} disabled={index >= total} aria-label={t("harness.review_next")} data-testid="review-next">
          ›
        </button>
        <button type="button" className="btn btn-mini" onClick={() => onIndex(total)} disabled={index >= total} aria-label={t("harness.review_end")}>
          »
        </button>
        <b className="mono" data-testid="review-index">
          {t("harness.review_step", { index, total })}
        </b>
        <button type="button" className="btn btn-brass btn-mini" onClick={onExit} data-testid="review-exit">
          {t("harness.review_exit")}
        </button>
      </div>
      <p className={`review-line mono ${diverged ? "is-bad" : ""}`} data-testid="review-line">
        {step ? t("harness.review_move", { seq: step.seq, move: describeMove(step.move) }) : t("harness.review_opening")} · {step ? step.hash : replay.initialHash}
        {diverged && ` · ${t("harness.review_diverged_here")}`}
        {refusedNext && ` · ${t("harness.review_refused_here", { seq: replay.error!.atSeq })}`}
      </p>
    </>
  );
}
