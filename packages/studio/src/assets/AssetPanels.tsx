import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PuzzleId } from "@openseas/engine";
import type { Take } from "@openseas/protocol";
import { auditionCue, overrideSample, sampleCues, t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { TAKES_CHANGED, listTakes, proposeChat, takeUrl } from "../service/client.js";
import { useMe } from "../service/me.js";
import { OWN_CUE_FALLBACKS, cuesOf } from "./cues.js";

/** Sent by the top bar's list of changes: the cue to show (studio/StudioShell). */
export const ASSET_SELECT = "openseas:studio-asset-select";

/** The cue the page was last asked to show. */
function useSelected(first: string | null): [string | null, (name: string) => void] {
  const [sel, setSel] = useState<string | null>(first);
  useEffect(() => {
    const on = (e: Event): void => {
      const d = (e as CustomEvent<{ kind: string; name: string }>).detail;
      if (d.kind === "sounds") setSel(d.name);
    };
    window.addEventListener(ASSET_SELECT, on);
    return () => window.removeEventListener(ASSET_SELECT, on);
  }, []);
  return [sel, setSel];
}

/**
 * A puzzle's sound takes (ADR 0051), by the cue each is of, oldest first. Only the signed-in owner
 * of a service that keeps takes has any; for anyone else, and with the service down, the panel is
 * as it is without it. Asked for again when a turn of the chat ends. A take of any other kind is
 * passed over: a service older than the site may still list the sprite takes it kept before pieces
 * were drawn in code (ADR 0062, ADR 0063), and nothing shows or picks one.
 */
function useTakes(puzzle: PuzzleId): ReadonlyMap<string, readonly Take[]> {
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
  for (const take of takes) if (take.kind === "sound") by.set(take.name, [...(by.get(take.name) ?? []), take]);
  return by;
}

/** What a take is called on its button: its number where it was made on the open draft, as the agent names it too, else the start of its hash. */
function useTakeName(): (take: Take) => string {
  const { store } = useFrame();
  const draft = store.state === "stored" ? (store.draft?.id ?? null) : null;
  return (take) => (take.take !== null && take.draft === draft ? t("studio.assets.take", { n: take.take }) : t("studio.assets.take_other", { hash: take.hash.slice(0, 6) }));
}

/** The two buttons a cue's row ends with when there is a chat: each writes the start of a message to the agent (DESIGN.md 3.14). */
function AskButtons({ name }: { name: string }) {
  const { store } = useFrame();
  if (store.state !== "stored" || !store.canChat) return null;
  return (
    <>
      <button type="button" className="btn btn-mini" onClick={() => proposeChat(t("studio.assets.ask_new_sound", { name }))} data-testid={`ask-new-${name}`}>
        {t("studio.assets.ask_new")}
      </button>
      <button type="button" className="btn btn-mini" onClick={() => proposeChat(t("studio.assets.ask_change_sound", { name }))} data-testid={`ask-change-${name}`}>
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
  const takes = useTakes(puzzle);
  const takeName = useTakeName();
  const { picks, setPick, picksMissing } = useFrame();
  const sampled = new Set(sampleCues(puzzle));
  const fallbacks = OWN_CUE_FALLBACKS[puzzle] ?? {};
  const cues = cuesOf(puzzle);
  const [sel, setSel] = useSelected(cues[0] ?? null);

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
      <section className="panel-sec">
        <h3 className="panel-cap">{t("studio.sounds.cues", { count: cues.length })}</h3>
        {cues.map((cue) => {
          const has = sampled.has(cue);
          const pick = picks.sounds[cue];
          // With no sample bundled, the build's own voice is the synthesized cue, so picking it is picking nothing.
          const voice: Voice = files[cue] !== undefined ? "file" : pick === undefined ? "shipped" : pick === "synth" ? (has ? "synth" : "shipped") : "take";
          const open = cue === sel;
          const button = (on: boolean, label: string, to: string | null, testId: string): ReactNode => (
            <button type="button" className={`btn btn-mini ${on ? "is-held" : ""}`} aria-pressed={on} onClick={() => void choose(cue, to, false)} data-testid={testId}>
              {label}
            </button>
          );
          return (
            <div key={cue} className={`cue ${open ? "is-open" : ""} ${voice === "shipped" ? "" : "is-changed"}`} data-testid={`cue-${cue}`} data-voice={voice === "shipped" ? (has ? "sample" : "synth") : voice} data-picked={pick ?? ""}>
              <div className="cue-head">
                <button
                  type="button"
                  className="cue-play"
                  onClick={() => {
                    setSel(cue);
                    auditionCue(puzzle, cue, { fallback: fallbacks[cue] ?? [] });
                  }}
                  aria-label={t("studio.sounds.play", { cue })}
                  data-testid={`cue-play-${cue}`}
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
                  </svg>
                </button>
                <button type="button" className="cue-name" aria-expanded={open} onClick={() => setSel(cue)} data-testid={`cue-open-${cue}`}>
                  <i className="num-dot" aria-hidden="true" />
                  <code className="mono">{cue}</code>
                  <span className="cue-voice">{t(`studio.sounds.voice.${voice === "shipped" ? (has ? "sample" : "synth") : voice}`)}</span>
                </button>
              </div>
              {open && (
                <div className="cue-body">
                  {fallbacks[cue] && <p className="panel-note">{t("studio.sounds.own", { fallback: fallbacks[cue].join(" + ") })}</p>}
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
                  </div>
                  <div className="tune-actions">
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
                    <AskButtons name={cue} />
                  </div>
                  {voice === "file" && (
                    <p className="panel-note" data-testid={`cue-file-name-${cue}`}>
                      {t("studio.assets.tried", { name: files[cue] ?? "" })}
                    </p>
                  )}
                  {voice === "take" && picksMissing.includes(`sounds/${cue}`) && <p className="tune-refusal">{t("studio.assets.pick_missing")}</p>}
                  {bad === cue && <p className="tune-refusal">{t("studio.assets.file_bad")}</p>}
                </div>
              )}
            </div>
          );
        })}
      </section>
      <p className="panel-note panel-foot">
        {t("studio.assets.local_note")} {t("studio.sounds.file_note")}
      </p>
    </div>
  );
}
