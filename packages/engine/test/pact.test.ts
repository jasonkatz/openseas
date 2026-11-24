import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_PACT_CONFIG,
  InvalidMoveError,
  createPactGame,
  hashPactState,
  pactCardOf,
  pactEstimate,
  pactHint,
  pactLegalCards,
  pactMoveIllegalReason,
  pactPlayable,
  pactSeatChoice,
  pactViewString,
  pactWinning,
  reducePact,
  replayPact,
  summarizePact,
  validatePactConfig,
  type PactConfig,
  type PactMove,
  type PactSeat,
  type PactState,
} from "../src/index.js";

const cfg: PactConfig = DEFAULT_PACT_CONFIG;
const picksArb = fc.array(fc.nat({ max: 20 }), { minLength: 0, maxLength: 160 });

/** The move the game is waiting for, the player's taken from `pick`: a bid of pick % 14, or the pick-th card they may play. */
function moveFor(state: PactState, pick: number): PactMove {
  if (state.phase === "over") return { type: "deal" };
  if (state.phase === "table") return { type: "next" };
  if (state.phase === "bid") return { type: "bid", bid: pick % 14 };
  const ok = pactPlayable(state);
  return { type: "play", card: ok[pick % ok.length]! };
}

function play(seed: string, picks: readonly number[], config: PactConfig = cfg): { moves: PactMove[]; state: PactState } {
  let state = createPactGame(seed, config);
  const moves: PactMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = moveFor(state, p);
    moves.push(m);
    state = reducePact(state, m);
  }
  return { moves, state };
}

/** A whole sitting, the player's seat played by the engine's own rule. */
function sitting(seed: string, config: PactConfig = cfg): PactState {
  let state = createPactGame(seed, config);
  let guard = 0;
  while (!state.finished && guard++ < 5000) {
    const m = state.phase === "bid" || state.phase === "play" ? pactHint(state)! : moveFor(state, 0);
    state = reducePact(state, m);
  }
  return state;
}

const cards = (names: string): number[] => names.split(" ").map(pactCardOf);

describe("pact determinism (ADR 0003)", () => {
  it("replay equals play", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = play(seed, picks);
        expect(hashPactState(replayPact(seed, cfg, moves))).toBe(hashPactState(state));
      }),
      { numRuns: 60 },
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.nat({ max: 20 }), (seed, picks, pick) => {
        const { state } = play(seed, picks);
        if (state.finished) return;
        const before = JSON.stringify(state);
        reducePact(state, moveFor(state, pick));
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different hands", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(pactViewString(createPactGame(`s${i}`, cfg)));
    expect(seen.size).toBe(20);
  });

  it("takes end as its first move, and an untouched sitting scores nothing", () => {
    const s = reducePact(createPactGame("x", cfg), { type: "end" });
    expect(s.finished).toBe(true);
    expect(summarizePact(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reducePact(s, { type: "deal" })).toThrow(InvalidMoveError);
  });

  it("refuses a bad config", () => {
    expect(() => validatePactConfig({ ...cfg, hands: 0 })).toThrow();
    expect(() => validatePactConfig({ ...cfg, bagLimit: -1 })).toThrow();
    expect(() => validatePactConfig(cfg)).not.toThrow();
  });
});

describe("pact rules", () => {
  it("deals thirteen cards to each seat, every card once", () => {
    const s = createPactGame("deal", cfg);
    const all = s.seats.flatMap((x) => x.cards);
    expect(s.seats.every((x) => x.cards.length === 13)).toBe(true);
    expect(new Set(all).size).toBe(52);
  });

  it("any sequence of play keeps every card exactly once, and the score never falls", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createPactGame(seed, cfg);
        let last = 0;
        for (const p of picks) {
          if (state.finished) break;
          if (state.phase !== "over") {
            const held = state.seats.flatMap((x) => x.cards);
            expect(new Set([...held, ...state.played]).size).toBe(52);
            expect(held.length + state.played.length).toBe(52);
          }
          state = reducePact(state, moveFor(state, p));
          expect(state.score).toBeGreaterThanOrEqual(last);
          last = state.score;
        }
      }),
      { numRuns: 40 },
    );
  });

  it("must follow suit, and may not lead spades until they are broken", () => {
    const hand = cards("2c 9c 4h As Ks");
    expect(pactLegalCards(hand, [{ card: pactCardOf("Tc") }], false).sort()).toEqual(cards("2c 9c").sort());
    expect(pactLegalCards(hand, [{ card: pactCardOf("Td") }], false)).toEqual(hand);
    expect(pactLegalCards(hand, [], false).sort()).toEqual(cards("2c 9c 4h").sort());
    expect(pactLegalCards(hand, [], true)).toEqual(hand);
    expect(pactLegalCards(cards("As Ks"), [], false)).toEqual(cards("As Ks"));
  });

  it("the highest spade takes a trick, else the highest of the suit led", () => {
    const t = (names: string) => names.split(" ").map((n, seat) => ({ seat, card: pactCardOf(n) }));
    expect(pactWinning(t("Tc Ac 2s Kc")).seat).toBe(2);
    expect(pactWinning(t("Tc Ad Kh 9c")).seat).toBe(0);
    expect(pactWinning(t("Tc Ad Jc 9c")).seat).toBe(2);
    expect(pactWinning(t("3s 2s As Kc")).seat).toBe(2);
  });

  it("refuses a card the player may not play, and a bid out of turn", () => {
    let s = createPactGame("rules", cfg);
    while (s.phase === "table") s = reducePact(s, { type: "next" });
    expect(s.phase).toBe("bid");
    expect(() => reducePact(s, { type: "bid", bid: 14 })).toThrow(InvalidMoveError);
    expect(() => reducePact(s, { type: "play", card: s.seats[0]!.cards[0]! })).toThrow(InvalidMoveError);
    s = reducePact(s, { type: "bid", bid: 3 });
    while (s.phase === "table") s = reducePact(s, { type: "next" });
    expect(s.phase).toBe("play");
    const stranger = s.seats[1]!.cards[0]!;
    expect(pactMoveIllegalReason(s, { type: "play", card: stranger })).toBe("not in your hand");
  });

  it("with nil off nobody bids nil", () => {
    const off = { ...cfg, nilBonus: 0 };
    let s = createPactGame("nonil", off);
    while (s.phase === "table") s = reducePact(s, { type: "next" });
    expect(pactMoveIllegalReason(s, { type: "bid", bid: 0 })).not.toBeNull();
    for (let i = 0; i < 30; i++) {
      const st = sitting(`nonil${i}`, { ...off, hands: 1 });
      expect(st.count!.us.nils.length + st.count!.them.nils.length).toBe(0);
    }
  });
});

/** A state at the end of a hand with these bids and tricks, ready to count by playing its last trick. */
function counted(bids: number[], tricks: number[], config: PactConfig = cfg, carried = { us: 0, them: 0 }): PactState {
  // Seat i holds one card; seat 0 leads the ace of spades and takes the last trick, which is added to seat 0's tricks.
  const last = cards("As 2s 3s 4s");
  const seats: PactSeat[] = bids.map((bid, i) => ({ cards: [last[i]!], bid, tricks: tricks[i]! - (i === 0 ? 1 : 0), voids: 0 }));
  const base = createPactGame("count", config);
  let s: PactState = {
    ...base,
    seats,
    toAct: 0,
    phase: "play",
    broken: true,
    trick: [],
    played: [],
    us: { total: 0, bags: carried.us },
    them: { total: 0, bags: carried.them },
  };
  s = reducePact(s, { type: "play", card: last[0]! });
  while (s.phase === "table") s = reducePact(s, { type: "next" });
  return s;
}

describe("pact count", () => {
  it("a made pact scores ten a trick and one a bag; a short one scores nothing, never below zero", () => {
    const s = counted([3, 4, 2, 3], [4, 4, 2, 3]);
    expect(s.count!.us.pact).toBe(5);
    expect(s.count!.us.took).toBe(6);
    expect(s.count!.us.pactPoints).toBe(50);
    expect(s.count!.us.bags).toBe(1);
    expect(s.count!.us.added).toBe(51);
    expect(s.count!.them.pact).toBe(7);
    expect(s.count!.them.took).toBe(7);
    expect(s.count!.them.added).toBe(70);
    const short = counted([5, 2, 4, 2], [4, 3, 3, 3]);
    expect(short.count!.us.raw).toBe(-90);
    expect(short.count!.us.added).toBe(0);
    expect(short.score).toBe(0);
    // Their pact was made with two bags; ours fell short, so they also take the set.
    expect(short.count!.them.added).toBe(40 + 2 + 90);
  });

  it("a nil made scores its bonus; a nil broken loses it, inside the hand's floor", () => {
    const made = counted([0, 4, 5, 3], [1, 4, 6, 2].map((x, i) => (i === 0 ? 1 : x)));
    // Seat 0 took the last trick, so this nil is broken: the partner's pact of 5 made with one over.
    expect(made.count!.us.nils).toEqual([{ seat: 0, made: false }]);
    expect(made.count!.us.raw).toBe(-100 + 50 + 1 + 1 + 70);
    const ok = counted([4, 0, 5, 3], [5, 0, 6, 2]);
    expect(ok.count!.them.nils).toEqual([{ seat: 1, made: true }]);
    expect(ok.count!.them.raw).toBe(100 - 30);
    // Ours made with two over, and theirs (a pact of 3) fell short by one.
    expect(ok.count!.us.added).toBe(90 + 2 + 30);
  });

  it("ten bags cost a hundred, and the rest carry", () => {
    const s = counted([2, 3, 2, 3], [5, 3, 2, 3], cfg, { us: 8, them: 0 });
    expect(s.count!.us.bags).toBe(3);
    expect(s.count!.us.penalty).toBe(100);
    expect(s.us.bags).toBe(1);
    expect(s.count!.us.added).toBe(0);
  });

  it("a sitting ends after its last hand, and its score is the side's total", () => {
    const st = sitting("whole");
    expect(st.finished).toBe(true);
    expect(st.handsDone).toBe(cfg.hands);
    expect(st.score).toBe(st.us.total);
  });
});

describe("pact seats", () => {
  it("bids by the strength of the hand", () => {
    expect(pactEstimate(cards("As Ks Qs Js Ts Ah Kh Ad Kd Ac Kc 2c 3c"))).toBeGreaterThan(90);
    expect(pactEstimate(cards("2s 3c 4c 5c 6c 7d 8d 9d 2h 3h 4h 5h 6h"))).toBeLessThan(10);
  });

  it("a seat's choice never depends on the cards it cannot see", () => {
    for (let i = 0; i < 30; i++) {
      let s = createPactGame(`peek${i}`, cfg);
      for (let k = 0; k < 25 + i; k++) s = reducePact(s, moveFor(s, k));
      if (s.phase === "over" || s.finished) continue;
      const seat = s.toAct;
      const others = s.seats.map((x, j) => (j === seat ? null : x.cards)).filter((x): x is readonly number[] => x !== null);
      // Shuffle the other seats' cards among them, each keeping its count.
      const pool = others.flat().reverse();
      let at = 0;
      const seats = s.seats.map((x, j) => (j === seat ? x : { ...x, cards: pool.slice(at, (at += x.cards.length)) }));
      expect(pactSeatChoice({ ...s, seats }, seat)).toEqual(pactSeatChoice(s, seat));
    }
  });

  it("over many sittings, the rule makes most of its pacts", () => {
    let made = 0;
    let hands = 0;
    for (let i = 0; i < 40; i++) {
      const st = sitting(`rule${i}`);
      made += st.made;
      hands += st.handsDone;
    }
    expect(made / hands).toBeGreaterThan(0.6);
  });
});
