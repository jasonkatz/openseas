/**
 * Tiny WebAudio synth for UI/puzzle feedback. No assets required.
 * All sounds are short, cheap oscillator envelopes.
 */
export type Sfx = 'tap' | 'swap' | 'match' | 'combo' | 'drop' | 'lock' | 'clear' | 'bad' | 'win' | 'lose' | 'cannon' | 'splash' | 'bell' | 'coin' | 'sword' | 'hit';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.35;
}
export function isMuted(): boolean { return muted; }

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.5, slide = 0, delay = 0): void {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, vol = 0.4, delay = 0, lp = 1200): void {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lp;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export function play(s: Sfx, intensity = 1): void {
  if (muted) return;
  switch (s) {
    case 'tap': tone(520, 0.05, 'square', 0.15); break;
    case 'swap': tone(380, 0.07, 'triangle', 0.3, 120); break;
    case 'match': tone(660, 0.12, 'triangle', 0.35, 200); tone(880, 0.12, 'sine', 0.25, 200, 0.04); break;
    case 'combo': {
      const n = Math.min(6, 2 + Math.floor(intensity));
      for (let i = 0; i < n; i++) tone(520 + i * 110, 0.12, 'triangle', 0.3, 80, i * 0.05);
      break;
    }
    case 'drop': tone(220, 0.06, 'triangle', 0.25, -60); break;
    case 'lock': tone(160, 0.08, 'square', 0.2); noise(0.05, 0.15); break;
    case 'clear': tone(740, 0.18, 'sine', 0.35, 300); tone(1100, 0.2, 'sine', 0.25, 200, 0.06); break;
    case 'bad': tone(180, 0.2, 'sawtooth', 0.3, -80); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.35, 0, i * 0.12)); break;
    case 'lose': [440, 370, 311, 262].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.25, -20, i * 0.15)); break;
    case 'cannon': noise(0.35, 0.8, 0, 400); tone(70, 0.3, 'sine', 0.7, -40); break;
    case 'splash': noise(0.4, 0.4, 0, 2500); break;
    case 'bell': tone(1320, 0.5, 'sine', 0.3); tone(1980, 0.4, 'sine', 0.15, 0, 0.01); break;
    case 'coin': tone(1200, 0.08, 'square', 0.2); tone(1600, 0.12, 'square', 0.2, 0, 0.07); break;
    case 'sword': noise(0.12, 0.5, 0, 6000); tone(900, 0.1, 'sawtooth', 0.15, 600); break;
    case 'hit': noise(0.15, 0.6, 0, 800); tone(120, 0.15, 'square', 0.4, -60); break;
  }
}
