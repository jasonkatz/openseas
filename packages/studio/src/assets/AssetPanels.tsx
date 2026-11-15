import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PuzzleId } from "@openseas/engine";
import type { Take, TakeKind } from "@openseas/protocol";
import { SpriteIcon, auditionCue, isSpritePuzzle, overrideSample, overrideSprite, sampleCues, spriteFrames, t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { TAKES_CHANGED, listTakes, proposeChat, takeUrl } from "../service/client.js";
import { useMe } from "../service/me.js";
import { OWN_CUE_FALLBACKS, cuesOf } from "./cues.js";
import { fitFrame } from "./fit.js";

/** A file the owner is trying in a frame's place: its name, and the fitted picture's object URL. */
interface Tried {
  readonly name: string;
  readonly url: string;
}

/**
 * A puzzle's takes of one kind (ADR 0051), by the frame or cue each is of, oldest first. Only the
 * signed-in owner of a service that keeps takes has any; for anyone else, and with the service
 * down, the panels are as they are without it. Asked for again when a turn of the chat ends.
 */
function useTakes(puzzle: PuzzleId, kind: TakeKind): ReadonlyMap<string, readonly Take[]> {
  const me = useMe();
  const on = me !== "loading" && me !== null && me.login !== null && me.takes;
  const [takes, setTakes] = useState<readonly Take[]>([]);
  useEffect(() => {
    if (!on) return setTakes([]);
    let live = true;
    const load = (): void => void listTakes(puzzle).then((all) => live && all && setTakes(all));
    load();
    window.addEventListener(TAKES_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(TAKES_CHANGED, load);
    };
  }, [on, puzzle]);
  const by = new Map<string, Take[]>();
  for (const take of takes) if (take.kind === kind) by.set(take.name, [...(by.get(take.name) ?? []), take]);
  return by;
}

/** What a take is called on its button: its number where it was made on the open draft, as the agent names it too, else the start of its hash. */
function useTakeName(): (take: Take) => string {
  const { store } = useFrame();
  const draft = store.state === "stored" ? (store.draft?.id ?? null) : null;
  return (take) => (take.take !== null && take.draft === draft ? t("studio.assets.take", { n: take.take }) : t("studio.assets.take_other", { hash: take.hash.slice(0, 6) }));
}

/** The two buttons a row ends with when there is a chat: each writes the start of a message to the agent (DESIGN.md 3.14). */
function AskButtons({ kind, name }: { kind: TakeKind; name: string }) {
  const { store } = useFrame();
  if (store.state !== "stored" || !store.canChat) return null;
  return (
    <>
      <button type="button" className="btn btn-mini" onClick={() => proposeChat(t(`studio.assets.ask_new_${kind}`, { name }))} data-testid={`ask-new-${name}`}>
        {t("studio.assets.ask_new")}
      </button>
      <button type="button" className="btn btn-mini" onClick={() => proposeChat(t(`studio.assets.ask_change_${kind}`, { name }))} data-testid={`ask-change-${name}`}>
        {t("studio.assets.ask_change")}
      </button>
    </>
  );
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
 * The sprite panel (DESIGN.md 3.14, ADR 0050, ADR 0052): every frame in the puzzle's atlas, at the
 * size a board draws it and larger, and the page's own legend, which shows each kind with the
 * marks setting on or off (rule 6). A row lists the takes kept for its frame; a tap picks one,
 * which is the draft's: the frame puts it on the board, at once. A file from the owner's machine
 * can be tried in a frame's place, on this page only.
 */
export function SpritePanel({ puzzle, legend, active }: { puzzle: PuzzleId; legend: ReactNode; active: boolean }) {
  const [tried, setTried] = useState<Readonly<Record<string, Tried>>>({});
  const [bad, setBad] = useState<string | null>(null);
  const held = useRef(tried);
  held.current = tried;
  const atlas = isSpritePuzzle(puzzle) ? puzzle : null;
  const takes = useTakes(puzzle, "sprite");
  const takeName = useTakeName();
  const { picks, setPick, picksMissing } = useFrame();
  const latest = useRef(picks);
  latest.current = picks;

  // Leaving the page puts every frame back: a tried file belongs to the page it was tried on.
  useEffect(
    () => () => {
      if (!atlas) return;
      for (const [frame, file] of Object.entries(held.current)) {
        void overrideSprite(atlas, frame, null);
        URL.revokeObjectURL(file.url);
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
  /** The file goes, and the frame is the draft's again: its pick, or the atlas's. */
  const dropFile = useCallback(
    (frame: string) => {
      if (!atlas) return;
      const pick = held.current[frame] ? latest.current.sprites[frame] : undefined;
      void overrideSprite(atlas, frame, pick ? takeUrl(pick) : null);
      setTried((all) => {
        const { [frame]: was, ...rest } = all;
        if (was) URL.revokeObjectURL(was.url);
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
          const picked = picks.sprites[frame];
          const mine = takes.get(frame) ?? [];
          const pickedTake = mine.find((take) => take.hash === picked);
          const missing = picksMissing.includes(`sprites/${frame}`);
          return (
            <div key={frame} className={`tune-row asset-row ${file || picked ? "is-changed" : ""}`} data-testid={`frame-${frame}`} data-tried={file ? "1" : "0"} data-picked={picked ?? ""}>
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
                  {file ? t("studio.assets.tried", { name: file.name }) : picked ? t("studio.assets.picked", { name: pickedTake ? takeName(pickedTake) : t("studio.assets.take_other", { hash: picked.slice(0, 6) }) }) : t("studio.sprites.shipped")}
                </p>
                {mine.length > 0 && (
                  <div className="asset-takes" data-testid={`frame-takes-${frame}`}>
                    {mine.map((take) => (
                      <button
                        key={take.hash}
                        type="button"
                        className={`asset-take ${picked === take.hash ? "is-held" : ""}`}
                        aria-pressed={picked === take.hash}
                        title={take.prompt ?? undefined}
                        onClick={() => {
                          if (file) dropFile(frame);
                          setPick("sprites", frame, picked === take.hash ? null : take.hash);
                        }}
                        data-testid={`take-${take.hash.slice(0, 8)}`}
                      >
                        <img src={takeUrl(take.hash)} width={44} height={44} alt="" loading="lazy" />
                        <span>{takeName(take)}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="tune-actions">
                  <FileButton accept="image/png,image/webp" label={t("studio.assets.try_file")} testId={`frame-file-${frame}`} onFile={(f) => void tryFile(frame, f)} />
                  {(file || picked) && (
                    <button type="button" className="btn btn-mini" onClick={() => (file ? dropFile(frame) : setPick("sprites", frame, null))} data-testid={`frame-back-${frame}`}>
                      {t("studio.assets.put_back")}
                    </button>
                  )}
                  <AskButtons kind="sprite" name={frame} />
                </div>
                {missing && !file && <p className="tune-refusal">{t("studio.assets.pick_missing")}</p>}
                {bad === frame && <p className="tune-refusal">{t("studio.assets.file_bad")}</p>}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** Which voice a cue plays in: the build's own (its sample, or the synthesized cue where it has none), the synthesized cue over a sample, a picked take, or a file being tried. */
type Voice = "shipped" | "synth" | "take" | "file";

/**
 * The sound panel (DESIGN.md 3.14, ADR 0050, ADR 0052): every cue the puzzle's board plays, each
 * played on a tap in the voice the board would use. The synthesized cue is always a pick (ADR
 * 0041), a bundled sample is one where the puzzle has it, and each take kept for the cue is one
 * more: a pick is the draft's, and the running board plays it from then on. A file from the
 * owner's machine can be tried in a cue's place, on this page only.
 */
export function SoundPanel({ puzzle }: { puzzle: PuzzleId }) {
  const [files, setFiles] = useState<Readonly<Record<string, string>>>({});
  const [bad, setBad] = useState<string | null>(null);
  const held = useRef(files);
  held.current = files;
  const takes = useTakes(puzzle, "sound");
  const takeName = useTakeName();
  const { picks, setPick, picksMissing } = useFrame();
  const sampled = new Set(sampleCues(puzzle));
  const fallbacks = OWN_CUE_FALLBACKS[puzzle] ?? {};

  useEffect(
    () => () => {
      for (const cue of Object.keys(held.current)) void overrideSample(puzzle, cue, null);
    },
    [puzzle],
  );

  /** The cue's voice as the draft has it: what a tried file gives way to. */
  const drafted = (cue: string): string | null => {
    const pick = picks.sounds[cue];
    return pick === undefined ? null : pick === "synth" ? "synth" : takeUrl(pick);
  };
  const dropFile = (cue: string): void =>
    setFiles((all) => {
      const { [cue]: _was, ...rest } = all;
      return rest;
    });
  const tryFile = async (cue: string, file: File): Promise<void> => {
    const url = URL.createObjectURL(file);
    const ok = await overrideSample(puzzle, cue, url);
    URL.revokeObjectURL(url);
    setBad(ok ? null : cue);
    if (ok) setFiles((all) => ({ ...all, [cue]: file.name }));
  };
  /** Pick a voice for the cue in the draft. The frame gives it to the board; here it is also given at once, so a take is heard on the tap that picks it. */
  const choose = async (cue: string, pick: string | null, hear: boolean): Promise<void> => {
    dropFile(cue);
    setBad(null);
    setPick("sounds", cue, pick);
    const ok = await overrideSample(puzzle, cue, pick === null || pick === "synth" ? pick : takeUrl(pick));
    if (ok && hear) auditionCue(puzzle, cue, { fallback: fallbacks[cue] ?? [] });
  };

  return (
    <div className="tune assets" data-testid="sounds">
      <section className="tune-group">
        <p className="tune-desc">{t("studio.sounds.intro")}</p>
        <p className="tune-desc">{t("studio.assets.local_note")}</p>
      </section>
      <section className="tune-group">
        {cuesOf(puzzle).map((cue) => {
          const has = sampled.has(cue);
          const pick = picks.sounds[cue];
          // With no sample bundled, the build's own voice is the synthesized cue, so picking it is picking nothing.
          const voice: Voice = files[cue] !== undefined ? "file" : pick === undefined ? "shipped" : pick === "synth" ? (has ? "synth" : "shipped") : "take";
          const button = (on: boolean, label: string, to: string | null, testId: string): ReactNode => (
            <button type="button" className={`btn btn-mini ${on ? "is-held" : ""}`} aria-pressed={on} onClick={() => void choose(cue, to, false)} data-testid={testId}>
              {label}
            </button>
          );
          return (
            <div key={cue} className={`tune-row asset-row ${voice === "shipped" ? "" : "is-changed"}`} data-testid={`cue-${cue}`} data-voice={voice === "shipped" ? (has ? "sample" : "synth") : voice} data-picked={pick ?? ""}>
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
                      {button(voice === "shipped", t("studio.sounds.sample"), null, `cue-shipped-${cue}`)}
                      {button(voice === "synth", t("studio.sounds.synth"), "synth", `cue-synth-${cue}`)}
                    </>
                  ) : (
                    button(voice === "shipped", t("studio.sounds.synth"), null, `cue-shipped-${cue}`)
                  )}
                  {takes.get(cue)?.map((take) => {
                    const on = voice === "take" && pick === take.hash;
                    return (
                      <button key={take.hash} type="button" className={`btn btn-mini ${on ? "is-held" : ""}`} aria-pressed={on} title={take.prompt ?? undefined} onClick={() => void choose(cue, take.hash, true)} data-testid={`take-${take.hash.slice(0, 8)}`}>
                        {takeName(take)}
                      </button>
                    );
                  })}
                  <FileButton accept="audio/mpeg,audio/wav,.mp3,.wav" label={t("studio.assets.try_file")} testId={`cue-file-${cue}`} onFile={(f) => void tryFile(cue, f)} />
                  {voice === "file" && (
                    <button
                      type="button"
                      className="btn btn-mini"
                      onClick={() => {
                        dropFile(cue);
                        void overrideSample(puzzle, cue, drafted(cue));
                      }}
                      data-testid={`cue-back-${cue}`}
                    >
                      {t("studio.assets.put_back")}
                    </button>
                  )}
                  <AskButtons kind="sound" name={cue} />
                </div>
                {voice === "file" && (
                  <p className="tune-desc" data-testid={`cue-file-name-${cue}`}>
                    {t("studio.assets.tried", { name: files[cue] ?? "" })}
                  </p>
                )}
                {voice === "take" && picksMissing.includes(`sounds/${cue}`) && <p className="tune-refusal">{t("studio.assets.pick_missing")}</p>}
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
