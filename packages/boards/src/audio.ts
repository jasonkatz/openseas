/**
 * Sound effects (DESIGN.md 3.9, docs/BRAND.md section 8). Every cue is synthesized here from its
 * definition in `cues.ts`: a few soft voices on the notes of one scale, through a low-pass. There
 * are no samples and nothing is loaded (ADR 0062 decision 5).
 */
import type { CueData } from "@openseas/protocol";
import { CUE_NAMES, CUE_PARAMS, LIMITS, NOTES, PROBES, PUZZLE_SHIPPED_CUES, SHIPPED_CUES, cueFrom, cueOf, envelope, type Cue, type CueArgs, type CueName } from "./cues.js";

const MUTE_KEY = "openseas.muted";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * How much louder the game is than a cue's own level. A cue is tuned quiet and level with the
 * others (`cues.ts`); this lifts them all to where a phone's small speaker carries them, and the
 * limiter after it keeps cues that overlap from clipping.
 */
const MASTER_GAIN = 2.2;

/** The one context and its output, made on first need. Null when muted or when the browser has no WebAudio. */
function context(): { ac: AudioContext; out: GainNode } | null {
  if (muted) return null;
  try {
    if (!ctx) {
      // The game's sound is incidental, and says so: it obeys a phone's ring switch (on silent the
      // game is silent), mixes with whatever music is playing, and is not media, so the phone
      // shows no "now playing" card for it. Only some browsers have this; the rest ignore it.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "ambient";
      ctx = new AudioContext();
    }
    if (!master) {
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      master.connect(limiter);
      limiter.connect(ctx.destination);
    }
    // "suspended" before a gesture, and on a phone "interrupted" after a call or a trip to another app.
    if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
    return { ac: ctx, out: master };
  } catch {
    return null;
  }
}

/**
 * A browser, a phone's above all, lets a page make sound only from inside the player's own touch,
 * click or key press. A board plays its cues a frame or more after the touch that caused them,
 * which is too late: the context would stay suspended and the game silent for good. So the first
 * gesture anywhere on the page starts the context itself, and plays one silent sample inside the
 * gesture, which is what older phones need before they will let anything through.
 */
const GESTURES = ["pointerdown", "pointerup", "touchend", "mousedown", "keydown", "click"] as const;
function unlock(): void {
  const c = context();
  if (!c) return;
  try {
    const source = c.ac.createBufferSource();
    source.buffer = c.ac.createBuffer(1, 1, c.ac.sampleRate);
    source.connect(c.ac.destination);
    source.start();
  } catch {
    /* nothing to unlock with */
  }
  // The listeners stay for the life of the page: the context is put to sleep whenever the page is
  // hidden (below), and on a phone only another gesture may be allowed to wake it.
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  for (const type of GESTURES) window.addEventListener(type, unlock, { capture: true, passive: true });
  // The context sleeps whenever the page is hidden (the phone locked, another app or tab in
  // front), so the game holds no audio it is not using; coming back wakes it, or the next touch
  // does where the phone insists on one.
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => undefined);
    else if (ctx.state !== "running" && !muted) void ctx.resume().catch(() => undefined);
  });
}

/** Whether sound can be heard right now: "running", "suspended" (no gesture yet), "muted" or "none". For the studio's smoke. */
export function audioState(): string {
  if (muted) return "muted";
  return ctx ? ctx.state : "none";
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  // Turning sound on is itself a gesture: start the context inside it.
  if (!m && typeof window !== "undefined") unlock();
  try {
    window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* private mode */
  }
}

/** Soft noise, a second of it, made once for each context: what every breath is cut from. */
const noiseOf = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ac: BaseAudioContext): AudioBuffer {
  let buf = noiseOf.get(ac);
  if (!buf) {
    buf = ac.createBuffer(1, Math.ceil(ac.sampleRate), ac.sampleRate);
    const data = buf.getChannelData(0);
    // A fixed sequence, not a random one: a cue sounds, and measures, the same every time.
    let x = 0x2f6e2b1;
    for (let i = 0; i < data.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) | 0;
      data[i] = x / 0x80000000;
    }
    noiseOf.set(ac, buf);
  }
  return buf;
}

/**
 * Builds a cue's voices on a context, to start at `t0`, and returns the node they all leave by.
 * The one place a cue becomes sound: each voice rises from zero and falls back to it on the shared
 * envelope, and the whole cue passes one low-pass. Mono throughout. Any context will do, so the
 * same code plays a cue live and renders it offline to be measured.
 */
export function scheduleCue(ac: BaseAudioContext, out: AudioNode, cue: Cue, t0: number): GainNode {
  const bus = ac.createGain();
  bus.gain.value = cue.gain;
  const lowpass = ac.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = Math.min(LIMITS.cutoff, cue.cutoff);
  lowpass.Q.value = 0;
  lowpass.connect(bus).connect(out);
  for (const v of cue.voices) {
    const start = t0 + v.at;
    const length = v.attack + v.release;
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(
      envelope(v.attack, v.release).map((x) => x * v.level),
      start,
      length,
    );
    g.connect(lowpass);
    if (v.kind === "tone") {
      const osc = ac.createOscillator();
      osc.type = v.wave;
      osc.frequency.value = NOTES[v.note]!;
      osc.connect(g);
      osc.start(start);
      osc.stop(start + length + 0.01);
    } else {
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer(ac);
      const f = ac.createBiquadFilter();
      f.type = v.band ? "bandpass" : "lowpass";
      f.Q.value = v.band ? 0.8 : 0;
      f.frequency.setValueAtTime(Math.min(LIMITS.cutoff, v.from), start);
      f.frequency.exponentialRampToValueAtTime(Math.min(LIMITS.cutoff, v.to), start + length);
      src.connect(f).connect(g);
      src.start(start);
      src.stop(start + length + 0.01);
    }
  }
  return bus;
}

/**
 * Renders one cue offline and returns its samples (mono, 48kHz), for `seconds` from its start.
 * The studio's smoke measures every cue with this in a real browser (studio/e2e/sound.spec.ts).
 */
export async function renderCue<K extends CueName>(name: K, args: CueArgs<K>, seconds = 1, data?: CueData): Promise<Float32Array> {
  const ac = new OfflineAudioContext(1, Math.ceil(48000 * seconds), 48000);
  scheduleCue(ac, ac.destination, data ? cueFrom(data, CUE_PARAMS[name], args) : cueOf(name, args), 0);
  return (await ac.startRendering()).getChannelData(0);
}

/** What one cue measured as, rendered offline. */
export interface CueMeasure {
  cue: CueName;
  args: readonly unknown[];
  /** Whose copies of the cue sound this way: "game" for the game's own, else each puzzle's id (ADR 0070). */
  sets: string[];
  /** Seconds from its start to its last sample above silence (-80 dBFS). */
  length: number;
  /** Its loudest sample, of full scale 1. */
  peak: number;
  /** Its first sample, and its loudest over the millisecond after its length: both should be nothing. */
  first: number;
  tail: number;
  /** The biggest jump from one sample to the next: a click would show here. */
  step: number;
}

/** Renders every cue, with every row of its `PROBES`, and measures each. */
export async function measureCues(): Promise<CueMeasure[]> {
  // Every copy of every cue, the game's and each puzzle's (ADR 0070); copies that are alike are rendered once.
  const copies = new Map<string, { cue: CueName; data: CueData; sets: string[] }>();
  const add = (set: string, cue: CueName, data: CueData | undefined): void => {
    if (!data) return;
    const key = `${cue}:${JSON.stringify(data)}`;
    const was = copies.get(key);
    if (was) was.sets.push(set);
    else copies.set(key, { cue, data, sets: [set] });
  };
  for (const cue of CUE_NAMES) add("game", cue, SHIPPED_CUES[cue]);
  for (const [id, cues] of Object.entries(PUZZLE_SHIPPED_CUES)) for (const cue of CUE_NAMES) add(id, cue, cues[cue]);
  const rows: CueMeasure[] = [];
  for (const { cue, data, sets } of copies.values()) {
    for (const args of PROBES[cue] as readonly CueArgs<typeof cue>[]) {
      const x = await renderCue(cue, args, 1, data);
      let last = -1;
      let peak = 0;
      let step = 0;
      for (let i = 0; i < x.length; i++) {
        const a = Math.abs(x[i]!);
        if (a > 1e-4) last = i;
        if (a > peak) peak = a;
        if (i > 0) step = Math.max(step, Math.abs(x[i]! - x[i - 1]!));
      }
      let tail = 0;
      for (let i = last + 1; i < Math.min(x.length, last + 49); i++) tail = Math.max(tail, Math.abs(x[i]!));
      rows.push({ cue, args, sets, length: (last + 1) / 48000, peak, first: Math.abs(x[0]!), tail, step });
    }
  }
  return rows;
}

/**
 * One moment: the cues asked for in one turn of the page's code (a frame of a board, an event's
 * handler). The beat's sound stands alone (docs/BRAND.md section 6): when the beat sounds, every
 * other cue of its moment is dropped, whether it was asked for before the beat or after, so a
 * fanfare or a sting a board or its page plays for the same event is never laid over it.
 */
interface Moment {
  buses: AudioNode[];
  beat: boolean;
  /** The beat that sounded in this moment. */
  rang: { bus: GainNode; strength: number } | null;
}
let moment: Moment | null = null;
function thisMoment(): Moment {
  if (!moment) {
    moment = { buses: [], beat: false, rang: null };
    queueMicrotask(() => (moment = null));
  }
  return moment;
}

/** How long before a cue starts, so its first voice is never scheduled in the past. */
const LEAD = 0.004;

/** Takes the beat's place in this moment, or says another cue may not sound in it. */
function admit(name: string): boolean {
  const m = thisMoment();
  if (name === "beat") {
    // Nothing of this moment has sounded yet: its cues are unplugged before a sample of them is heard.
    for (const bus of m.buses) bus.disconnect();
    m.buses.length = 0;
    m.beat = true;
    return true;
  }
  return !m.beat;
}

/** The beat that is ringing, if one is: a new beat takes it over, as the pulse does, and never stacks on it. */
let ringing: GainNode | null = null;

function play<K extends CueName>(name: K, args: CueArgs<K>): void {
  const c = context();
  if (!c) return;
  const now = c.ac.currentTime;
  const m = thisMoment();
  if (name === "beat") {
    const strength = Number(args[0] ?? 0);
    if (m.rang) {
      // Two beats asked for in one moment are one beat, the stronger: the other was never heard.
      if (strength <= m.rang.strength) return;
      m.rang.bus.disconnect();
    } else if (ringing) {
      // An earlier beat still ringing falls away as the new one rises.
      ringing.gain.setValueAtTime(ringing.gain.value, now);
      ringing.gain.linearRampToValueAtTime(0, now + 0.03);
    }
    ringing = scheduleCue(c.ac, c.out, cueOf(name, args), now + LEAD);
    m.rang = { bus: ringing, strength };
    return;
  }
  m.buses.push(scheduleCue(c.ac, c.out, cueOf(name, args), now + LEAD));
}

/**
 * Plays a cue that is data of a skin (ADR 0083), with the values its rules name: the domain
 * board's cues are its skin's own and have no place in `CUE_PARAMS`. A cue named `beat` is the
 * beat's: it is heard alone in its moment and takes over a beat still ringing, as the game's is.
 */
export function playCueData(name: string, data: CueData, values: Readonly<Record<string, number>> = {}): void {
  if (!admit(name)) return;
  const c = context();
  if (!c) return;
  const names = Object.keys(values);
  const cue = cueFrom(data, names.map((n) => ({ name: n, kind: "amount" as const })), names.map((n) => values[n]));
  const now = c.ac.currentTime;
  const m = thisMoment();
  if (name !== "beat") {
    m.buses.push(scheduleCue(c.ac, c.out, cue, now + LEAD));
    return;
  }
  const strength = values["strength"] ?? 0;
  if (m.rang) {
    if (strength <= m.rang.strength) return;
    m.rang.bus.disconnect();
  } else if (ringing) {
    ringing.gain.setValueAtTime(ringing.gain.value, now);
    ringing.gain.linearRampToValueAtTime(0, now + 0.03);
  }
  ringing = scheduleCue(c.ac, c.out, cue, now + LEAD);
  m.rang = { bus: ringing, strength };
}

type Synth = { [K in CueName]: (...args: CueArgs<K>) => void };

const synth = Object.fromEntries(CUE_NAMES.map((name) => [name, (...args: unknown[]) => play(name, args as CueArgs<typeof name>)])) as Synth;

export const sfx = {
  ...(Object.fromEntries(CUE_NAMES.map((name) => [name, (...args: unknown[]) => void (admit(name) && synth[name](...(args as never[])))])) as Synth),
  /**
   * A puzzle's own cue: a moment of its board that has a name of its own (Swordfighting's `clash`)
   * and is voiced by `fallback`, one or more of the cues above. `rate` is no longer heard: it
   * pitched a sample, and there are none (ADR 0062); a call may still pass it.
   */
  cue(name: string, fallback: () => void, _rate = 1): void {
    if (admit(name)) fallback();
  },
};

/**
 * Plays one cue with no board open, so it can be listened to (the studio's Sounds list), with the
 * first row of its `PROBES`. A puzzle's own cue (`sfx.cue`) has no voice of its name, so
 * `fallback` names the cues its renderer plays for it.
 */
export function auditionCue(cue: string, fallback: readonly string[] = []): void {
  for (const name of cue in synth ? [cue] : fallback) {
    const probe = PROBES[name as CueName] as readonly (readonly unknown[])[] | undefined;
    (synth[name as CueName] as ((...a: unknown[]) => void) | undefined)?.(...(probe?.[0] ?? []));
  }
}

/**
 * Plays a cue's data as the board would play it with `args`, before it is laid over the shipped
 * cue: what the studio's sound editor auditions while a voice is being moved (ADR 0065).
 */
export function auditionData(name: CueName, data: CueData, args: readonly unknown[]): void {
  const c = context();
  if (!c) return;
  scheduleCue(c.ac, c.out, cueFrom(data, CUE_PARAMS[name], args), c.ac.currentTime + LEAD);
}
