import { describe, expect, it } from "vitest";
import { DraftNumbersSchema, DraftSchema, PicksSchema, TakeListSchema, TesterLinkSchema, pickCount, picksOf } from "../src/index.js";

/**
 * Data kept before pieces were drawn in code (ADR 0062) must keep loading (ADR 0063): a draft, a
 * tester link or an address may still carry sprite picks, and the service's table still holds
 * sprite takes. They are read and dropped, never refused.
 */
const HASH = "a".repeat(64);
const OLD_NUMBERS = { seed: "keg-3", overrides: { kinds: 6 }, roundSeconds: null, paceSeconds: null, thresholds: null, picks: { sprites: { "debris-gold": HASH }, sounds: { pop: HASH, thud: "synth" } } };
const at = "2026-01-01T00:00:00.000Z";

describe("stored studio data from before pieces were drawn in code", () => {
  it("reads a draft's sprite picks and drops them, keeping its sound picks", () => {
    const numbers = DraftNumbersSchema.parse(OLD_NUMBERS);
    expect(numbers.picks).toEqual({ sounds: { pop: HASH, thud: "synth" } });
    expect(numbers.overrides).toEqual({ kinds: 6 });
    expect(pickCount(OLD_NUMBERS)).toBe(2);
    expect(picksOf(OLD_NUMBERS)).toEqual({ sounds: { pop: HASH, thud: "synth" } });
  });

  it("reads picks that are only sprites as no picks", () => {
    expect(PicksSchema.parse({ sprites: { cog: HASH } })).toEqual({ sounds: {} });
    expect(pickCount({ picks: { sprites: { cog: HASH } } as never })).toBe(0);
  });

  it("reads a stored draft and a tester link that carry sprite picks", () => {
    const draft = DraftSchema.parse({ id: "draftdraft", puzzle: "salvage", owner: "octo", numbers: OLD_NUMBERS, revision: 3, createdAt: at, updatedAt: at });
    expect(draft.numbers.picks).toEqual({ sounds: { pop: HASH, thud: "synth" } });
    const link = TesterLinkSchema.parse({ id: "linklink12", puzzle: "salvage", name: "Six kinds", author: "octo", draft: OLD_NUMBERS, createdAt: at, withdrawn: false });
    expect(link.draft.picks).toEqual({ sounds: { pop: HASH, thud: "synth" } });
  });

  it("reads a list that still holds a sprite take", () => {
    const take = { hash: HASH, puzzle: "salvage", bytes: 10, prompt: null, draft: null, take: null, createdAt: at };
    const { takes } = TakeListSchema.parse({ takes: [{ ...take, kind: "sprite", name: "debris-gold" }, { ...take, kind: "sound", name: "pop" }] });
    expect(takes.map((t) => t.kind)).toEqual(["sprite", "sound"]);
  });
});
