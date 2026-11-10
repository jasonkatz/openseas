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

/** Filtered noise: hisses, booms and whooshes. */
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
  /** A swap that clears nothing: a soft metal click so scoring swaps stand out. */
  swapQuiet: () => {
    tone({ freq: 880, to: 620, duration: 0.04, type: "triangle", gain: 0.022 });
    noise(0.025, 0.02, 5200, 2600, "highpass");
  },
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
  /** The heat dropped a row: a burst of steam through a valve, a falling whistle a row. */
  vent: (rows: number) => {
    noise(0.32, 0.07, 6000, 1800, "highpass");
    for (let i = 0; i < Math.min(3, rows); i++) tone({ freq: 1400 - i * 120, to: 700 - i * 60, duration: 0.18, type: "sine", gain: 0.018, delay: 0.04 + i * 0.09 });
  },
  /** The heat rose a row. */
  rise: () => tone({ freq: 260, to: 150, duration: 0.25, type: "sine", gain: 0.035 }),
  /** The heat crossed into the danger half. */
  alarm: () => {
    tone({ freq: 620, duration: 0.14, type: "square", gain: 0.03 });
    tone({ freq: 460, duration: 0.18, type: "square", gain: 0.03, delay: 0.16 });
  },
  charge: () => {
    noise(0.5, 0.22, 900, 60);
    tone({ freq: 90, to: 38, duration: 0.45, type: "sine", gain: 0.22 });
  },
  magnet: () => {
    noise(0.45, 0.08, 300, 3200, "bandpass");
    tone({ freq: 220, to: 660, duration: 0.35, type: "sine", gain: 0.04 });
  },
  slag: () => {
    tone({ freq: 700, to: 1400, duration: 0.09, type: "square", gain: 0.025 });
    tone({ freq: 1050, duration: 0.18, type: "sine", gain: 0.05, delay: 0.06 });
  },
  /** Plating: a plate welded down. A crackle of arc and a ringing clank, duller when the plate hangs over sound hull. */
  welder: (waste: boolean) => {
    noise(0.09, waste ? 0.035 : 0.06, 7000, 3000, "highpass");
    tone({ freq: 95, duration: 0.08, type: "sawtooth", gain: waste ? 0.02 : 0.03 });
    tone({ freq: waste ? 330 : 520, to: waste ? 260 : 470, duration: waste ? 0.12 : 0.22, type: "triangle", gain: waste ? 0.05 : 0.07, delay: 0.06 });
    // Inharmonic partials make it ring like a plate rather than a bell.
    if (!waste) tone({ freq: 1370, to: 1290, duration: 0.16, type: "sine", gain: 0.018, delay: 0.06 });
  },
  /** Plating: a sealed breach's plates lift away. A pneumatic hiss under a rising servo whine. */
  plateLift: () => {
    noise(0.3, 0.045, 2600, 900, "bandpass");
    tone({ freq: 300, to: 720, duration: 0.3, type: "square", gain: 0.012 });
    tone({ freq: 600, to: 1440, duration: 0.3, type: "sine", gain: 0.02 });
  },
  /** Plating: hull plating tears open. A shriek of metal and a low structural groan. */
  crack: (loud: boolean) => {
    noise(0.14, loud ? 0.09 : 0.055, 4200, 900, "highpass");
    tone({ freq: loud ? 1900 : 1500, to: loud ? 700 : 600, duration: loud ? 0.18 : 0.1, type: "sawtooth", gain: loud ? 0.015 : 0.01 });
    tone({ freq: 95, to: 48, duration: loud ? 0.4 : 0.22, type: "sawtooth", gain: loud ? 0.05 : 0.03, delay: 0.04 });
  },
  /** A plate will not go there. A short dead thunk on metal. */
  bump: () => {
    noise(0.04, 0.03, 900, 250);
    tone({ freq: 140, to: 95, duration: 0.08, type: "triangle", gain: 0.05 });
  },
  // ---- placeholder sounds for prototype boards (ADR 0036), generic on purpose
  /** A piece picked, stepped onto or added to a line: `step` climbs the ladder, so a long line sings upward. */
  pop: (step: number) => tone({ freq: note(step), duration: 0.1, type: "sine", gain: 0.06 }),
  /** A discharge: a bright crackle falling away. */
  zap: () => {
    noise(0.16, 0.07, 5200, 900, "bandpass");
    tone({ freq: 980, to: 240, duration: 0.14, type: "sawtooth", gain: 0.035 });
  },
  /** Something sliding or flying off. */
  whoosh: () => noise(0.24, 0.05, 500, 2600, "bandpass"),
  /** Something heavy stopping. */
  thud: () => {
    noise(0.06, 0.05, 700, 180);
    tone({ freq: 140, to: 62, duration: 0.13, type: "sine", gain: 0.14 });
  },
  /** A sonar ping; `near` 0 (close) to 6 (far) lowers the pitch. */
  ping: (near: number) => {
    const f = 1320 * Math.pow(2, -Math.min(8, Math.max(0, near)) / 6);
    tone({ freq: f, duration: 0.5, type: "sine", gain: 0.055, attack: 0.002 });
    tone({ freq: f * 2, duration: 0.2, type: "sine", gain: 0.015, delay: 0.01 });
  },
  /** A small right answer. */
  good: () => {
    tone({ freq: 660, duration: 0.1, type: "triangle", gain: 0.05 });
    tone({ freq: 990, duration: 0.18, type: "triangle", gain: 0.05, delay: 0.08 });
  },
  /** A wrong answer or a penalty. */
  bad: () => {
    tone({ freq: 220, duration: 0.14, type: "square", gain: 0.035 });
    tone({ freq: 156, duration: 0.24, type: "square", gain: 0.035, delay: 0.12 });
  },
  /** Power building: `level` 0 to 1 raises the sweep. */
  power: (level: number) => tone({ freq: 180 + level * 220, to: 360 + level * 520, duration: 0.2, type: "sawtooth", gain: 0.03 }),
  tick: (urgent: boolean) => tone({ freq: urgent ? 1180 : 880, duration: 0.05, type: "square", gain: 0.018 }),
  start: () => {
    tone({ freq: 392, duration: 0.14, type: "triangle", gain: 0.06 });
    tone({ freq: 587, duration: 0.22, type: "triangle", gain: 0.06, delay: 0.1 });
  },
  end: () => {
    [523, 659, 784, 1047].forEach((freq, i) => tone({ freq, duration: 0.4, type: "triangle", gain: 0.05, delay: i * 0.09 }));
  },
};
