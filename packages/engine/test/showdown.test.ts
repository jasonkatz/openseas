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

/** Play a whole round by `pick`, the same choice each time. */
function sitting(seed: string, pick: number, config: ShowdownConfig = cfg): ShowdownState {
  let state = createShowdownGame(seed, config);
  let guard = 0;
  while (!state.finished && guard++ < 5000) state = reduceShowdown(state, moveFor(state, pick));
  return state;
}

/** Cards by name: rank then suit (`s` spades, `h` hearts, `d` diamonds, `c` clubs). */
const card = (name: string): number => "23456789TJQKA".indexOf(name[0]!) + 13 * "shdc".indexOf(name[1]!);
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

  it("takes end as its first move, and an untouched round scores nothing", () => {
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
      "As Kh 9d 7c 4s 3h 2d",
      "As Ah 9d 7c 4s 3h 2d",
      "As Ah 9d 9c 4s 3h 2d",
      "As Ah Ad 9c 4s 3h 2d",
      "5s 4h 3d 2c As Kh 9d",
      "As Ks 9s 7s 2s 3h 4d",
      "As Ah Ad 9c 9s 3h 2d",
      "As Ah Ad Ac 9s 3h 2d",
      "5s 4s 3s 2s As Kh 9d",
    ];
    const names = order.map((h) => showdownHandName(showdownHandValue(cards(h))));
    expect(names).toEqual(["high", "pair", "twoPair", "trips", "straight", "flush", "fullHouse", "quads", "straightFlush"]);
    const values = order.map((h) => showdownHandValue(cards(h)));
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!);
  });

  it("breaks ties by the cards that play, and the wheel is the lowest straight", () => {
    expect(showdownHandValue(cards("As Ah Kd 9c 4s 3h 2d"))).toBeGreaterThan(showdownHandValue(cards("As Ah Qd 9c 4s 3h 2d")));
    expect(showdownHandValue(cards("6s 5h 4d 3c 2s Kh 9d"))).toBeGreaterThan(showdownHandValue(cards("5s 4h 3d 2c As Kh 9d")));
    // A sixth and seventh card that do not play do not count.
    expect(showdownHandValue(cards("As Ah Kd Qc Js 3h 2d"))).toBe(showdownHandValue(cards("As Ah Kd Qc Js 4h 2d")));
    expect(showdownBestFive(cards("As Ah Ad 9c 9s 3h 2d")).sort()).toEqual(cards("As Ah Ad 9c 9s").sort());
  });

  it("reckons a share of the pot by dealing out the unseen cards", () => {
    const aces = showdownEquity(cards("As Ah"), [], 1, 400, seedFromString("e")).share;
    const junk = showdownEquity(cards("7s 2h"), [], 1, 400, seedFromString("e")).share;
    expect(aces).toBeGreaterThan(780);
    expect(junk).toBeLessThan(420);
    // Made on the river against one hand: the nuts win every deal.
    expect(showdownEquity(cards("As Ks"), cards("Qs Js Ts 2h 3d"), 2, 50, seedFromString("e")).share).toBe(1000);
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

  it("every chip won is a chip lost: the chips at the table never change", () => {
    fc.assert(
      fc.property(fc.string(), choicesArb, (seed, picks) => {
        let s = createShowdownGame(seed, cfg);
        const total = cfg.stack * (cfg.rivals + 1);
        for (const p of picks) {
          if (s.finished) break;
          s = reduceShowdown(s, moveFor(s, p));
          expect(s.seats.reduce((n, x) => n + x.stack + x.inPot, 0)).toBe(total);
          for (const x of s.seats) expect(x.stack).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("a seat all in wins from each seat no more than it put in itself", () => {
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      let s = createShowdownGame(`side${i}`, cfg);
      let guard = 0;
      while (!s.finished && guard++ < 3000) {
        const stakes = s.seats.map((x) => x.inPot);
        const next = reduceShowdown(s, moveFor(s, 5));
        for (const e of next.lastMove!.events) if (e.kind === "act") stakes[e.seat] = stakes[e.seat]! + e.paid;
        const win = next.lastMove!.events.find((e) => e.kind === "win");
        if (win && win.kind === "win") {
          expect(win.amounts.reduce((a, b) => a + b, 0)).toBe(win.pot);
          win.winners.forEach((w, k) => {
            const cap = stakes.reduce((n, c) => n + Math.min(c, stakes[w]!), 0);
            expect(win.amounts[k]!).toBeLessThanOrEqual(cap);
          });
          if (new Set(stakes.filter((c) => c > 0)).size > 1 && win.shown.length > 2) checked++;
        }
        s = next;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("once the player folds, the hand plays out one step a next, and costs what they put in", () => {
    for (let i = 0; i < 20; i++) {
      let s = createShowdownGame(`f${i}`, cfg);
      while (s.phase === "table") s = reduceShowdown(s, { type: "next" });
      if (s.phase !== "act" || showdownOwed(s) === 0) continue;
      const before = s.seats[0]!.stack;
      s = reduceShowdown(s, { type: "fold" });
      let guard = 0;
      while (s.phase === "table" && guard++ < 100) {
        s = reduceShowdown(s, { type: "next" });
        // One rival acts, or one street turns: never a whole hand in one move.
        const ev = s.lastMove!.events;
        expect(ev.filter((e) => e.kind === "act").length + (ev[0]?.kind === "street" ? ev.filter((e) => e.kind === "street").length : 0)).toBeLessThanOrEqual(1);
      }
      expect(s.phase).toBe("over");
      expect(s.seats[0]!.stack).toBe(before);
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

describe("showdown knockouts", () => {
  it("ends when the player is out or every rival is, and scores the rivals out", () => {
    let lost = 0;
    let won = 0;
    for (let i = 0; i < 30; i++) {
      const s = sitting(`k${i}`, i % 2 ? 1 : 5);
      expect(s.finished).toBe(true);
      const out = s.seats.slice(1).filter((x) => x.out).length;
      if (s.seats[0]!.out) {
        lost++;
        expect(s.won).toBe(false);
        expect(s.score).toBe(out * cfg.knockout);
      } else if (out === cfg.rivals) {
        won++;
        expect(s.won).toBe(true);
        expect(s.seats[0]!.stack).toBe(cfg.stack * (cfg.rivals + 1));
        expect(s.score).toBe(cfg.rivals * cfg.knockout + Math.max(0, cfg.hands - s.hand) * cfg.speed);
      } else expect(s.hand).toBe(cfg.hands);
    }
    expect(lost).toBeGreaterThan(0);
    expect(won).toBeGreaterThan(0);
  });

  it("deals no cards to a seat that is out, and never asks it to act", () => {
    for (let i = 0; i < 20; i++) {
      let s = createShowdownGame(`o${i}`, cfg);
      let guard = 0;
      while (!s.finished && guard++ < 3000) {
        s.seats.forEach((x, k) => {
          if (x.out) {
            expect(x.stack).toBe(0);
            expect(s.toAct).not.toBe(k);
            if (s.phase !== "over") expect(x.cards).toEqual([]);
          }
        });
        s = reduceShowdown(s, moveFor(s, 3));
      }
    }
  });

  it("after the last hand, a rival with fewer chips counts as beaten", () => {
    for (let i = 0; i < 10; i++) {
      const s = sitting(`cap${i}`, 1, { ...cfg, hands: 3 });
      expect(s.finished).toBe(true);
      if (s.seats[0]!.out || s.won) continue;
      const beaten = s.seats.slice(1).filter((x) => x.out || x.stack < s.seats[0]!.stack).length;
      expect(s.score).toBe(beaten * cfg.knockout);
    }
  });

  it("left early, a round keeps only the rivals already out", () => {
    for (let i = 0; i < 10; i++) {
      let s = createShowdownGame(`e${i}`, cfg);
      let guard = 0;
      while (!s.finished && s.hand < 4 && guard++ < 2000) s = reduceShowdown(s, moveFor(s, 3));
      if (s.finished) continue;
      const left = reduceShowdown(s, { type: "end" });
      expect(left.score).toBe(s.seats.slice(1).filter((x) => x.out).length * cfg.knockout);
      expect(left.won).toBe(false);
    }
  });

  it("the view says what the table shows, and no rival's cards before they are shown", () => {
    const s = createShowdownGame("view", cfg);
    const parts = showdownViewString(s).split("|");
    expect(parts).toHaveLength(3 + cfg.rivals);
    expect(parts[1]).toMatch(/^([2-9TJQKA][shdc]){2}\/\d+$/);
    expect(parts.slice(3).every((p) => /^i\d+$/.test(p))).toBe(true);
  });
});
