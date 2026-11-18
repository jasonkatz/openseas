import { describe, expect, it } from "vitest";
import { DraftNumbersSchema, DraftSaveSchema, DraftSchema, StudioMeSchema, TakeHashSchema, TakeKindSchema, TesterLinkSchema } from "../src/index.js";

/**
 * Data kept before pieces were drawn in code and cues were only synthesized (ADR 0062) must keep
 * loading (ADR 0063, ADR 0064): a draft or a tester link may still carry picks, of a sprite or a
 * sound, and the service's table still holds takes. Picks are read and dropped, never refused.
 */
const HASH = "a".repeat(64);
const OLD_NUMBERS = { seed: "keg-3", overrides: { kinds: 6 }, roundSeconds: null, paceSeconds: null, thresholds: null, picks: { sprites: { "debris-gold": HASH }, sounds: { pop: HASH, thud: "synth" } }, words: { texts: { "salvage.title": "Haul" }, category: null } };
const at = "2026-01-01T00:00:00.000Z";

describe("stored studio data from before ADR 0062", () => {
  it("reads a draft's picks, sprites and sounds, and drops them, keeping its numbers and words", () => {
    const numbers = DraftNumbersSchema.parse(OLD_NUMBERS);
    expect(numbers).not.toHaveProperty("picks");
    expect(numbers.overrides).toEqual({ kinds: 6 });
    expect(numbers.seed).toBe("keg-3");
    expect(numbers.words).toEqual({ texts: { "salvage.title": "Haul" }, category: null });
  });

  it("reads picks of any shape: nothing of them is checked, so nothing of them can refuse a draft", () => {
    for (const picks of [{ sounds: { pop: "not-a-hash" } }, { sprites: 7 }, "nonsense", null, { sounds: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`cue${i}`, HASH])) }]) {
      const read = DraftNumbersSchema.safeParse({ ...OLD_NUMBERS, picks });
      expect(read.success).toBe(true);
      expect(read.data).not.toHaveProperty("picks");
    }
  });

  it("reads a stored draft and a tester link that carry picks", () => {
    const draft = DraftSchema.parse({ id: "draftdraft", puzzle: "salvage", owner: "octo", numbers: OLD_NUMBERS, revision: 3, createdAt: at, updatedAt: at });
    expect(draft.numbers).not.toHaveProperty("picks");
    expect(draft.numbers.overrides).toEqual({ kinds: 6 });
    const link = TesterLinkSchema.parse({ id: "linklink12", puzzle: "salvage", name: "Six kinds", author: "octo", draft: OLD_NUMBERS, createdAt: at, withdrawn: false });
    expect(link.draft).not.toHaveProperty("picks");
    expect(link.draft.overrides).toEqual({ kinds: 6 });
  });

  it("reads a draft whose last Save failed on a pick", () => {
    for (const error of ["pick", "takes"]) {
      const save = DraftSaveSchema.parse({ state: "failed", error, pull: null, savedRevision: null, behind: false, detail: "pop" });
      expect(save.error).toBe(error);
    }
  });

  it("still knows a take's hash and both kinds a kept take may be of", () => {
    expect(TakeHashSchema.safeParse(HASH).success).toBe(true);
    expect(TakeKindSchema.options).toEqual(["sprite", "sound"]);
  });

  it("reads who the caller is from a service that still says it keeps takes and picks", () => {
    const me = StudioMeSchema.parse({ login: "octo", signIn: true, dev: false, save: true, chat: true, takes: true, picks: true, words: true });
    expect(me).toEqual({ login: "octo", signIn: true, dev: false, save: true, chat: true, words: true, look: false });
  });
});

describe("a draft's look (ADR 0065)", () => {
  const drawing = { layers: [{ kind: "disc", x: 12, y: 12, r: 9 }] };
  const cue = { level: 1, cutoff: 1800, voices: [{ kind: "tone", note: 10, wave: "sine", at: 0, attack: 0.01, release: 0.1, level: 1 }] };

  it("reads a draft kept before there was a look as one with none", () => {
    const { picks: _picks, ...old } = OLD_NUMBERS;
    expect(DraftNumbersSchema.parse(old).look).toEqual({ pieces: {}, cues: {} });
  });

  it("keeps a draft's pieces and cues, and refuses one that is not a drawing or a cue", () => {
    const look = { pieces: { cog: drawing }, cues: { swap: cue } };
    expect(DraftNumbersSchema.parse({ ...OLD_NUMBERS, look }).look).toEqual(look);
    expect(DraftNumbersSchema.safeParse({ ...OLD_NUMBERS, look: { pieces: { cog: { layers: [] } }, cues: {} } }).success).toBe(false);
    expect(DraftNumbersSchema.safeParse({ ...OLD_NUMBERS, look: { pieces: {}, cues: { swap: { ...cue, voices: [{ ...cue.voices[0], note: 40 }] } } } }).success).toBe(false);
  });

  it("reads an arc step of a path as an arc, not as a point", async () => {
    const { DrawingSchema } = await import("../src/index.js");
    const path = { kind: "path", steps: [{ x: 6, y: 4 }, { x: 12, y: 12, r: 5, from: 180, to: 0, ccw: true }], width: 6 };
    expect(DrawingSchema.parse({ layers: [path] }).layers[0]).toEqual(path);
  });
});
