import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PuzzleId } from "@openseas/engine";
import { SpriteIcon, auditionCue, isSpritePuzzle, overrideSample, overrideSprite, sampleCues, spriteFrames, t } from "@openseas/boards";
import { OWN_CUE_FALLBACKS, cuesOf } from "./cues.js";
import { fitFrame } from "./fit.js";

/** A file the owner is trying in a frame's or a cue's place: its name, and for a frame the fitted picture's object URL. */
interface Tried {
  readonly name: string;
  readonly url: string | null;
}

/** A button that opens a file picker and hands back the file chosen. */
function FileButton({ accept, label, testId, onFile }: { accept: string; label: string; testId: string; onFile(file: File): void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn btn-mini" onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
        data-testid={testId}
      />
    </>
  );
}

/**
 * The sprite panel (DESIGN.md 3.14, ADR 0050): every frame in the puzzle's atlas, at the size a
 * board draws it and larger, and the page's own legend, which shows each kind with the marks
 * setting on or off (rule 6). A file can be tried in a frame's place: the board is made again
 * with it, at once. Nothing here is kept or sent anywhere; takes and picks follow.
 */
export function SpritePanel({ puzzle, legend, active }: { puzzle: PuzzleId; legend: ReactNode; active: boolean }) {
  const [tried, setTried] = useState<Readonly<Record<string, Tried>>>({});
  const [bad, setBad] = useState<string | null>(null);
  const held = useRef(tried);
  held.current = tried;
  const atlas = isSpritePuzzle(puzzle) ? puzzle : null;

  // Leaving the page puts every frame back: a tried file belongs to the page it was tried on.
  useEffect(
    () => () => {
      if (!atlas) return;
      for (const [frame, file] of Object.entries(held.current)) {
        void overrideSprite(atlas, frame, null);
        if (file.url) URL.revokeObjectURL(file.url);
      }
    },
    [atlas],
  );

  const tryFile = useCallback(
    async (frame: string, file: File) => {
      if (!atlas) return;
      const url = await fitFrame(file);
      if (!url || !(await overrideSprite(atlas, frame, url))) {
        if (url) URL.revokeObjectURL(url);
        setBad(frame);
        return;
      }
      setBad(null);
      setTried((all) => {
        const was = all[frame]?.url;
        if (was) URL.revokeObjectURL(was);
        return { ...all, [frame]: { name: file.name, url } };
      });
    },
    [atlas],
  );
  const putBack = useCallback(
    (frame: string) => {
      if (!atlas) return;
      void overrideSprite(atlas, frame, null);
      setTried((all) => {
        const { [frame]: was, ...rest } = all;
        if (was?.url) URL.revokeObjectURL(was.url);
        return rest;
      });
    },
    [atlas],
  );

  if (!atlas) {
    return (
      <div className="tune assets" data-testid="sprites">
        <p className="muted small">{t("studio.sprites.none")}</p>
      </div>
    );
  }
  const frames = spriteFrames(atlas);
  return (
    <div className="tune assets" data-testid="sprites">
      <section className="tune-group">
        <p className="tune-desc">{t("studio.sprites.intro", { count: frames.length })}</p>
        <p className="tune-desc">{t("studio.assets.local_note")}</p>
      </section>
      {/* The legend carries the page's marks toggle, whose test id the details sheet has too: only one of them is in the page at a time. */}
      {active && (
        <section className="tune-group asset-legend" data-testid="sprite-legend">
          <p className="stat-label">{t("studio.sprites.legend")}</p>
          <div className="legend legend-inline">{legend}</div>
        </section>
      )}
      <section className="tune-group">
        {frames.map((frame) => {
          const file = tried[frame];
          return (
            <div key={frame} className={`tune-row asset-row ${file ? "is-changed" : ""}`} data-testid={`frame-${frame}`} data-tried={file ? "1" : "0"}>
              <div className="asset-views" aria-hidden="true">
                <span className="asset-view asset-view-board">
                  <SpriteIcon puzzle={atlas} name={frame} size={44} fallback={null} />
                </span>
                <span className="asset-view">
                  <SpriteIcon puzzle={atlas} name={frame} size={96} fallback={null} />
                </span>
              </div>
              <div className="asset-body">
                <code className="tune-key mono">{frame}</code>
                <p className="tune-desc" data-testid={`frame-pick-${frame}`}>
                  {file ? t("studio.assets.tried", { name: file.name }) : t("studio.sprites.shipped")}
                </p>
                <div className="tune-actions">
                  <FileButton accept="image/png,image/webp" label={t("studio.assets.try_file")} testId={`frame-file-${frame}`} onFile={(f) => void tryFile(frame, f)} />
                  {file && (
                    <button type="button" className="btn btn-mini" onClick={() => putBack(frame)} data-testid={`frame-back-${frame}`}>
                      {t("studio.assets.put_back")}
                    </button>
                  )}
                </div>
                {bad === frame && <p className="tune-refusal">{t("studio.assets.file_bad")}</p>}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** Which voice a cue plays in: the build's own (its sample, or the synthesized cue where it has none), the synthesized cue over a sample, or a file being tried. */
type Voice = "shipped" | "synth" | "file";

/**
 * The sound panel (DESIGN.md 3.14, ADR 0050): every cue the puzzle's board plays, each played on
 * a tap in the voice the board would use. The synthesized cue is always a pick (ADR 0041), a
 * bundled sample is one where the puzzle has it, and a file can be tried in a cue's place: the
 * running board plays it from then on. Nothing here is kept or sent anywhere.
 */
export function SoundPanel({ puzzle }: { puzzle: PuzzleId }) {
  const [voices, setVoices] = useState<Readonly<Record<string, Voice>>>({});
  const [files, setFiles] = useState<Readonly<Record<string, string>>>({});
  const [bad, setBad] = useState<string | null>(null);
  const held = useRef(voices);
  held.current = voices;
  const sampled = new Set(sampleCues(puzzle));
  const fallbacks = OWN_CUE_FALLBACKS[puzzle] ?? {};

  useEffect(
    () => () => {
      for (const cue of Object.keys(held.current)) void overrideSample(puzzle, cue, null);
    },
    [puzzle],
  );

  const choose = useCallback(
    async (cue: string, voice: Voice, file?: File) => {
      let ok: boolean;
      if (voice === "file" && file) {
        const url = URL.createObjectURL(file);
        ok = await overrideSample(puzzle, cue, url);
        URL.revokeObjectURL(url);
        if (ok) setFiles((all) => ({ ...all, [cue]: file.name }));
      } else ok = await overrideSample(puzzle, cue, voice === "synth" ? "synth" : null);
      setBad(ok ? null : cue);
      if (ok) setVoices((all) => ({ ...all, [cue]: voice }));
    },
    [puzzle],
  );

  return (
    <div className="tune assets" data-testid="sounds">
      <section className="tune-group">
        <p className="tune-desc">{t("studio.sounds.intro")}</p>
        <p className="tune-desc">{t("studio.assets.local_note")}</p>
      </section>
      <section className="tune-group">
        {cuesOf(puzzle).map((cue) => {
          const has = sampled.has(cue);
          // With no sample bundled, the build's own voice is the synthesized cue.
          const voice: Voice = voices[cue] === "synth" && !has ? "shipped" : (voices[cue] ?? "shipped");
          const pick = (v: Voice, label: string): ReactNode => (
            <button type="button" className={`btn btn-mini ${voice === v ? "is-held" : ""}`} aria-pressed={voice === v} onClick={() => void choose(cue, v)} data-testid={`cue-${v}-${cue}`}>
              {label}
            </button>
          );
          return (
            <div key={cue} className={`tune-row asset-row ${voice === "shipped" ? "" : "is-changed"}`} data-testid={`cue-${cue}`} data-voice={voice === "shipped" ? (has ? "sample" : "synth") : voice}>
              <button
                type="button"
                className="icon-btn asset-play"
                onClick={() => auditionCue(puzzle, cue, { fallback: fallbacks[cue] ?? [] })}
                aria-label={t("studio.sounds.play", { cue })}
                data-testid={`cue-play-${cue}`}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
                </svg>
              </button>
              <div className="asset-body">
                <code className="tune-key mono">{cue}</code>
                {fallbacks[cue] && <p className="tune-desc">{t("studio.sounds.own", { fallback: fallbacks[cue].join(" + ") })}</p>}
                <div className="tune-actions">
                  {has ? (
                    <>
                      {pick("shipped", t("studio.sounds.sample"))}
                      {pick("synth", t("studio.sounds.synth"))}
                    </>
                  ) : (
                    pick("shipped", t("studio.sounds.synth"))
                  )}
                  <FileButton accept="audio/mpeg,audio/wav,.mp3,.wav" label={t("studio.assets.try_file")} testId={`cue-file-${cue}`} onFile={(f) => void choose(cue, "file", f)} />
                </div>
                {voice === "file" && (
                  <p className="tune-desc" data-testid={`cue-file-name-${cue}`}>
                    {t("studio.assets.tried", { name: files[cue] ?? "" })}
                  </p>
                )}
                {bad === cue && <p className="tune-refusal">{t("studio.assets.file_bad")}</p>}
              </div>
            </div>
          );
        })}
      </section>
      <p className="muted small">{t("studio.sounds.file_note")}</p>
    </div>
  );
}
