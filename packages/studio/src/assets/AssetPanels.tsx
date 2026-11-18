import type { PuzzleId } from "@openseas/engine";
import { auditionCue, t } from "@openseas/boards";
import { OWN_CUE_FALLBACKS, cuesOf } from "./cues.js";

/**
 * The Sounds list (DESIGN.md 3.14, ADR 0062 decision 5): every cue the puzzle's board plays, each
 * with a button that plays it as the board would, in its synthesized voice. It is a list to
 * listen to and nothing more: there is no sample to pick, no take and no file to try, and nothing
 * here is part of a draft. A cue is changed in `boards/src/cues.ts`, in a pull request.
 */
export function SoundPanel({ puzzle }: { puzzle: PuzzleId }) {
  const fallbacks = OWN_CUE_FALLBACKS[puzzle] ?? {};
  const cues = cuesOf(puzzle);
  return (
    <div className="tune assets" data-testid="sounds">
      <section className="panel-sec">
        <h3 className="panel-cap">{t("studio.sounds.cues", { count: cues.length })}</h3>
        {cues.map((cue) => (
          <div key={cue} className="cue" data-testid={`cue-${cue}`}>
            <div className="cue-head">
              <button type="button" className="cue-play" onClick={() => auditionCue(cue, fallbacks[cue])} aria-label={t("studio.sounds.play", { cue })} data-testid={`cue-play-${cue}`}>
                <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                  <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
                </svg>
              </button>
              <span className="cue-name">
                <code className="mono">{cue}</code>
                {/* A puzzle's own cue has no voice of its name: it says which cues it plays. */}
                {fallbacks[cue] && <span className="cue-voice">{t("studio.sounds.own", { fallback: fallbacks[cue].join(" + ") })}</span>}
              </span>
            </div>
          </div>
        ))}
      </section>
      <p className="panel-note panel-foot">{t("studio.sounds.note")}</p>
    </div>
  );
}
