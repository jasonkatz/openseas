/**
 * Sound effects (DESIGN.md 3.9, docs/BRAND.md section 8). Every cue is synthesized here from its
 * definition in `cues.ts`: a few soft voices on the notes of one scale, through a low-pass. A cue
 * plays the open puzzle's own sample where the owner has picked one (`sounds/<puzzle>/<cue>.mp3`,
 * ADR 0040 and 0041), and its synthesized voice otherwise.
 */
import { CUE_NAMES, LIMITS, NOTES, PROBES, cueOf, envelope, type Cue, type CueArgs, type CueName } from "./cues.js";

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

function context(): { ac: AudioContext; out: GainNode } | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (!master) {
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return { ac: ctx, out: master };
  } catch {
    return null;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
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
export async function renderCue<K extends CueName>(name: K, args: CueArgs<K>, seconds = 1): Promise<Float32Array> {
  const ac = new OfflineAudioContext(1, Math.ceil(48000 * seconds), 48000);
  scheduleCue(ac, ac.destination, cueOf(name, args), 0);
  return (await ac.startRendering()).getChannelData(0);
}

/** What one cue measured as, rendered offline. */
export interface CueMeasure {
  cue: CueName;
  args: readonly unknown[];
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
  const rows: CueMeasure[] = [];
  for (const cue of CUE_NAMES) {
    for (const args of PROBES[cue] as readonly CueArgs<typeof cue>[]) {
      const x = await renderCue(cue, args, 1);
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
      rows.push({ cue, args, length: (last + 1) / 48000, peak, first: Math.abs(x[0]!), tail, step });
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

type Synth = { [K in CueName]: (...args: CueArgs<K>) => void };

const synth = Object.fromEntries(CUE_NAMES.map((name) => [name, (...args: unknown[]) => play(name, args as CueArgs<typeof name>)])) as Synth;

// ---- Samples (ADR 0041)

/** Samples are mastered to peak at -1 dB; this sits them level with the synthesized cues. */
const SAMPLE_GAIN = 0.25;
const files = import.meta.glob<string>("./sounds/*/*.mp3", { query: "?url", import: "default", eager: true });
const banks = new Map<string, Map<string, AudioBuffer>>();
/** The puzzles whose boards are open, the latest last: its samples are the ones that play. */
const open: string[] = [];

function loadBank(puzzle: string): void {
  if (banks.has(puzzle)) return;
  const bank = new Map<string, AudioBuffer>();
  banks.set(puzzle, bank);
  if (typeof OfflineAudioContext === "undefined") return;
  // An offline context decodes without waiting for the player's first touch.
  const decoder = new OfflineAudioContext(1, 1, 44100);
  for (const [path, url] of Object.entries(files)) {
    const m = /^\.\/sounds\/([^/]+)\/([^/]+)\.mp3$/.exec(path);
    if (!m || m[1] !== puzzle) continue;
    const cue = m[2]!;
    void fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((data) => decoder.decodeAudioData(data))
      .then(
        (buffer) => void bank.set(cue, buffer),
        () => {
          /* the synthesized cue stays */
        },
      );
  }
}

/** A cue's voice chosen over the bundled one (ADR 0050), by puzzle then cue: a decoded sample, or the synthesized cue. */
const picked = new Map<string, Map<string, AudioBuffer | "synth">>();

/** The cues a puzzle has a bundled sample for. */
export function sampleCues(puzzle: string): string[] {
  const cues: string[] = [];
  for (const path of Object.keys(files)) {
    const m = /^\.\/sounds\/([^/]+)\/([^/]+)\.mp3$/.exec(path);
    if (m && m[1] === puzzle) cues.push(m[2]!);
  }
  return cues;
}

/**
 * Gives a puzzle's cue another voice (ADR 0050): the sound at a URL, the synthesized cue though a
 * sample is bundled (`"synth"`), or with `null` what the build ships. Presentation only, and it
 * takes hold on the next time the cue plays. False when the sound does not load or decode, and
 * then nothing changes.
 */
export async function overrideSample(puzzle: string, cue: string, voice: string | null): Promise<boolean> {
  const mine = picked.get(puzzle) ?? new Map<string, AudioBuffer | "synth">();
  if (voice === null) mine.delete(cue);
  else if (voice === "synth") mine.set(cue, "synth");
  else {
    if (typeof OfflineAudioContext === "undefined") return false;
    try {
      const res = await fetch(voice);
      if (!res.ok) return false;
      mine.set(cue, await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await res.arrayBuffer()));
    } catch {
      return false;
    }
  }
  picked.set(puzzle, mine);
  return true;
}

/** A board opening: its puzzle's samples load and play until the returned release is called. */
export function soundsFor(puzzle: string): () => void {
  loadBank(puzzle);
  open.push(puzzle);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const i = open.lastIndexOf(puzzle);
    if (i >= 0) open.splice(i, 1);
  };
}

/** Plays a puzzle's sample for a cue, pitched by `rate`: the open puzzle's unless one is named. False when there is none, or the synthesized cue was chosen over it. */
function playSample(cue: string, rate: number, puzzle: string | undefined = open[open.length - 1]): boolean {
  if (!puzzle) return false;
  const own = picked.get(puzzle)?.get(cue);
  const buffer = own === "synth" ? undefined : (own ?? banks.get(puzzle)?.get(cue));
  if (!buffer) return false;
  const c = context();
  if (!c) return true;
  const src = c.ac.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = c.ac.createGain();
  g.gain.value = SAMPLE_GAIN;
  src.connect(g).connect(c.out);
  src.start();
  thisMoment().buses.push(g);
  return true;
}

/** How far a cue's sample is pitched by its argument, so a ladder still climbs with a sample. */
const rates: { [K in CueName]?: (...args: CueArgs<K>) => number } = {
  clear: (chain) => 2 ** (Math.max(0, chain - 1) / 6),
  pop: (step) => 2 ** (Math.max(0, step) / 6),
  ping: (near) => Math.pow(2, -Math.min(8, Math.max(0, near)) / 6),
};

const voiced = Object.fromEntries(
  CUE_NAMES.map((cue) => [
    cue,
    (...args: unknown[]) => {
      if (!admit(cue)) return;
      const rate = (rates[cue] as ((...a: unknown[]) => number) | undefined)?.(...args) ?? 1;
      if (!playSample(cue, rate)) (synth[cue] as (...a: unknown[]) => void)(...args);
    },
  ]),
) as Synth;

export const sfx = {
  ...voiced,
  /** A puzzle's own cue: its sample when there is one, else `fallback`, a synthesized cue. */
  cue(name: string, fallback: () => void, rate = 1): void {
    if (!admit(name)) return;
    if (!playSample(name, rate)) fallback();
  },
};

/**
 * Plays one of a puzzle's cues with no board open, so it can be listened to (ADR 0050): its
 * sample where it has one, else its synthesized voice. `synth` asks for the synthesized voice
 * whatever sample there is. A puzzle's own cue (`sfx.cue`) has no synthesized voice of its name,
 * so `fallback` names the synthesized cues its renderer plays behind it.
 */
export function auditionCue(puzzle: string, cue: string, options: { synth?: boolean; fallback?: readonly string[] } = {}): void {
  loadBank(puzzle);
  if (!options.synth && playSample(cue, 1, puzzle)) return;
  for (const name of cue in synth ? [cue] : (options.fallback ?? [])) {
    const probe = PROBES[name as CueName] as readonly (readonly unknown[])[] | undefined;
    (synth[name as CueName] as ((...a: unknown[]) => void) | undefined)?.(...(probe?.[0] ?? []));
  }
}
