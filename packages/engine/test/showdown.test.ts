import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_SHOWDOWN_CONFIG,
  InvalidMoveError,
  createShowdownGame,
  hashShowdownState,
  reduceShowdown,
  replayShowdown,
  seedFromString,
  showdownBestFive,
  showdownBoardShowing,
  showdownEquity,
  showdownHandName,
  showdownHandValue,
  showdownHint,
  showdownMoveIllegalReason,
  showdownOwed,
  showdownPot,
  showdownStyleChoice,
  showdownViewString,
  summarizeShowdown,
  validateShowdownConfig,
  type ShowdownConfig,
  type ShowdownMove,
  type ShowdownState,
} from "../src/index.js";

const cfg: ShowdownConfig = { ...DEFAULT_SHOWDOWN_CONFIG, samples: 24 };
const choicesArb = fc.array(fc.nat({ max: 5 }), { minLength: 0, maxLength: 120 });

/** The move the game is waiting for, the player's taken from `pick`: 0 or 1 folds or calls, the rest raise where they can. */
function moveFor(state: ShowdownState, pick: number): ShowdownMove {
  if (state.phase === "over") return { type: "deal" };
  if (state.phase === "table") return { type: "next" };
  const want: ShowdownMove = pick === 0 ? { type: "fold" } : pick <= 2 ? { type: "call" } : { type: "raise" };
  return showdownMoveIllegalReason(state, want) === null ? want : { type: "call" };
}

function play(seed: string, picks: readonly number[], config: ShowdownConfig = cfg): { moves: ShowdownMove[]; state: ShowdownState } {
  let state = createShowdownGame(seed, config);
  const moves: ShowdownMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = moveFor(state, p);
    moves.push(m);
    state = reduceShowdown(state, m);
  }
  return { moves, state };
}

/** Play a whole sitting by `pick`, the same choice each time. */
function sitting(seed: string, pick: number, config: ShowdownConfig = cfg): ShowdownState {
  let state = createShowdownGame(seed, config);
  let guard = 0;
  while (!state.finished && guard++ < 5000) state = reduceShowdown(state, moveFor(state, pick));
  return state;
}

/** Cards by name: rank then suit (`s` star, `m` moon, `r` ring, `c` comet). */
const card = (name: string): number => "23456789TJQKA".indexOf(name[0]!) + 13 * "smrc".indexOf(name[1]!);
const cards = (names: string): number[] => names.split(" ").map(card);

describe("showdown determinism (ADR 0003)", () => {
  it("replay equals play", () => {
    fc.assert(
      fc.property(fc.string(), choicesArb, (seed, picks) => {
        const { moves, state } = play(seed, picks);
        expect(hashShowdownState(replayShowdown(seed, cfg, moves))).toBe(hashShowdownState(state));
      }),
      { numRuns: 40 },
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), choicesArb, fc.nat({ max: 5 }), (seed, picks, pick) => {
        const { state } = play(seed, picks);
        if (state.finished) return;
        const before = JSON.stringify(state);
        reduceShowdown(state, moveFor(state, pick));
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 40 },
    );
  });

  it("different seeds deal different hands", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(showdownViewString(createShowdownGame(`s${i}`, cfg)));
    expect(seen.size).toBe(20);
  });

  it("takes end as its first move, and an untouched sitting scores nothing", () => {
    const s = reduceShowdown(createShowdownGame("x", cfg), { type: "end" });
    expect(s.finished).toBe(true);
    expect(summarizeShowdown(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceShowdown(s, { type: "deal" })).toThrow(InvalidMoveError);
  });

  it("refuses a bad config", () => {
    expect(() => validateShowdownConfig({ ...cfg, rivals: 4, styles: ["brick", "sponge", "shark"] })).toThrow();
    expect(() => validateShowdownConfig({ ...cfg, smallBlind: 3, bigBlind: 2 })).toThrow();
    expect(() => validateShowdownConfig({ ...cfg, raiseCap: 0 })).toThrow();
    expect(() => validateShowdownConfig(cfg)).not.toThrow();
  });
});

describe("showdown hands", () => {
  it("ranks every category in order", () => {
    const order = [
      "As Km 9r 7c 4s 3m 2r",
      "As Am 9r 7c 4s 3m 2r",
      "As Am 9r 9c 4s 3m 2r",
      "As Am Ar 9c 4s 3m 2r",
      "5s 4m 3r 2c As Km 9r",
      "As Ks 9s 7s 2s 3m 4r",
      "As Am Ar 9c 9s 3m 2r",
      "As Am Ar Ac 9s 3m 2r",
      "5s 4s 3s 2s As Km 9r",
    ];
    const names = order.map((h) => showdownHandName(showdownHandValue(cards(h))));
    expect(names).toEqual(["high", "pair", "twoPair", "trips", "straight", "flush", "fullHouse", "quads", "straightFlush"]);
    const values = order.map((h) => showdownHandValue(cards(h)));
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!);
  });

  it("breaks ties by the cards that play, and the wheel is the lowest straight", () => {
    expect(showdownHandValue(cards("As Am Kr 9c 4s 3m 2r"))).toBeGreaterThan(showdownHandValue(cards("As Am Qr 9c 4s 3m 2r")));
    expect(showdownHandValue(cards("6s 5m 4r 3c 2s Km 9r"))).toBeGreaterThan(showdownHandValue(cards("5s 4m 3r 2c As Km 9r")));
    // A sixth and seventh card that do not play do not count.
    expect(showdownHandValue(cards("As Am Kr Qc Js 3m 2r"))).toBe(showdownHandValue(cards("As Am Kr Qc Js 4m 2r")));
    expect(showdownBestFive(cards("As Am Ar 9c 9s 3m 2r")).sort()).toEqual(cards("As Am Ar 9c 9s").sort());
  });

  it("reckons a share of the pot by dealing out the unseen cards", () => {
    const aces = showdownEquity(cards("As Am"), [], 1, 400, seedFromString("e")).share;
    const junk = showdownEquity(cards("7s 2m"), [], 1, 400, seedFromString("e")).share;
    expect(aces).toBeGreaterThan(780);
    expect(junk).toBeLessThan(420);
    // Made on the river against one hand: the nuts win every deal.
    expect(showdownEquity(cards("As Ks"), cards("Qs Js Ts 2m 3r"), 2, 50, seedFromString("e")).share).toBe(1000);
  });
});

describe("showdown betting", () => {
  it("posts the blinds left of the button, and the seat after the big blind acts first", () => {
    for (let i = 0; i < 12; i++) {
      const s = createShowdownGame(`b${i}`, cfg);
      const n = s.seats.length;
      expect(s.seats[(s.button + 1) % n]!.inPot).toBe(cfg.smallBlind);
      expect(s.seats[(s.button + 2) % n]!.inPot).toBe(cfg.bigBlind);
      expect(s.toAct).toBe((s.button + 3) % n);
      expect(s.phase).toBe(s.toAct === 0 ? "act" : "table");
      expect(showdownPot(s)).toBe(cfg.smallBlind + cfg.bigBlind);
      expect(showdownBoardShowing(s)).toEqual([]);
    }
  });

  it("heads up, the button posts the small blind and acts first", () => {
    const s = createShowdownGame("hu", { ...cfg, rivals: 1, styles: ["shark"] });
    expect(s.seats[s.button]!.inPot).toBe(cfg.smallBlind);
    expect(s.toAct).toBe(s.button);
  });

  it("caps a street at raiseCap bets", () => {
    let s = sitting("cap", 5, { ...cfg, hands: 1 });
    expect(s.finished).toBe(true);
    // Raise whenever it can: no street ever holds more than the cap.
    s = createShowdownGame("cap", cfg);
    let guard = 0;
    while (!s.finished && guard++ < 2000) {
      expect(s.bets).toBeLessThanOrEqual(cfg.raiseCap);
      if (s.phase === "act" && s.bets >= cfg.raiseCap) expect(showdownMoveIllegalReason(s, { type: "raise" })).not.toBeNull();
      s = reduceShowdown(s, moveFor(s, 5));
    }
  });

  it("refuses a fold with nothing to call, and every move out of turn", () => {
    let s = createShowdownGame("turns", cfg);
    let guard = 0;
    while (!s.finished && guard++ < 2000) {
      if (s.phase === "act") {
        expect(showdownMoveIllegalReason(s, { type: "next" })).not.toBeNull();
        if (showdownOwed(s) === 0) expect(() => reduceShowdown(s, { type: "fold" })).toThrow(InvalidMoveError);
      } else {
        expect(() => reduceShowdown(s, { type: "call" })).toThrow(InvalidMoveError);
      }
      if (s.phase !== "over") expect(() => reduceShowdown(s, { type: "deal" })).toThrow(InvalidMoveError);
      s = reduceShowdown(s, moveFor(s, guard % 6));
    }
  });

  it("every chip won is a chip lost: the nets sum to nothing after every hand", () => {
    fc.assert(
      fc.property(fc.string(), choicesArb, (seed, picks) => {
        let s = createShowdownGame(seed, cfg);
        for (const p of picks) {
          if (s.finished) break;
          s = reduceShowdown(s, moveFor(s, p));
          if (s.phase === "over") expect(s.seats.reduce((n, x) => n + x.net, 0)).toBe(0);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("once the player folds, one next plays out the rest of the hand", () => {
    for (let i = 0; i < 20; i++) {
      let s = createShowdownGame(`f${i}`, cfg);
      while (s.phase === "table") s = reduceShowdown(s, { type: "next" });
      if (s.phase !== "act" || showdownOwed(s) === 0) continue;
      s = reduceShowdown(s, { type: "fold" });
      if (s.phase === "table") s = reduceShowdown(s, { type: "next" });
      expect(s.phase).toBe("over");
      expect(s.seats[0]!.net + s.seats[0]!.inPot).toBe(0);
    }
  });

  it("a rival sees only its own cards: swapping the others' changes nothing it does", () => {
    for (let i = 0; i < 10; i++) {
      const s = createShowdownGame(`v${i}`, cfg);
      if (s.phase !== "table") continue;
      const seat = s.toAct;
      const other = seat === 1 ? 2 : 1;
      const swapped: ShowdownState = { ...s, seats: s.seats.map((x, k) => (k === 0 ? { ...x, cards: s.seats[other]!.cards } : k === other ? { ...x, cards: s.seats[0]!.cards } : x)) };
      const play = cfg.play[s.seats[seat]!.style!];
      expect(showdownStyleChoice(swapped, seat, play, s.think).kind).toBe(showdownStyleChoice(s, seat, play, s.think).kind);
    }
  });

  it("shows the hands at a showdown, and the hint is a move the player can make", () => {
    let showed = false;
    for (let i = 0; i < 8 && !showed; i++) {
      let s = createShowdownGame(`w${i}`, cfg);
      let guard = 0;
      while (!s.finished && guard++ < 2000) {
        if (s.phase === "act") {
          const h = showdownHint(s);
          expect(h).not.toBeNull();
          expect(showdownMoveIllegalReason(s, { type: h! })).toBeNull();
        }
        s = reduceShowdown(s, moveFor(s, 1));
        const win = s.lastMove?.events.find((e) => e.kind === "win");
        if (win && win.kind === "win" && win.shown.length > 1) {
          showed = true;
          expect(showdownBoardShowing(s)).toHaveLength(5);
          for (const x of win.shown) expect(s.seats[x.seat]!.shown).toBe(true);
          expect(win.amounts.reduce((a, b) => a + b, 0)).toBe(win.pot);
        }
      }
    }
    expect(showed).toBe(true);
  });
});

describe("showdown sittings", () => {
  it("ends after its last hand, and scores the bank and the net", () => {
    const s = sitting("full", 1);
    expect(s.finished).toBe(true);
    expect(s.hand).toBe(cfg.hands);
    expect(s.score).toBe(Math.max(0, cfg.bank + s.seats[0]!.net));
  });

  it("a sitting left early keeps no winnings, only its share of the bank", () => {
    for (let i = 0; i < 10; i++) {
      let s = createShowdownGame(`e${i}`, cfg);
      let guard = 0;
      while (s.hand < 4 && guard++ < 2000) s = reduceShowdown(s, moveFor(s, 3));
      while (s.phase !== "over") s = reduceShowdown(s, moveFor(s, 1));
      const done = s.hand;
      const stands = cfg.bank + s.seats[0]!.net;
      const left = reduceShowdown(s, { type: "end" });
      expect(left.score).toBe(Math.max(0, Math.min(stands, Math.floor((cfg.bank * done) / cfg.hands))));
    }
  });

  it("a hand cut short costs the player what they put in it", () => {
    const s = createShowdownGame("cut", cfg);
    const left = reduceShowdown(s, { type: "end" });
    expect(left.seats[0]!.net + s.seats[0]!.inPot).toBe(0);
  });

  it("the view says what the table shows, and no rival's cards before they are shown", () => {
    const s = createShowdownGame("view", cfg);
    const v = showdownViewString(s);
    const parts = v.split("|");
    expect(parts).toHaveLength(3 + cfg.rivals);
    expect(parts[1]).toMatch(/^([2-9TJQKA][smrc]){2}$/);
    expect(parts.slice(3).every((p) => p === "i")).toBe(true);
  });
});
