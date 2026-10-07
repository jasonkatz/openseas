/** Minimal synthesized sound effects via WebAudio (DESIGN.md 3.9). Replaced during the art pass. */
let ctx: AudioContext | null = null;
let muted = false;

function context(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function setMuted(m: boolean): void {
  muted = m;
}

function blip(freq: number, duration: number, type: OscillatorType, gain: number): void {
  const ac = context();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, ac.currentTime + duration);
  g.gain.setValueAtTime(gain, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
  osc.connect(g).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration);
}

export const sfx = {
  swap: () => blip(220, 0.06, "triangle", 0.05),
  clear: (chain: number) => blip(330 * Math.min(4, 1 + chain * 0.25), 0.16, "sine", 0.08),
  special: () => blip(110, 0.3, "sawtooth", 0.07),
  end: () => blip(440, 0.5, "sine", 0.06),
};
