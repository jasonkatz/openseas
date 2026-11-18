import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PuzzleId } from "@openseas/engine";
import { CUE_PARAMS, LIMITS, NOTES, PROBES, SHIPPED_CUES, auditionCue, auditionData, cueFrom, cueProblems, t, type CueName, type CueParam } from "@openseas/boards";
import { CueDataSchema, type CueData, type VoiceData, type When } from "@openseas/protocol";
import { useFrame } from "../frame/RoundFrame.jsx";
import { OWN_CUE_FALLBACKS, PUZZLE_CUES, cuesOf, noteName } from "./cues.js";

/**
 * The Sounds mode (DESIGN.md 3.14, ADR 0065): every cue the puzzle's board plays, each with a
 * button that plays it, and an editor for one. A cue is a few voices on the notes of one key, with
 * rules that move them by what the board says (a cascade's depth, a streak's length), as
 * `boards/data/cues.json` holds it. A change is part of the draft: the board plays it at once
 * unless it breaks a rule of the brand book's sound (docs/BRAND.md section 8), a link carries it,
 * and Save writes it into the cues file. A cue is the game's: changing one changes it on every
 * board that plays it.
 */

const isCue = (name: string): name is CueName => name in CUE_PARAMS;
/** The puzzles that play a cue: who else hears a change to it. */
const playedBy = (cue: string): PuzzleId[] => (Object.keys(PUZZLE_CUES) as PuzzleId[]).filter((p) => PUZZLE_CUES[p].includes(cue));

function Play({ label, onPlay, testId }: { label: string; onPlay(): void; testId?: string }) {
  return (
    <button type="button" className="cue-play" onClick={onPlay} aria-label={label} title={label} data-testid={testId}>
      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
        <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
      </svg>
    </button>
  );
}

export function SoundPanel({ puzzle, focus, onFocus }: { puzzle: PuzzleId; focus: string | null; onFocus(cue: string): void }) {
  const { look } = useFrame();
  const fallbacks = OWN_CUE_FALLBACKS[puzzle] ?? {};
  const cues = cuesOf(puzzle);
  const editable = cues.filter(isCue);
  const name = focus && isCue(focus) && cues.includes(focus) ? focus : (editable[0] ?? null);
  return (
    <div className="tune assets" data-testid="sounds">
      <section className="panel-sec">
        <h3 className="panel-cap">{t("studio.sounds.cues", { count: cues.length })}</h3>
        <div className="cue-list">
          {cues.map((cue) => (
            <div key={cue} className={`cue ${cue === name ? "is-selected" : ""}`} data-testid={`cue-${cue}`}>
              <div className="cue-head">
                <Play label={t("studio.sounds.play", { cue })} onPlay={() => (isCue(cue) && look.cues[cue] ? auditionData(cue, look.cues[cue]!, PROBES[cue][0] ?? []) : auditionCue(cue, fallbacks[cue]))} testId={`cue-play-${cue}`} />
                {isCue(cue) ? (
                  <button type="button" className="cue-name cue-pick" onClick={() => onFocus(cue)} aria-pressed={cue === name} data-testid={`cue-edit-${cue}`}>
                    <code className="mono">{cue}</code>
                    {cue in look.cues && <i className="rail-dot" data-testid={`cue-dot-${cue}`} />}
                  </button>
                ) : (
                  <span className="cue-name">
                    <code className="mono">{cue}</code>
                    {/* A puzzle's own cue has no voice of its name: it says which cues it plays. */}
                    {fallbacks[cue] && <span className="cue-voice">{t("studio.sounds.own", { fallback: fallbacks[cue].join(" + ") })}</span>}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      {name && <CueEditor key={name} name={name} />}
      <p className="panel-note panel-foot">{t("studio.sounds.note")}</p>
    </div>
  );
}

const W = 420;
const ROW = 11;
const AIR = 22;
const TOP = 4;
const H = TOP + 16 * ROW + 6 + AIR + 4;
const voiceEnd = (v: VoiceData): number => v.at + v.attack + v.release;

function CueEditor({ name }: { name: CueName }) {
  const { look, setCue } = useFrame();
  const shipped = SHIPPED_CUES[name];
  const data = look.cues[name] ?? shipped;
  const params: readonly CueParam[] = CUE_PARAMS[name];
  const probes = PROBES[name] as readonly (readonly unknown[])[];
  const [probe, setProbe] = useState(0);
  const [sel, setSel] = useState(0);
  const [held, setHeld] = useState<CueData | null>(null);
  const [past, setPast] = useState<CueData[]>([]);
  const shown = held ?? data;
  const voice = shown.voices[Math.min(sel, shown.voices.length - 1)];
  const limit = name === "beat" ? LIMITS.beat : LIMITS.cue;
  const span = limit * 1.15;
  const x = (s: number): number => (s / span) * W;
  const y = (note: number): number => TOP + (15 - note) * ROW;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ edge: boolean; start: VoiceData; ox: number; oy: number } | null>(null);
  const args = probes[probe] ?? [];
  const heard = useMemo(() => cueFrom(shown, params, args), [shown, params, args]);
  const problems = useMemo(() => cueProblems(name, shown).map((p) => t(p.key, p.vars)), [name, shown]);
  const changed = JSON.stringify(data) !== JSON.stringify(shipped);
  const others = playedBy(name).length;

  const commit = (next: CueData): void => {
    const ok = CueDataSchema.safeParse(next);
    if (!ok.success) return;
    setPast((p) => [...p.slice(-49), data]);
    setCue(name, ok.data);
  };
  const setVoice = (i: number, v: VoiceData): void => commit({ ...data, voices: data.voices.map((w, k) => (k === i ? v : w)) });
  const undo = (): void => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast(past.slice(0, -1));
    setCue(name, last);
  };
  const play = (row = probe): void => auditionData(name, shown, probes[row] ?? []);

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = svg.current!.getBoundingClientRect();
    return [((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H];
  };
  const down = (e: ReactPointerEvent, i: number, edge: boolean): void => {
    e.stopPropagation();
    setSel(i);
    (e.target as Element).setPointerCapture(e.pointerId);
    const [px, py] = at(e);
    drag.current = { edge, start: data.voices[i]!, ox: px, oy: py };
  };
  const move = (e: ReactPointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const [px, py] = at(e);
    const dt = ((px - d.ox) / W) * span;
    const s = d.start;
    let next: VoiceData;
    if (d.edge) next = { ...s, release: Number(Math.max(0.01, s.release + dt).toFixed(3)) };
    else {
      const when = Number(Math.max(0, s.at + dt).toFixed(3));
      next = s.kind === "tone" ? { ...s, at: when, note: Math.max(0, Math.min(15, s.note - Math.round((py - d.oy) / ROW))) } : { ...s, at: when };
    }
    setHeld({ ...data, voices: data.voices.map((v, k) => (k === sel ? next : v)) });
  };
  const up = (): void => {
    if (!drag.current) return;
    drag.current = null;
    if (held) {
      commit(held);
      auditionData(name, held, args);
    }
    setHeld(null);
  };

  /** A voice as a block on the roll: its rise and fall drawn inside it, as tall as it is loud. */
  const block = (v: VoiceData, i: number, ghost: boolean) => {
    const top = v.kind === "tone" ? y(v.note) : TOP + 16 * ROW + 6;
    const h = v.kind === "tone" ? ROW - 1 : AIR;
    const x0 = x(v.at);
    const x1 = x(voiceEnd(v));
    const peak = x(v.at + v.attack);
    const env = `M${x0},${top + h} L${peak},${top + h - h * v.level} L${x1},${top + h} Z`;
    if (ghost) return <path key={`g${i}`} d={env} className="roll-heard" />;
    return (
      <g key={i} className={`roll-voice ${i === sel ? "is-selected" : ""} ${v.kind}`} data-testid={`voice-${i}`}>
        <rect x={x0} y={top} width={Math.max(2, x1 - x0)} height={h} rx={2} onPointerDown={(e) => down(e, i, false)} />
        <path d={env} pointerEvents="none" />
        <rect x={x1 - 3} y={top} width={6} height={h} className="roll-edge" onPointerDown={(e) => down(e, i, true)} data-testid={`voice-edge-${i}`} />
      </g>
    );
  };

  return (
    <>
      <section className="panel-sec" data-testid="cue-editor">
        <div className="sprite-head">
          <h3 className="panel-cap">
            <code className="mono">{name}</code>
          </h3>
          <div className="sprite-tools">
            <button type="button" className="btn btn-mini" disabled={past.length === 0} onClick={undo} data-testid="cue-undo">
              {t("studio.sprites.undo")}
            </button>
            <button type="button" className="btn btn-mini" disabled={!changed} onClick={() => setCue(name, null)} data-testid="cue-reset">
              {t("studio.put_back")}
            </button>
          </div>
        </div>
        <p className="panel-note small" data-testid="cue-shared">{t("studio.sounds.shared", { count: others })}</p>
        <div className="probe-row">
          {probes.map((p, i) => (
            <button key={i} type="button" className={`chip probe ${i === probe ? "is-changed" : ""}`} onClick={() => { setProbe(i); play(i); }} data-testid={`probe-${i}`}>
              ▶ {params.length === 0 ? t("studio.sounds.as_is") : params.map((q, k) => `${q.name} ${String(p[k])}`).join(", ")}
            </button>
          ))}
        </div>
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="roll" onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="roll" aria-label={t("studio.sounds.roll", { cue: name })}>
          {Array.from({ length: 16 }, (_, n) => (
            <g key={n} className={n % 5 === 0 ? "roll-root" : "roll-row"}>
              <line x1={0} x2={W} y1={y(n) + ROW - 0.5} y2={y(n) + ROW - 0.5} />
              {n % 5 === 0 && (
                <text x={2} y={y(n) + ROW - 2}>
                  {noteName(n)}
                </text>
              )}
            </g>
          ))}
          <text x={2} y={TOP + 16 * ROW + 6 + AIR - 6} className="roll-label">
            {t("studio.sounds.air")}
          </text>
          {/* How long a cue may last. */}
          <line x1={x(limit)} x2={x(limit)} y1={0} y2={H} className="roll-limit" />
          {heard.voices.map((v, i) => block(v as VoiceData, i, true))}
          {shown.voices.map((v, i) => block(v, i, false))}
        </svg>
        <p className="panel-note small">{t("studio.sounds.roll_hint")}</p>
        {problems.length > 0 && (
          <ul className="sprite-notes is-hard" role="alert" data-testid="cue-problems">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        <div className="insp-grid">
          <Num label={t("studio.sounds.level")} value={data.level} min={0.01} max={4} step={0.01} onSet={(v) => commit({ ...data, level: v })} testId="cue-level" />
          <Num label={t("studio.sounds.cutoff")} value={data.cutoff} min={100} max={LIMITS.cutoff} step={50} onSet={(v) => commit({ ...data, cutoff: v })} testId="cue-cutoff" />
        </div>
        <div className="layer-add">
          <button type="button" className="btn btn-mini" onClick={() => { commit({ ...data, voices: [...data.voices, { kind: "tone", note: 10, wave: "sine", at: 0, attack: 0.01, release: 0.1, level: 0.8 }] }); setSel(data.voices.length); }} data-testid="voice-add-tone">
            + {t("studio.sounds.tone")}
          </button>
          <button type="button" className="btn btn-mini" onClick={() => { commit({ ...data, voices: [...data.voices, { kind: "air", at: 0, attack: 0.015, release: 0.1, level: 0.5, from: 1600, to: 500, band: false }] }); setSel(data.voices.length); }} data-testid="voice-add-air">
            + {t("studio.sounds.air")}
          </button>
          <button type="button" className="btn btn-mini" disabled={data.voices.length <= 1} onClick={() => { commit({ ...data, voices: data.voices.filter((_, k) => k !== sel) }); setSel(Math.max(0, sel - 1)); }} data-testid="voice-remove">
            {t("studio.sounds.remove_voice")}
          </button>
        </div>
      </section>
      {voice && <VoiceInspector key={`${name}.${sel}`} index={sel} voice={voice} params={params} onChange={(v) => setVoice(sel, v)} />}
      <Rules data={data} params={params} onChange={commit} />
    </>
  );
}

/** A number typed in, held between its bounds: what the brand book allows is all it takes. */
function Num({ label, value, onSet, min, max, step, testId }: { label: string; value: number; onSet(v: number): void; min: number; max: number; step: number; testId?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="insp-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(v)) onSet(Math.max(min, Math.min(max, v)));
        }}
        data-testid={testId}
      />
    </label>
  );
}

function ParamSelect({ params, value, onSet, testId }: { params: readonly CueParam[]; value: string | undefined; onSet(p: string | undefined): void; testId?: string }) {
  return (
    <select value={value ?? ""} onChange={(e) => onSet(e.target.value || undefined)} data-testid={testId}>
      <option value="">{t("studio.sounds.never")}</option>
      {params.map((p) => (
        <option key={p.name} value={p.name}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/** A `when` edited: which parameter, and the range it must be in (a flag reads 1 when set). */
function WhenFields({ when, params, onSet, label }: { when: When | undefined; params: readonly CueParam[]; onSet(w: When | undefined): void; label: string }) {
  return (
    <div className="rule">
      <span className="rule-label">{label}</span>
      <ParamSelect params={params} value={when?.param} onSet={(p) => onSet(p ? { param: p, from: 1 } : undefined)} />
      {when && (
        <>
          <Num label={t("studio.sounds.from")} value={when.from ?? 0} min={-100} max={100} step={1} onSet={(v) => onSet({ ...when, from: v })} />
          <Num label={t("studio.sounds.to")} value={when.to ?? 100} min={-100} max={100} step={1} onSet={(v) => onSet({ ...when, to: v >= 100 ? undefined : v })} />
        </>
      )}
    </div>
  );
}

function VoiceInspector({ index, voice, params, onChange }: { index: number; voice: VoiceData; params: readonly CueParam[]; onChange(v: VoiceData): void }) {
  return (
    <section className="panel-sec" data-testid="voice-inspector">
      <h3 className="panel-cap">{t("studio.sounds.voice", { n: index + 1 })}</h3>
      <div className="insp-grid">
        <label className="insp-field">
          <span>{t("studio.sounds.sound")}</span>
          <select
            value={voice.kind === "tone" ? voice.wave : "air"}
            onChange={(e) => {
              const k = e.target.value;
              const base = { at: voice.at, attack: voice.attack, release: voice.release, level: voice.level, when: voice.when, repeat: voice.repeat };
              if (k === "air") onChange({ ...base, kind: "air", from: 1600, to: 500, band: false });
              else onChange({ ...base, kind: "tone", wave: k as "sine" | "triangle", note: voice.kind === "tone" ? voice.note : 10, fixed: voice.kind === "tone" ? voice.fixed : undefined });
            }}
            data-testid="voice-sound"
          >
            <option value="sine">{t("studio.sounds.sine")}</option>
            <option value="triangle">{t("studio.sounds.triangle")}</option>
            <option value="air">{t("studio.sounds.air")}</option>
          </select>
        </label>
        {voice.kind === "tone" && (
          <label className="insp-field">
            <span>{t("studio.sounds.note_name")}</span>
            <select value={voice.note} onChange={(e) => onChange({ ...voice, note: Number(e.target.value) })} data-testid="voice-note">
              {NOTES.map((hz, n) => (
                <option key={n} value={n}>
                  {noteName(n)} · {Math.round(hz)} Hz
                </option>
              ))}
            </select>
          </label>
        )}
        <Num label={t("studio.sounds.at")} value={voice.at} min={0} max={1} step={0.005} onSet={(v) => onChange({ ...voice, at: v })} testId="voice-at" />
        <Num label={t("studio.sounds.attack")} value={voice.attack} min={LIMITS.attack} max={1} step={0.001} onSet={(v) => onChange({ ...voice, attack: v })} testId="voice-attack" />
        <Num label={t("studio.sounds.release")} value={voice.release} min={0.005} max={1} step={0.005} onSet={(v) => onChange({ ...voice, release: v })} testId="voice-release" />
        <Num label={t("studio.sounds.level")} value={voice.level} min={0.01} max={1} step={0.05} onSet={(v) => onChange({ ...voice, level: v })} testId="voice-level" />
        {voice.kind === "air" && (
          <>
            <Num label={t("studio.sounds.from_hz")} value={voice.from} min={40} max={LIMITS.cutoff} step={50} onSet={(v) => onChange({ ...voice, from: v })} />
            <Num label={t("studio.sounds.to_hz")} value={voice.to} min={40} max={LIMITS.cutoff} step={50} onSet={(v) => onChange({ ...voice, to: v })} />
          </>
        )}
      </div>
      <div className="insp-flags">
        {voice.kind === "air" && (
          <label className="switch-label">
            {t("studio.sounds.band")}
            <input type="checkbox" role="switch" className="switch" checked={voice.band} onChange={(e) => onChange({ ...voice, band: e.target.checked })} />
          </label>
        )}
        {voice.kind === "tone" && (
          <label className="switch-label" title={t("studio.sounds.fixed_hint")}>
            {t("studio.sounds.fixed")}
            <input type="checkbox" role="switch" className="switch" checked={voice.fixed ?? false} onChange={(e) => onChange({ ...voice, fixed: e.target.checked || undefined })} />
          </label>
        )}
      </div>
      {params.length > 0 && (
        <>
          <WhenFields label={t("studio.sounds.only_when")} when={voice.when} params={params} onSet={(w) => onChange({ ...voice, when: w })} />
          <div className="rule">
            <span className="rule-label">{t("studio.sounds.repeat")}</span>
            <ParamSelect params={params} value={voice.repeat?.param} onSet={(p) => onChange({ ...voice, repeat: p ? { param: p, min: 0, max: 3, note: 1, at: 0.05 } : undefined })} />
            {voice.repeat && (
              <>
                <Num label={t("studio.sounds.min")} value={voice.repeat.min} min={0} max={8} step={1} onSet={(v) => onChange({ ...voice, repeat: { ...voice.repeat!, min: Math.round(v) } })} />
                <Num label={t("studio.sounds.max")} value={voice.repeat.max} min={0} max={8} step={1} onSet={(v) => onChange({ ...voice, repeat: { ...voice.repeat!, max: Math.round(v) } })} />
                <Num label={t("studio.sounds.step_note")} value={voice.repeat.note} min={-8} max={8} step={1} onSet={(v) => onChange({ ...voice, repeat: { ...voice.repeat!, note: Math.round(v) } })} />
                <Num label={t("studio.sounds.step_at")} value={voice.repeat.at} min={0} max={0.4} step={0.01} onSet={(v) => onChange({ ...voice, repeat: { ...voice.repeat!, at: v } })} />
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** The cue's rules: how it climbs the scale, swells, or changes its level, by what the board passes. */
function Rules({ data, params, onChange }: { data: CueData; params: readonly CueParam[]; onChange(d: CueData): void }) {
  if (params.length === 0) return null;
  const s = data.shift;
  return (
    <section className="panel-sec" data-testid="cue-rules">
      <h3 className="panel-cap">{t("studio.sounds.rules")}</h3>
      <div className="rule">
        <span className="rule-label">{t("studio.sounds.shift")}</span>
        <ParamSelect params={params} value={s?.param} onSet={(p) => onChange({ ...data, shift: p ? { param: p, per: 1, offset: 0, min: 0, max: 8, round: "floor" } : undefined })} testId="rule-shift" />
        {s && (
          <>
            <Num label={t("studio.sounds.per")} value={s.per} min={-16} max={16} step={0.25} onSet={(v) => onChange({ ...data, shift: { ...s, per: v } })} />
            <Num label={t("studio.sounds.offset")} value={s.offset} min={-100} max={100} step={1} onSet={(v) => onChange({ ...data, shift: { ...s, offset: v } })} />
            <Num label={t("studio.sounds.min")} value={s.min} min={-16} max={16} step={1} onSet={(v) => onChange({ ...data, shift: { ...s, min: v } })} />
            <Num label={t("studio.sounds.max")} value={s.max} min={-16} max={16} step={1} onSet={(v) => onChange({ ...data, shift: { ...s, max: v } })} />
          </>
        )}
      </div>
      <div className="rule">
        <span className="rule-label">{t("studio.sounds.swell")}</span>
        <ParamSelect params={params} value={data.swell?.param} onSet={(p) => onChange({ ...data, swell: p ? { param: p, from: 0.75, to: 1 } : undefined })} />
        {data.swell && (
          <>
            <Num label={t("studio.sounds.from")} value={data.swell.from} min={0} max={2} step={0.05} onSet={(v) => onChange({ ...data, swell: { ...data.swell!, from: v } })} />
            <Num label={t("studio.sounds.to")} value={data.swell.to} min={0} max={2} step={0.05} onSet={(v) => onChange({ ...data, swell: { ...data.swell!, to: v } })} />
          </>
        )}
      </div>
      <WhenFields label={t("studio.sounds.alt")} when={data.alt?.when} params={params} onSet={(w) => onChange({ ...data, alt: w ? { when: w, level: data.alt?.level ?? data.level, cutoff: data.alt?.cutoff ?? data.cutoff } : undefined })} />
      {data.alt && (
        <div className="insp-grid">
          <Num label={t("studio.sounds.alt_level")} value={data.alt.level} min={0.01} max={4} step={0.01} onSet={(v) => onChange({ ...data, alt: { ...data.alt!, level: v } })} />
          <Num label={t("studio.sounds.alt_cutoff")} value={data.alt.cutoff} min={100} max={LIMITS.cutoff} step={50} onSet={(v) => onChange({ ...data, alt: { ...data.alt!, cutoff: v } })} />
        </div>
      )}
    </section>
  );
}
