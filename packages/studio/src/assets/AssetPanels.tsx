import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PuzzleId } from "@openseas/engine";
import type { Take, TakeKind } from "@openseas/protocol";
import { SpriteIcon, auditionCue, isSpritePuzzle, overrideSample, overrideSprite, sampleCues, spriteFrames, t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { TAKES_CHANGED, listTakes, proposeChat, takeUrl } from "../service/client.js";
import { useMe } from "../service/me.js";
import { OWN_CUE_FALLBACKS, cuesOf } from "./cues.js";
import { fitFrame } from "./fit.js";

/** A file the owner is trying in a frame's or a cue's place: its name, and for a frame the fitted picture's object URL. */
interface Tried {
  readonly name: string;
  readonly url: string | null;
  /** Set when it is a take and not a file. */
  readonly hash?: string;
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
  const takes = useTakes(puzzle, "sprite");
  const takeName = useTakeName();

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
  const tryTake = useCallback(
    async (frame: string, take: Take, name: string) => {
      // A take is kept as the frame it would be placed as: nothing to fit.
      if (!atlas || !(await overrideSprite(atlas, frame, takeUrl(take.hash)))) return setBad(frame);
      setBad(null);
      setTried((all) => {
        const was = all[frame]?.url;
        if (was) URL.revokeObjectURL(was);
        return { ...all, [frame]: { name, url: null, hash: take.hash } };
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
                  {file ? (file.hash ? t("studio.assets.trying", { name: file.name }) : t("studio.assets.tried", { name: file.name })) : t("studio.sprites.shipped")}
                </p>
                {(takes.get(frame)?.length ?? 0) > 0 && (
                  <div className="asset-takes" data-testid={`frame-takes-${frame}`}>
                    {takes.get(frame)!.map((take) => (
                      <button
                        key={take.hash}
                        type="button"
                        className={`asset-take ${file?.hash === take.hash ? "is-held" : ""}`}
                        aria-pressed={file?.hash === take.hash}
                        title={take.prompt ?? undefined}
                        onClick={() => void tryTake(frame, take, takeName(take))}
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
                  {file && (
                    <button type="button" className="btn btn-mini" onClick={() => putBack(frame)} data-testid={`frame-back-${frame}`}>
                      {t("studio.assets.put_back")}
                    </button>
                  )}
                  <AskButtons kind="sprite" name={frame} />
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
type Voice = "shipped" | "synth" | "file" | "take";

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
  const takes = useTakes(puzzle, "sound");
  const takeName = useTakeName();
  /** The take on each cue, by its hash, while one is. */
  const [taken, setTaken] = useState<Readonly<Record<string, string>>>({});
  const sampled = new Set(sampleCues(puzzle));
  const fallbacks = OWN_CUE_FALLBACKS[puzzle] ?? {};

  useEffect(
    () => () => {
      for (const cue of Object.keys(held.current)) void overrideSample(puzzle, cue, null);
    },
    [puzzle],
  );

  const choose = useCallback(
    async (cue: string, voice: Voice, file?: File, take?: Take) => {
      let ok: boolean;
      if (voice === "take" && take) {
        ok = await overrideSample(puzzle, cue, takeUrl(take.hash));
        if (ok) {
          setTaken((all) => ({ ...all, [cue]: take.hash }));
          // Picking a take is also hearing it.
          auditionCue(puzzle, cue);
        }
      } else if (voice === "file" && file) {
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
                  {takes.get(cue)?.map((take) => {
                    const on = voice === "take" && taken[cue] === take.hash;
                    return (
                      <button key={take.hash} type="button" className={`btn btn-mini ${on ? "is-held" : ""}`} aria-pressed={on} title={take.prompt ?? undefined} onClick={() => void choose(cue, "take", undefined, take)} data-testid={`take-${take.hash.slice(0, 8)}`}>
                        {takeName(take)}
                      </button>
                    );
                  })}
                  <FileButton accept="audio/mpeg,audio/wav,.mp3,.wav" label={t("studio.assets.try_file")} testId={`cue-file-${cue}`} onFile={(f) => void choose(cue, "file", f)} />
                  <AskButtons kind="sound" name={cue} />
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
