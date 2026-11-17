import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PuzzleId } from "@openseas/engine";
import type { Take, TakeKind } from "@openseas/protocol";
import { SpriteIcon, auditionCue, isSpritePuzzle, overrideSample, overrideSprite, sampleCues, spriteFrames, t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { TAKES_CHANGED, listTakes, proposeChat, takeUrl } from "../service/client.js";
import { useMe } from "../service/me.js";
import { ActionIcon } from "../studio/icons.jsx";
import { ResetIcon } from "../tuning/TuningPanel.jsx";
import { OWN_CUE_FALLBACKS, cuesOf } from "./cues.js";
import { fitFrame } from "./fit.js";

/** Sent by the top bar's list of changes: the frame or the cue to show (studio/StudioShell). */
export const ASSET_SELECT = "openseas:studio-asset-select";

/** The name the page was last asked to show, of one kind. */
function useSelected(kind: "sprites" | "sounds", first: string | null): [string | null, (name: string) => void] {
  const [sel, setSel] = useState<string | null>(first);
  useEffect(() => {
    const on = (e: Event): void => {
      const d = (e as CustomEvent<{ kind: string; name: string }>).detail;
      if (d.kind === kind) setSel(d.name);
    };
    window.addEventListener(ASSET_SELECT, on);
    return () => window.removeEventListener(ASSET_SELECT, on);
  }, [kind]);
  return [sel, setSel];
}

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

/**
 * What can be done to the frame or cue picked out, a mark over a word each: a file from the
 * owner's machine tried in its place and, where there is a chat, the two things to ask the agent
 * for, each of which writes the start of a message to it (DESIGN.md 3.14).
 */
function Actions({ kind, name, accept, fileTestId, onFile }: { kind: TakeKind; name: string; accept: string; fileTestId: string; onFile(file: File): void }) {
  const { store } = useFrame();
  const input = useRef<HTMLInputElement>(null);
  const chat = store.state === "stored" && store.canChat;
  return (
    <div className="insp-actions">
      <button type="button" className="insp-action" onClick={() => input.current?.click()}>
        <ActionIcon name="upload" size={16} />
        {t("studio.assets.try_file")}
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
        data-testid={fileTestId}
      />
      {chat && (
        <>
          <button type="button" className="insp-action" onClick={() => proposeChat(t(`studio.assets.ask_new_${kind}`, { name }))} data-testid={`ask-new-${name}`}>
            <ActionIcon name="sparkle" size={16} />
            {t("studio.assets.ask_new")}
          </button>
          <button type="button" className="insp-action" onClick={() => proposeChat(t(`studio.assets.ask_change_${kind}`, { name }))} data-testid={`ask-change-${name}`}>
            <ActionIcon name="pencil" size={16} />
            {t("studio.assets.ask_change")}
          </button>
        </>
      )}
    </div>
  );
}

/** The button that puts a frame or a cue back, in a place that is kept for it while there is nothing to put back. */
function PutBack({ on, testId, onClick }: { on: boolean; testId: string; onClick(): void }) {
  return (
    <span className="insp-reset">
      {on && (
        <button type="button" className="num-reset" onClick={onClick} aria-label={t("studio.assets.put_back")} title={t("studio.assets.put_back")} data-testid={testId}>
          <ResetIcon />
        </button>
      )}
    </span>
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
  const [sel, setSel] = useSelected("sprites", atlas ? (spriteFrames(atlas)[0] ?? null) : null);

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
  const frame = sel !== null && frames.includes(sel) ? sel : (frames[0] ?? null);
  const detail = (frame: string): ReactNode => {
    const file = tried[frame];
    const picked = picks.sprites[frame];
    const mine = takes.get(frame) ?? [];
    const pickedTake = mine.find((take) => take.hash === picked);
    const missing = picksMissing.includes(`sprites/${frame}`) && !file;
    const refused = bad === frame ? t("studio.assets.file_bad") : missing ? t("studio.assets.pick_missing") : null;
    const said = refused ?? (file ? t("studio.assets.tried", { name: file.name }) : picked ? t("studio.assets.picked", { name: pickedTake ? takeName(pickedTake) : t("studio.assets.take_other", { hash: picked.slice(0, 6) }) }) : t("studio.sprites.shipped"));
    const pick = (hash: string | null): void => {
      if (file) dropFile(frame);
      setBad(null);
      setPick("sprites", frame, hash);
    };
    return (
      <section className="inspector" data-testid={`frame-detail-${frame}`}>
        <div className="insp-sprite">
          <span className="asset-view" aria-hidden="true">
            <SpriteIcon puzzle={atlas} name={frame} size={88} fallback={null} />
          </span>
          <div className="insp-main">
            <div className="insp-head">
              <h3 className="insp-name mono">{frame}</h3>
              <PutBack on={file !== undefined || picked !== undefined} testId={`frame-back-${frame}`} onClick={() => (file ? dropFile(frame) : setPick("sprites", frame, null))} />
            </div>
            <p className={`insp-status ${refused ? "tune-refusal" : ""}`} title={said} role={refused ? "alert" : undefined} data-testid={`frame-pick-${frame}`}>
              {said}
            </p>
            <span className="insp-board" aria-hidden="true">
              <span className="asset-view asset-view-board">
                <SpriteIcon puzzle={atlas} name={frame} size={30} fallback={null} />
              </span>
              {t("studio.sprites.board_size")}
            </span>
          </div>
        </div>
        <div className="versions is-tiles" role="group" aria-label={t("studio.assets.versions", { name: frame })}>
          <button type="button" className="asset-take" aria-pressed={!file && !picked} onClick={() => pick(null)} data-testid={`frame-shipped-${frame}`}>
            <span className="asset-take-art">
              <ActionIcon name="atlas" size={20} />
            </span>
            <span>{t("studio.assets.shipped")}</span>
          </button>
          {file && (
            <button type="button" className="asset-take" aria-pressed="true" title={file.name}>
              <img src={file.url} width={40} height={40} alt="" />
              <span>{t("studio.assets.your_file")}</span>
            </button>
          )}
          {mine.length > 0 && (
            <div className="versions-takes" data-testid={`frame-takes-${frame}`}>
              {mine.map((take) => (
                <button key={take.hash} type="button" className="asset-take" aria-pressed={!file && picked === take.hash} title={take.prompt ?? undefined} onClick={() => pick(take.hash)} data-testid={`take-${take.hash.slice(0, 8)}`}>
                  <img src={takeUrl(take.hash)} width={40} height={40} alt="" loading="lazy" />
                  <span>{takeName(take)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Actions kind="sprite" name={frame} accept="image/png,image/webp" fileTestId={`frame-file-${frame}`} onFile={(f) => void tryFile(frame, f)} />
      </section>
    );
  };
  return (
    <div className="tune assets" data-testid="sprites">
      <section className="panel-sec">
        <h3 className="panel-cap">{t("studio.sprites.frames", { count: frames.length })}</h3>
        <div className="asset-grid">
          {frames.map((name) => {
            const changed = tried[name] !== undefined || picks.sprites[name] !== undefined;
            return (
              <button key={name} type="button" className={`asset-tile ${changed ? "is-changed" : ""}`} aria-pressed={name === frame} aria-label={name} title={name} onClick={() => setSel(name)} data-testid={`frame-${name}`} data-tried={tried[name] ? "1" : "0"} data-picked={picks.sprites[name] ?? ""}>
                <SpriteIcon puzzle={atlas} name={name} size={40} fallback={null} />
              </button>
            );
          })}
        </div>
      </section>
      {/* The legend carries the page's marks toggle, whose test id the details sheet has too: only one of them is in the page at a time. */}
      {active && (
        <section className="panel-sec asset-legend" data-testid="sprite-legend">
          <h3 className="panel-cap">{t("studio.sprites.legend")}</h3>
          <div className="legend legend-inline">{legend}</div>
        </section>
      )}
      <p className="panel-note panel-foot">{t("studio.assets.local_note")}</p>
      {frame !== null && detail(frame)}
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
  const cues = cuesOf(puzzle);
  const [sel, setSel] = useSelected("sounds", cues[0] ?? null);

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

  /** How a cue stands: whether a sample is bundled for it, its pick, and the voice it plays in. With no sample bundled, the build's own voice is the synthesized cue, so picking it is picking nothing. */
  const stand = (cue: string): { has: boolean; pick: string | undefined; voice: Voice; said: "sample" | "synth" | "take" | "file" } => {
    const has = sampled.has(cue);
    const pick = picks.sounds[cue];
    const voice: Voice = files[cue] !== undefined ? "file" : pick === undefined ? "shipped" : pick === "synth" ? (has ? "synth" : "shipped") : "take";
    return { has, pick, voice, said: voice === "shipped" ? (has ? "sample" : "synth") : voice };
  };
  const play = (cue: string): void => auditionCue(puzzle, cue, { fallback: fallbacks[cue] ?? [] });
  const open = sel !== null && cues.includes(sel) ? sel : (cues[0] ?? null);

  const detail = (cue: string): ReactNode => {
    const { has, pick, voice, said } = stand(cue);
    const mine = takes.get(cue) ?? [];
    const pickedTake = mine.find((take) => take.hash === pick);
    const missing = voice === "take" && picksMissing.includes(`sounds/${cue}`);
    const refused = bad === cue ? t("studio.assets.file_bad") : missing ? t("studio.assets.pick_missing") : null;
    const plays = voice === "file" ? t("studio.assets.tried", { name: files[cue] ?? "" }) : t("studio.sounds.plays", { voice: voice === "take" && pickedTake ? takeName(pickedTake) : t(`studio.sounds.voice.${said}`) });
    const note = refused ?? (fallbacks[cue] ? `${plays} ${t("studio.sounds.own", { fallback: fallbacks[cue].join(" + ") })}` : plays);
    const chip = (on: boolean, icon: "sample" | "wave" | "take", label: string, to: string | null, testId: string, title?: string): ReactNode => (
      <button key={testId} type="button" className="chip-pick" aria-pressed={on} title={title} onClick={() => void choose(cue, to, true)} data-testid={testId}>
        <ActionIcon name={icon} size={13} />
        <span>{label}</span>
      </button>
    );
    return (
      <section className="inspector" data-testid={`cue-detail-${cue}`}>
        <div className="insp-head">
          <button type="button" className="cue-play is-big" onClick={() => play(cue)} aria-label={t("studio.sounds.play", { cue })} data-testid={`cue-audition-${cue}`}>
            <ActionIcon name="play" size={14} />
          </button>
          <h3 className="insp-name mono">{cue}</h3>
          <PutBack
            on={voice !== "shipped"}
            testId={`cue-back-${cue}`}
            onClick={() => {
              if (voice !== "file") return void choose(cue, null, false);
              dropFile(cue);
              setBad(null);
              void overrideSample(puzzle, cue, drafted(cue));
            }}
          />
        </div>
        <p className={`insp-status ${refused ? "tune-refusal" : ""}`} title={note} role={refused ? "alert" : undefined} data-testid={voice === "file" && !refused ? `cue-file-name-${cue}` : undefined}>
          {note}
        </p>
        <div className="versions is-chips" role="group" aria-label={t("studio.assets.versions", { name: cue })}>
          {has ? (
            <>
              {chip(voice === "shipped", "sample", t("studio.sounds.sample"), null, `cue-shipped-${cue}`)}
              {chip(voice === "synth", "wave", t("studio.sounds.synth"), "synth", `cue-synth-${cue}`)}
            </>
          ) : (
            chip(voice === "shipped", "wave", t("studio.sounds.synth"), null, `cue-shipped-${cue}`)
          )}
          {voice === "file" && (
            <button type="button" className="chip-pick" aria-pressed="true" title={files[cue]} onClick={() => play(cue)}>
              <ActionIcon name="file" size={13} />
              <span>{t("studio.assets.your_file")}</span>
            </button>
          )}
          {mine.map((take) => chip(voice === "take" && pick === take.hash, "take", takeName(take), take.hash, `take-${take.hash.slice(0, 8)}`, take.prompt ?? undefined))}
        </div>
        <Actions kind="sound" name={cue} accept="audio/mpeg,audio/wav,.mp3,.wav" fileTestId={`cue-file-${cue}`} onFile={(f) => void tryFile(cue, f)} />
      </section>
    );
  };

  return (
    <div className="tune assets" data-testid="sounds">
      <section className="panel-sec">
        <h3 className="panel-cap">{t("studio.sounds.cues", { count: cues.length })}</h3>
        <div className="cue-list">
          {cues.map((cue) => {
            const { pick, voice, said } = stand(cue);
            return (
              <div key={cue} className={`cue ${cue === open ? "is-open" : ""} ${voice === "shipped" ? "" : "is-changed"}`} data-testid={`cue-${cue}`} data-voice={said} data-picked={pick ?? ""}>
                <button
                  type="button"
                  className="cue-play"
                  onClick={() => {
                    setSel(cue);
                    play(cue);
                  }}
                  aria-label={t("studio.sounds.play", { cue })}
                  data-testid={`cue-play-${cue}`}
                >
                  <ActionIcon name="play" size={10} />
                </button>
                <button type="button" className="cue-name" aria-current={cue === open ? "true" : undefined} onClick={() => setSel(cue)} data-testid={`cue-open-${cue}`}>
                  <code className="mono">{cue}</code>
                  <i className="num-dot" aria-hidden="true" />
                  <span className="cue-voice">{t(`studio.sounds.voice.${said}`)}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>
      <p className="panel-note panel-foot">
        {t("studio.assets.local_note")} {t("studio.sounds.file_note")}
      </p>
      {open !== null && detail(open)}
    </div>
  );
}
