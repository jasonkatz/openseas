import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUES, CUE_NAMES, LIMITS, NOTES, PROBES, SCALE, cueLength, cueOf, envelope, type Cue, type CueName, type Tone } from "@openseas/boards/cues";

/**
 * The sound rules of the brand book (docs/BRAND.md section 8), held over the cue definitions as
 * data: one key, a soft attack, a low-pass, a short length. What these cannot see, how loud a cue
 * comes out and whether it clicks, is measured in a real browser by e2e/sound.spec.ts.
 */

/** Every cue with every row of its probes: the whole range a board may ask for. */
const ALL: { name: CueName; args: readonly unknown[]; cue: Cue }[] = CUE_NAMES.flatMap((name) => (PROBES[name] as readonly (readonly unknown[])[]).map((args) => ({ name, args, cue: cueOf(name, args as never) })));
const label = (c: { name: string; args: readonly unknown[] }): string => `${c.name}(${c.args.join(", ")})`;
const tones = (cue: Cue): Tone[] => cue.voices.filter((v): v is Tone => v.kind === "tone");
/** A cue's notes in the order they start. */
const melody = (cue: Cue): number[] =>
  tones(cue)
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((v) => v.note);

describe("the one key (docs/BRAND.md section 8)", () => {
  it("is a pentatonic scale across three octaves, named in one constant", () => {
    expect(SCALE.semitones).toHaveLength(5);
    expect(SCALE.octaves).toBeGreaterThanOrEqual(2);
    expect(SCALE.octaves).toBeLessThanOrEqual(3);
    expect(NOTES).toHaveLength(SCALE.semitones.length * SCALE.octaves + 1);
    NOTES.forEach((hz, i) => {
      const semis = 12 * Math.log2(hz / SCALE.rootHz);
      expect(Math.abs(semis - Math.round(semis)), `note ${i}`).toBeLessThan(1e-9);
      expect(SCALE.semitones as readonly number[], `note ${i}`).toContain(((Math.round(semis) % 12) + 12) % 12);
      if (i > 0) expect(hz).toBeGreaterThan(NOTES[i - 1]!);
    });
  });

  it("every pitched voice of every cue is a note of it", () => {
    for (const c of ALL)
      for (const v of tones(c.cue)) {
        expect(Number.isInteger(v.note), label(c)).toBe(true);
        expect(v.note, label(c)).toBeGreaterThanOrEqual(0);
        expect(v.note, label(c)).toBeLessThan(NOTES.length);
        // A tone names a step of the scale and nothing else: there is no field to put a frequency in.
        expect(Object.keys(v).sort(), label(c)).toEqual(["at", "attack", "kind", "level", "note", "release", "wave"]);
      }
  });

  it("the player sounds a tone at its note and nowhere else", () => {
    const audio = readFileSync(fileURLToPath(new URL("../../boards/src/audio.ts", import.meta.url)), "utf8");
    // One oscillator, pitched from the scale, never swept; no bright wave and no unseeded noise.
    expect(audio.match(/createOscillator\(/g)).toHaveLength(1);
    expect(audio).toContain("osc.frequency.value = NOTES[v.note]!");
    expect(audio.match(/osc\.frequency/g)).toHaveLength(1);
    expect(audio).not.toMatch(/sawtooth|square|Math\.random|detune|createStereoPanner|createPanner/);
  });
});

describe("the cues (docs/BRAND.md section 8, ADR 0062 decision 5)", () => {
  it("keeps every cue's name, and adds the beat's", () => {
    expect([...CUE_NAMES].sort()).toEqual(
      ["alarm", "bad", "beat", "bump", "charge", "clear", "crack", "end", "good", "magnet", "multi", "plateLift", "ping", "pop", "power", "rise", "slag", "start", "streak", "streakLost", "swap", "swapQuiet", "thud", "tick", "vent", "welder", "whoosh", "zap"].sort(),
    );
    expect(Object.keys(PROBES).sort()).toEqual(Object.keys(CUES).sort());
  });

  for (const c of ALL) {
    it(`${label(c)}: soft, low-passed and short`, () => {
      const limit = c.name === "beat" ? LIMITS.beat : LIMITS.cue;
      expect(cueLength(c.cue)).toBeLessThanOrEqual(limit + 1e-9);
      expect(c.cue.cutoff).toBeLessThanOrEqual(LIMITS.cutoff);
      expect(c.cue.gain).toBeGreaterThan(0);
      for (const v of c.cue.voices) {
        expect(v.at).toBeGreaterThanOrEqual(0);
        expect(v.attack).toBeGreaterThanOrEqual(LIMITS.attack);
        expect(v.release).toBeGreaterThan(0);
        expect(v.level).toBeGreaterThan(0);
        expect(v.level).toBeLessThanOrEqual(1);
        if (v.kind === "tone") expect(["sine", "triangle"]).toContain(v.wave);
        else {
          expect(Math.max(v.from, v.to)).toBeLessThanOrEqual(LIMITS.cutoff);
          expect(Math.min(v.from, v.to)).toBeGreaterThan(0);
        }
        // The envelope leaves zero and comes back to it, and never jumps: a millisecond moves it a little.
        const curve = envelope(v.attack, v.release);
        expect(curve[0]).toBe(0);
        expect(curve[curve.length - 1]).toBe(0);
        let step = 0;
        for (let i = 1; i < curve.length; i++) step = Math.max(step, Math.abs(curve[i]! - curve[i - 1]!));
        expect(Math.max(...curve)).toBeLessThanOrEqual(1);
        expect(step).toBeLessThan(0.25);
      }
    });
  }

  it("the beat rings longer than any cue, and a stronger beat is a little louder, never different", () => {
    const [weak, strong] = [cueOf("beat", [0]), cueOf("beat", [1])];
    expect(cueLength(weak)).toBeGreaterThan(LIMITS.cue);
    expect(weak.voices).toEqual(strong.voices);
    expect(strong.gain).toBeGreaterThan(weak.gain);
    expect(strong.gain / weak.gain).toBeLessThan(1.5);
    // Low: the root, and nothing above the middle of the scale.
    expect(melody(weak)).toContain(0);
    expect(Math.max(...melody(weak))).toBeLessThanOrEqual(7);
  });

  it("what rises steps up the scale and what falls steps down", () => {
    const rising = (notes: number[]): boolean => notes.every((n, i) => i === 0 || n > notes[i - 1]!);
    const falling = (notes: number[]): boolean => notes.every((n, i) => i === 0 || n < notes[i - 1]!);
    for (const c of ALL) {
      if (["streak", "good", "start", "end", "power", "plateLift", "rise", "magnet"].includes(c.name)) expect(rising(melody(c.cue)), label(c)).toBe(true);
      if (["streakLost", "bad", "alarm"].includes(c.name)) expect(falling(melody(c.cue)), label(c)).toBe(true);
    }
    // A longer streak starts higher, a deeper chain and a longer line climb, a farther sounding is lower.
    expect(melody(cueOf("streak", [16]))[0]).toBeGreaterThan(melody(cueOf("streak", [4]))[0]!);
    expect(melody(cueOf("clear", [4, 3]))[0]).toBeGreaterThan(melody(cueOf("clear", [1, 3]))[0]!);
    expect(melody(cueOf("pop", [5]))[0]).toBeGreaterThan(melody(cueOf("pop", [0]))[0]!);
    expect(melody(cueOf("ping", [6]))[0]).toBeLessThan(melody(cueOf("ping", [0]))[0]!);
  });

  it("a bad thing is low and soft: never a buzzer", () => {
    for (const name of ["alarm", "bad", "rise", "bump"] as const) {
      const cue = cueOf(name, []);
      // At or under the A below middle C, through a low-pass well under the brightest.
      expect(Math.max(...melody(cue)), name).toBeLessThanOrEqual(6);
      expect(cue.cutoff, name).toBeLessThanOrEqual(1000);
    }
    expect(tones(cueOf("alarm", []))).toHaveLength(2);
  });
});

/** The least of WebAudio the player touches, counting what is plugged into the output. */
class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  setValueCurveAtTime(): void {}
}
class FakeNode {
  to: unknown = null;
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  type = "";
  buffer: unknown = null;
  connect<T>(node: T): T {
    this.to = node;
    return node;
  }
  disconnect(): void {
    this.to = null;
  }
  start(): void {}
  stop(): void {}
}
class FakeContext {
  static made: FakeNode[] = [];
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  destination = new FakeNode();
  private node(): FakeNode {
    const n = new FakeNode();
    FakeContext.made.push(n);
    return n;
  }
  createGain = (): FakeNode => this.node();
  createBiquadFilter = (): FakeNode => this.node();
  createOscillator = (): FakeNode => this.node();
  createBufferSource = (): FakeNode => this.node();
  createDynamicsCompressor = (): FakeNode => this.node();
  resume = (): Promise<void> => Promise.resolve();
  suspend = (): Promise<void> => Promise.resolve();
  createBuffer = (_c: number, n: number): unknown => ({ getChannelData: () => new Float32Array(n) });
}

describe("the beat's sound stands alone (docs/BRAND.md section 6)", () => {
  /** How many cues are plugged into the master: each cue leaves by one node. */
  const sounding = (): number => {
    // The master feeds the limiter, and the limiter is the one node plugged into the destination.
    const limiter = FakeContext.made.find((n) => n.to instanceof FakeNode && !FakeContext.made.includes(n.to));
    const master = FakeContext.made.find((n) => n.to === limiter);
    return FakeContext.made.filter((n) => n.to === master).length;
  };
  const nextMoment = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    FakeContext.made = [];
    vi.resetModules();
    vi.stubGlobal("AudioContext", FakeContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a cue asked for in the beat's moment, before it or after it, is not heard", async () => {
    const { sfx } = await import("@openseas/boards/audio");
    sfx.clear(3, 6);
    sfx.multi(2);
    expect(sounding()).toBe(2);
    sfx.beat(0.5);
    expect(sounding()).toBe(1);
    sfx.streak(8);
    sfx.cue("won", sfx.end);
    expect(sounding()).toBe(1);
    // The next moment is its own: cues sound again.
    await nextMoment();
    sfx.clear(1, 3);
    expect(sounding()).toBe(2);
  });

  it("two beats in one moment are one beat", async () => {
    const { sfx } = await import("@openseas/boards/audio");
    sfx.beat(1);
    sfx.beat(0.5);
    expect(sounding()).toBe(1);
    await nextMoment();
    sfx.beat(0.4);
    sfx.beat(0.9);
    // The earlier moment's beat is still plugged in, falling away; this moment added one, not two.
    expect(sounding()).toBe(2);
  });
});
