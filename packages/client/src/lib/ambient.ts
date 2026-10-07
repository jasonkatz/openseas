/**
 * Procedural sea ambience: filtered noise with a slow swell, no assets.
 * Starts on the first user gesture (browsers block audio before that).
 */
let started = false;
let gain: GainNode | null = null;
let ctx: AudioContext | null = null;
let level = 0.18;

function build(): void {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new AC();
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(2, sr * 4, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      // pink-ish noise
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.08;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  // swell: LFO on the filter cutoff and gain
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.11;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 350;
  lfo.connect(lfoGain).connect(lp.frequency);
  gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(lp).connect(gain).connect(ctx.destination);
  src.start();
  lfo.start();
}

/** Call from any user gesture; safe to call repeatedly. */
export function startAmbient(muted: boolean): void {
  if (typeof window === 'undefined') return;
  if (!started) {
    try { build(); } catch { return; }
    started = true;
  }
  if (ctx && ctx.state === 'suspended') void ctx.resume();
  setAmbientMuted(muted);
}

export function setAmbientMuted(muted: boolean): void {
  if (!gain || !ctx) return;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.linearRampToValueAtTime(muted ? 0 : level, ctx.currentTime + 1.2);
}

/** Louder at sea, quieter ashore. */
export function setAmbientScene(scene: 'island' | 'ship' | 'puzzle', muted: boolean): void {
  level = scene === 'ship' ? 0.26 : scene === 'puzzle' ? 0.08 : 0.16;
  setAmbientMuted(muted);
}
