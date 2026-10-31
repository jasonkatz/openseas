/** Minimal synthesized sound effects via WebAudio (DESIGN.md 3.9). Replaced during the art pass. */
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
      master.gain.value = 0.9;
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

interface Tone {
  freq: number;
  to?: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  delay?: number;
  attack?: number;
}

function tone({ freq, to, duration, type, gain, delay = 0, attack = 0.005 }: Tone): void {
  const c = context();
  if (!c) return;
  const t0 = c.ac.currentTime + delay;
  const osc = c.ac.createOscillator();
  const g = c.ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(c.out);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Filtered noise: splashes, booms and whooshes. */
function noise(duration: number, gain: number, from: number, to: number, type: BiquadFilterType = "lowpass"): void {
  const c = context();
  if (!c) return;
  const t0 = c.ac.currentTime;
  const len = Math.ceil(c.ac.sampleRate * duration);
  const buf = c.ac.createBuffer(1, len, c.ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.ac.createBufferSource();
  src.buffer = buf;
  const f = c.ac.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + duration);
  const g = c.ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(f).connect(g).connect(c.out);
  src.start(t0);
}

/** A major pentatonic ladder, so longer cascades climb without ever sounding wrong. */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const note = (step: number): number => 392 * Math.pow(2, LADDER[Math.min(LADDER.length - 1, step)]! / 12);

export const sfx = {
  swap: () => tone({ freq: 520, to: 380, duration: 0.07, type: "triangle", gain: 0.05 }),
  /** A swap that clears nothing: a softer, woodier knock so scoring swaps stand out. */
  swapQuiet: () => tone({ freq: 300, to: 220, duration: 0.06, type: "triangle", gain: 0.035 }),
  /** One cascade step. `chain` 1 is the swap's own clear; each later step climbs the ladder. */
  clear: (chain: number, pieces: number) => {
    const f = note(chain - 1);
    tone({ freq: f, duration: 0.22, type: "sine", gain: 0.09 });
    tone({ freq: f * 1.5, duration: 0.18, type: "triangle", gain: 0.03, delay: 0.02 });
    if (pieces >= 5) tone({ freq: f * 2, duration: 0.3, type: "sine", gain: 0.04, delay: 0.06 });
    // Deep steps land with a low thump under the chime.
    if (chain >= 3) tone({ freq: 140, to: 70, duration: 0.25, type: "sine", gain: 0.12 });
    noise(0.12, 0.04, 2400, 600);
  },
  /** Clearing two or more runs at once: a quick bright arpeggio over the clear. */
  multi: (groups: number) => {
    for (let i = 0; i < Math.min(4, groups); i++) tone({ freq: note(4 + i * 2), duration: 0.16, type: "triangle", gain: 0.035, delay: 0.05 + i * 0.05 });
  },
  /** A streak milestone: a short rising fanfare, higher for longer streaks. */
  streak: (count: number) => {
    const lift = Math.min(4, Math.floor(count / 4));
    [0, 2, 4, 5].forEach((step, i) => tone({ freq: note(step + lift), duration: 0.22, type: "square", gain: 0.022, delay: i * 0.07 }));
    tone({ freq: note(7 + lift), duration: 0.5, type: "triangle", gain: 0.05, delay: 0.28 });
  },
  /** A streak of three or more just ended. */
  streakLost: () => tone({ freq: 330, to: 180, duration: 0.3, type: "sine", gain: 0.04 }),
  /** The water dropped a row: a pump stroke and a glug. */
  pump: (rows: number) => {
    noise(0.22, 0.07, 400, 1600, "bandpass");
    for (let i = 0; i < Math.min(3, rows); i++) tone({ freq: 180 + i * 40, to: 420 + i * 60, duration: 0.12, type: "sine", gain: 0.06, delay: 0.05 + i * 0.1 });
  },
  /** The water rose a row. */
  rise: () => tone({ freq: 260, to: 150, duration: 0.25, type: "sine", gain: 0.035 }),
  /** The water crossed into the danger half. */
  alarm: () => {
    tone({ freq: 620, duration: 0.14, type: "square", gain: 0.03 });
    tone({ freq: 460, duration: 0.18, type: "square", gain: 0.03, delay: 0.16 });
  },
  keg: () => {
    noise(0.5, 0.22, 900, 60);
    tone({ freq: 90, to: 38, duration: 0.45, type: "sine", gain: 0.22 });
  },
  ink: () => {
    noise(0.45, 0.08, 300, 3200, "bandpass");
    tone({ freq: 220, to: 660, duration: 0.35, type: "sine", gain: 0.04 });
  },
  barnacle: () => {
    tone({ freq: 700, to: 1400, duration: 0.09, type: "square", gain: 0.025 });
    tone({ freq: 1050, duration: 0.18, type: "sine", gain: 0.05, delay: 0.06 });
  },
  tick: (urgent: boolean) => tone({ freq: urgent ? 1180 : 880, duration: 0.05, type: "square", gain: 0.018 }),
  start: () => {
    tone({ freq: 392, duration: 0.14, type: "triangle", gain: 0.06 });
    tone({ freq: 587, duration: 0.22, type: "triangle", gain: 0.06, delay: 0.1 });
  },
  end: () => {
    [523, 659, 784, 1047].forEach((freq, i) => tone({ freq, duration: 0.4, type: "triangle", gain: 0.05, delay: i * 0.09 }));
  },
};
