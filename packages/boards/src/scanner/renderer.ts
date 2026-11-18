import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  scannerContactsLeft,
  scannerDistance,
  scannerHint,
  scannerLockIllegalReason,
  scannerLockValue,
  scannerPingAt,
  scannerPingCandidates,
  scannerPingIllegalReason,
  scannerPingsLeft,
  scannerRingCells,
  scannerViewString,
  type ScannerHint,
  type ScannerMoveReport,
  type ScannerState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION, RADIUS, type Token } from "../look/tokens.js";
import { FONT, FONT_MONO, INK, drawDot } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";
import { SCANNER_PIECES, type ScannerPieceId } from "./pieces.js";

export type ScannerVerb = "ping" | "lock";

export interface ScannerCallbacks {
  /** The player pinged a cell the engine would take a ping on. */
  onPing(cell: number): void;
  /** The player locked a cell the engine would take a lock on. */
  onLock(cell: number): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface ScannerLabels {
  /** The two halves of the switch. */
  ping: string;
  lock: string;
  /** What a right lock scores now, beside the lock half of the switch. */
  bounty(points: number): string;
  /** The strip over the sector: pings left of par, pings past it, the sector's number, contacts still hidden. */
  pings(left: number, par: number): string;
  over(pings: number): string;
  sector(number: number): string;
  hidden(left: number, total: number): string;
  spooked: string;
  miss: string;
  overPar: string;
  sectorClear: string;
  clean: string;
  saved(pings: number, points: number): string;
  streak(count: number): string;
  streakLost: string;
}

export interface ScannerRendererOptions {
  /** Pulse a safe move after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: ScannerLabels;
}

/** A diamond travelling out from a cell: a ping's reach, which is the rule. It goes out once and fades where it stops. */
interface Pulse {
  cell: number;
  /** Radius in cells. */
  r: number;
  alpha: number;
  color: number;
  /** Ms left of its fade once it has stopped; null while it is still going out. */
  fade: number | null;
}

const HINT_AFTER_MS = 6000;
const LONG_PRESS_MS = 420;
/** Room for the strip over the sector and the switch under it, in cells. */
const STRIP = 0.62;
const SWITCH = 1.22;
/** The ring round the keyboard's cell and round a ping whose ring is lit: 2 units wide, 2 units off the plate. */
const RING_HALF = 0.47;
const RING_W = 0.07;

const isPing = (ch: string): boolean => /^[0-9a-z]$/.test(ch);

/** The mark a view character stands on its cell, if it is one. */
const MARKS: Readonly<Record<string, ScannerPieceId>> = { X: "found", S: "spooked", "!": "miss" };

/** Draws the scanner sector and turns taps into pings and locks. Scores nothing and solves nothing: every number and every cleared cell is the engine's. */
export class ScannerRenderer extends KitBoard<ScannerState> {
  private readonly grid = new Grid(6, 6);
  private readonly bg = new Graphics();
  /** The dot of every cell proven empty. */
  private readonly dotLayer = new Graphics();
  private readonly plateLayer = new Container();
  /** The lit ring and the pings going out, clipped to the sector so a diamond does not spill over the strips. */
  private readonly overlay = new Container();
  private readonly overlayMask = new Graphics();
  private readonly ringLayer = new Graphics();
  private readonly pulseLayer = new Graphics();
  private readonly markLayer = new Container();
  private readonly numberLayer = new Container();
  /** What a lit ring puts on the cells it crosses, and the ring round its own cell. */
  private readonly candidateLayer = new Graphics();
  private readonly hintSprite = new Sprite();
  private readonly pressSprite = new Sprite();
  private readonly cursorLayer = new Graphics();
  private readonly switchLayer = new Graphics();
  private readonly switchGlyphs = [new Sprite(), new Sprite()] as const;
  private readonly plates: Sprite[] = [];
  private readonly marks: Sprite[] = [];
  private readonly numbers: Text[] = [];
  private stripPings: Text | null = null;
  private stripSector: Text | null = null;
  private stripHidden: Text | null = null;
  private switchPing: Text | null = null;
  private switchLock: Text | null = null;
  private switchBounty: Text | null = null;
  /** What is drawn, a view character a cell: `.` fog, `-` proven empty, a base 36 digit for a ping, `X`, `S`, `!`. `view` is read from these, not from the state. */
  private cells: string[] = [];
  private pulses: Pulse[] = [];
  /** What a tap on fog means. */
  private verb: ScannerVerb = "ping";
  /** The pinged cell whose ring is lit, or null. */
  private selected: number | null = null;
  /** The keyboard's cell. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  /** A finger down on a cell: a long press locks. */
  private press: { cell: number; at: number; fired: boolean } | null = null;
  /** True while a cleared sector is still on screen: a tap then would land on a sector the player has not seen. */
  private holding = false;
  /** The state the strip shows: the new sector's only once it is on screen. */
  private stripFor: ScannerState | null = null;
  private idle = 0;
  private hint: ScannerHint | null = null;
  private hintFor: ScannerState | null = null;
  private hintShown = false;
  private hints: boolean;
  /** The dots want drawing again: a cell was proven empty or fogged over. */
  private dirty = true;
  private ringAttr = "";
  /** When the move being played has finished, in ms from its start. */
  private until = 0;

  constructor(
    host: HTMLElement,
    private readonly cb: ScannerCallbacks,
    private readonly opts: ScannerRendererOptions,
  ) {
    super(host, "scanner", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    const text = (family: string, fill: number): Text => {
      const t = new Text({ text: "", style: { fontFamily: family, fontSize: 14, fontWeight: "700", fill }, resolution: 2 });
      t.anchor.set(0.5);
      return t;
    };
    this.stripPings = text(FONT_MONO, INK.cream);
    this.stripPings.anchor.set(0, 0.5);
    this.stripSector = text(FONT_MONO, INK.dim);
    this.stripHidden = text(FONT_MONO, INK.cream);
    this.stripHidden.anchor.set(1, 0.5);
    this.switchPing = text(FONT, INK.cream);
    this.switchLock = text(FONT, INK.cream);
    this.switchBounty = text(FONT_MONO, INK.dim);
    for (const s of [this.hintSprite, this.pressSprite, ...this.switchGlyphs]) s.anchor.set(0.5);
    this.hintSprite.visible = false;
    this.pressSprite.visible = false;
    this.overlay.addChild(this.ringLayer, this.pulseLayer);
    this.overlay.mask = this.overlayMask;
    this.world.addChild(
      this.overlayMask,
      this.bg,
      this.dotLayer,
      this.plateLayer,
      this.overlay,
      this.markLayer,
      this.numberLayer,
      this.candidateLayer,
      this.hintSprite,
      this.pressSprite,
      this.cursorLayer,
      this.switchLayer,
      ...this.switchGlyphs,
      this.stripPings,
      this.stripSector,
      this.stripHidden,
      this.switchPing,
      this.switchLock,
      this.switchBounty,
    );
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.width;
      g.rows = this.state.config.height;
    }
    g.fit(width, height, { top: STRIP, bottom: SWITCH, margin: 8 });
    const n = g.cols * g.rows;
    const pad = Math.max(4, g.cell * 0.12);
    // Bare ground under the strip, the sector and the switch, with the one hairline round it. No frame
    // and no grid: the fog plates are the cells, and a cell proven empty keeps a dot.
    this.bg.clear();
    this.paintGround(this.bg, g.ox - pad, g.oy - g.cell * STRIP - pad, g.width + pad * 2, g.height + g.cell * (STRIP + SWITCH) + pad * 2);
    this.overlayMask.clear().rect(g.ox, g.oy, g.width, g.height).fill({ color: INK.cream });
    const sized = <T extends Sprite | Text>(list: T[], layer: Container, make: () => T): void => {
      while (list.length > n) list.pop()!.destroy();
      while (list.length < n) {
        const item = make();
        item.anchor.set(0.5);
        item.visible = false;
        layer.addChild(item);
        list.push(item);
      }
    };
    sized(this.plates, this.plateLayer, () => new Sprite());
    sized(this.marks, this.markLayer, () => new Sprite());
    sized(this.numbers, this.numberLayer, () => new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 20, fontWeight: "700", fill: INK.cream }, resolution: 2 }));
    for (let i = 0; i < n; i++) {
      this.plates[i]!.position.set(g.x(i), g.y(i));
      this.marks[i]!.position.set(g.x(i), g.y(i));
      this.numbers[i]!.position.set(g.x(i), g.y(i));
      this.numbers[i]!.style.fontSize = Math.max(12, Math.round(g.cell * 0.5));
    }
    const small = Math.max(11, Math.round(g.cell * 0.25));
    const stripY = g.oy - g.cell * STRIP * 0.5;
    for (const t of [this.stripPings, this.stripSector, this.stripHidden]) if (t) t.style.fontSize = small;
    this.stripPings?.position.set(g.ox + 2, stripY);
    this.stripSector?.position.set(g.ox + g.width / 2, stripY);
    this.stripHidden?.position.set(g.ox + g.width - 2, stripY);
    for (const t of [this.switchPing, this.switchLock]) if (t) t.style.fontSize = Math.max(13, Math.round(g.cell * 0.32));
    if (this.switchBounty) this.switchBounty.style.fontSize = small;
    this.cursor = Math.min(this.cursor, n - 1);
    this.press = null;
    this.pulses = [];
    this.holding = false;
    this.publishGeom(g.ox, g.oy, g.cell);
    const [ping, lock] = this.switchRects();
    this.app.canvas.setAttribute("data-switch", [ping.x + ping.w / 2, ping.y + ping.h / 2, lock.x + lock.w / 2, lock.y + lock.h / 2].map(Math.round).join(","));
    // The layout dropped every baked piece, so each sprite takes its texture again here.
    if (this.state) this.snap(scannerViewString(this.state), this.state);
    else {
      this.cells = Array.from({ length: n }, () => ".");
      this.cells.forEach((ch, i) => this.show(i, ch));
    }
    this.hintSprite.visible = false;
    this.pressSprite.visible = false;
    this.hintShown = false;
    this.drawSwitch();
    this.drawCursor();
    this.dirty = true;
  }

  // ---- the picture

  private texture(id: ScannerPieceId, color: Token = SCANNER_PIECES[id].color, size = this.grid.cell): Texture {
    return this.piece(id, size, color, SCANNER_PIECES[id].paint);
  }

  /** Draw one cell exactly as `ch` says, with nothing in motion. */
  private show(cell: number, ch: string): void {
    const plate = this.plates[cell];
    const mark = this.marks[cell];
    const number = this.numbers[cell];
    if (!plate || !mark || !number) return;
    plate.texture = this.texture("fog");
    plate.visible = ch === ".";
    plate.scale.set(1);
    const id = MARKS[ch];
    mark.visible = id !== undefined;
    if (id) mark.texture = this.texture(id);
    mark.scale.set(1);
    number.visible = isPing(ch);
    if (number.visible) number.text = String(parseInt(ch, 36));
    number.scale.set(1);
  }

  /** Show exactly this view, with nothing in motion, and the strip for `state`. A ping's ring still fading from the move just played may be kept. */
  private snap(view: string, state: ScannerState, keepRings = false): void {
    this.cells = [...view];
    this.cells.forEach((ch, i) => this.show(i, ch));
    this.pulses = keepRings ? this.pulses.filter((p) => p.fade !== null) : [];
    this.holding = false;
    this.stripFor = state;
    this.drawStrip();
    this.drawSwitch();
    this.dirty = true;
    this.touchView();
  }

  protected view(): string {
    return this.cells.join("");
  }

  /** A dot in every cell proven empty: where a ping is safe. A plate still shrinking covers its own. */
  private drawDots(): void {
    const g = this.grid;
    this.dotLayer.clear();
    this.cells.forEach((ch, i) => {
      if (ch === "-") drawDot(this.dotLayer, g.x(i), g.y(i), g.cell);
    });
  }

  private drawStrip(): void {
    const s = this.stripFor;
    if (!s || !this.stripPings || !this.stripSector || !this.stripHidden) return;
    const left = scannerPingsLeft(s);
    this.stripPings.text = left >= 0 ? this.opts.labels.pings(left, s.par) : this.opts.labels.over(-left);
    // Past par is bad, and said so; the last ping of par is only a number.
    this.stripPings.style.fill = left >= 0 ? INK.cream : INK.danger;
    this.stripSector.text = this.opts.labels.sector(s.sector + 1);
    this.stripHidden.text = this.opts.labels.hidden(scannerContactsLeft(s), s.contacts.length);
    // The same numbers for the smoke test: the sector, pings left of par, contacts hidden of all, and what a lock pays.
    this.app.canvas.setAttribute("data-strip", [s.sector + 1, left, s.par, scannerContactsLeft(s), s.contacts.length, scannerLockValue(s)].join(","));
  }

  private switchRects(): [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }] {
    const g = this.grid;
    const gap = Math.max(6, g.cell * 0.14);
    const w = (g.width - gap) / 2;
    const h = g.cell * 0.9;
    const y = g.oy + g.height + g.cell * 0.2;
    return [
      { x: g.ox, y, w, h },
      { x: g.ox + w + gap, y, w, h },
    ];
  }

  /**
   * The switch under the sector: two big halves, each with its own glyph. The live one is the
   * player's choice, so it is amber with ground text and carries a notch that points at the sector;
   * the other is a raised button.
   */
  private drawSwitch(): void {
    const g = this.grid;
    const l = this.switchLayer;
    l.clear();
    const rects = this.switchRects();
    const texts = [this.switchPing, this.switchLock];
    const labels = [this.opts.labels.ping, this.opts.labels.lock];
    (["ping", "lock"] as const).forEach((verb, i) => {
      const r = rects[i]!;
      const on = this.verb === verb;
      l.roundRect(r.x, r.y, r.w, r.h, Math.min(RADIUS, r.h / 2)).fill({ color: on ? INK.amber : INK.raised });
      if (on) {
        const n = r.h * 0.2;
        l.poly([r.x + r.w / 2 - n, r.y + 1, r.x + r.w / 2, r.y - n, r.x + r.w / 2 + n, r.y + 1]).fill({ color: INK.amber });
      }
      const tone: Token = on ? "ground" : "cream";
      const gy = r.y + r.h / 2;
      const glyph = this.switchGlyphs[i]!;
      glyph.texture = this.texture(verb === "ping" ? "ping" : "found", tone, Math.round(r.h * 0.62));
      glyph.position.set(r.x + r.h * 0.55, gy);
      const t = texts[i];
      if (t) {
        t.text = labels[i]!;
        t.style.fill = on ? INK.ground : INK.cream;
        t.position.set(r.x + r.w * 0.56, gy);
      }
    });
    if (this.switchBounty && this.switchLock) {
      const r = rects[1];
      const s = this.stripFor;
      this.switchBounty.text = s ? this.opts.labels.bounty(scannerLockValue(s)) : "";
      this.switchBounty.style.fill = this.verb === "lock" ? INK.ground : INK.dim;
      // Under the word when the half is too narrow to hold both side by side.
      const beside = r.w > g.cell * 2.6;
      this.switchLock.position.set(r.x + r.w * (beside ? 0.48 : 0.6), r.y + r.h * (beside ? 0.5 : 0.36));
      this.switchBounty.position.set(r.x + r.w * (beside ? 0.8 : 0.6), r.y + r.h * (beside ? 0.52 : 0.72));
    }
    this.app.canvas.setAttribute("data-mode", this.verb);
  }

  private setVerb(verb: ScannerVerb): void {
    if (this.verb === verb) return;
    this.verb = verb;
    sfx.swapQuiet();
    this.idle = 0;
    this.drawSwitch();
    this.drawCursor();
  }

  // ---- states and moves

  protected onState(state: ScannerState, prev: ScannerState | null): void {
    this.idle = 0;
    this.press = null;
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height) {
      // A different sector size (a lab config): lay it out afresh.
      g.cols = state.config.width;
      g.rows = state.config.height;
      this.selected = null;
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const report = state.lastMove;
    const follows = report !== null && prev !== null && state.moveCount === prev.moveCount + 1 && this.view() === scannerViewString(prev);
    if (this.selected !== null && (!follows || report.cleared !== null || scannerPingAt(state, this.selected) === null)) this.selected = null;
    if (!follows) {
      this.snap(scannerViewString(state), state);
      return;
    }
    this.play(state, prev, report);
  }

  /**
   * A ping's reach: one plain diamond going out from `cell` to `d` cells, from `at`. It takes the
   * time its distance asks, since the distance is the rule, and fades where it stops. Returns the ms
   * it takes to get there.
   */
  private sound(cell: number, d: number, color: number, at: number): number {
    const ms = MOTION.move + d * 60;
    const pulse: Pulse = { cell, r: 0, alpha: 1, color, fade: null };
    this.tweens.after(at, () => this.pulses.push(pulse));
    this.tweens.run(
      ms,
      (k) => {
        pulse.r = d * k;
      },
      {
        delay: at,
        ease: ease.outQuad,
        done: () => {
          pulse.fade = MOTION.clear;
        },
      },
    );
    this.until = Math.max(this.until, at + ms);
    return ms;
  }

  /** The fog plate on `cell` shrinks to nothing from `at`. */
  private lift(cell: number, at: number): void {
    const plate = this.plates[cell];
    if (!plate) return;
    this.tweens.remove(plate, {
      delay: at,
      done: () => {
        plate.visible = false;
      },
    });
    this.until = Math.max(this.until, at + MOTION.clear);
  }

  /** Put a number or a mark on a cell at `at`: its fog lifts and it grows onto the cell from `from` of its size. */
  private land(cell: number, ch: string, at: number, from = 0): void {
    const mark = this.marks[cell];
    const number = this.numbers[cell];
    if (!mark || !number) return;
    this.tweens.after(at, () => {
      this.cells[cell] = ch;
      const id = MARKS[ch];
      mark.visible = id !== undefined;
      if (id) mark.texture = this.texture(id);
      mark.scale.set(from);
      number.visible = isPing(ch);
      if (number.visible) number.text = String(parseInt(ch, 36));
      number.scale.set(from);
      this.dirty = true;
      this.touchView();
    });
    // Whatever plate is there goes: the cell is fog now, or will be by then.
    this.lift(cell, at);
    this.tweens.move(MARKS[ch] ? mark : number, { scale: 1 }, { delay: at });
    this.until = Math.max(this.until, at + MOTION.move);
  }

  /** Lift the fog from the cells that are fog now (or all of them, when the sector will be `blank` by then) and proven empty in `view`, each as the ring from `origin` reaches it. */
  private shade(view: string, origin: number, at: number, perStep: number, blank = false): void {
    const state = this.state;
    if (!state) return;
    this.cells.forEach((ch, cell) => {
      if ((!blank && ch !== ".") || view[cell] !== "-") return;
      const delay = at + scannerDistance(state.config, origin, cell) * perStep;
      this.tweens.after(delay, () => {
        this.cells[cell] = "-";
        this.dirty = true;
        this.touchView();
      });
      this.lift(cell, delay);
    });
  }

  /** Play a move out: the ping going out or the lock landing, the numbers that sound again, then a cleared sector giving way to the next. */
  private play(state: ScannerState, prev: ScannerState, r: ScannerMoveReport): void {
    const g = this.grid;
    const labels = this.opts.labels;
    const x = g.x(r.cell);
    const y = g.y(r.cell);
    const big = Math.max(16, g.cell * 0.46);
    const lostStreak = prev.combo >= 2 && state.combo === 0 && (r.wrong || r.spooked);
    // The old sector as it stands once this move is on it. A move that clears it leaves the numbers as they were.
    const after = r.cleared === null ? scannerViewString(state) : this.view();
    this.until = 0;
    let t = 0;
    if (r.cleared === null) {
      this.stripFor = state;
      this.drawStrip();
      this.drawSwitch();
    }

    if (r.distance !== null && !r.spooked) {
      // A ping: the number lands at once, the diamond goes out to its distance, and the fog it proves empty lifts as the ring passes.
      // The ping is the player's own, so its ring is amber.
      const d = r.distance;
      sfx.ping(d);
      const ms = this.sound(r.cell, d, INK.amber, 0);
      this.land(r.cell, d.toString(36), 0);
      this.shade(after, r.cell, 0, ms / Math.max(1, d));
      if (r.cost < 0) {
        this.tweens.after(MOTION.move, () => {
          sfx.bump();
          this.fx.popup(x, y - g.cell * 0.45, String(r.cost), INK.danger, big * 0.9);
          if (scannerPingsLeft(state) === -1) this.fx.say(labels.overPar, INK.danger);
        });
      }
      t = ms + MOTION.move;
    } else if (r.spooked) {
      // A ping on a contact: it bolts. Bad news is said in danger, and nothing shakes.
      sfx.ping(0);
      this.land(r.cell, "S", 0);
      this.tweens.after(MOTION.move, () => {
        sfx.bad();
        sfx.whoosh();
        this.fx.say(lostStreak ? labels.streakLost : labels.spooked, INK.danger);
        this.fx.popup(x, y - g.cell * 0.45, String(r.cost), INK.danger, big);
        if (lostStreak) sfx.streakLost();
      });
      t = 380;
    } else if (r.found) {
      // A lock on a contact: the brackets hold it and the bounty rises, in cream.
      this.land(r.cell, "X", 0);
      this.tweens.after(60, () => {
        sfx.good();
        this.fx.popup(x, y - g.cell * 0.45, `+${r.findPoints}`, INK.cream, big * (r.streakPercent > 100 ? 1.2 : 1));
      });
      t = 300;
    } else if (r.wrong) {
      this.land(r.cell, "!", 0);
      this.tweens.after(0, () => {
        sfx.bad();
        this.fx.say(lostStreak ? labels.streakLost : labels.miss, INK.danger);
        this.fx.popup(x, y - g.cell * 0.45, String(r.cost), INK.danger, big);
        if (lostStreak) sfx.streakLost();
      });
      t = 300;
    }

    // Every ping that was hearing the contact sounds again and shows its new number.
    r.resound.forEach((e, i) => {
      const at = t + i * 70;
      this.tweens.after(at, () => sfx.pop(Math.min(9, 2 + i)));
      this.land(e.cell, e.to.toString(36), at, 0.5);
    });
    if (r.resound.length > 0) {
      this.shade(after, r.cell, t + 60, 30);
      t += r.resound.length * 70 + MOTION.move;
    }

    const c = r.cleared;
    if (c === null) {
      this.tweens.after(Math.max(t, this.until + 20), () => this.snap(after, state, true));
      return;
    }

    // The sector is cleared: say so, pay the pings saved, then let the fog close and the next sector open on its ping.
    this.holding = true;
    const cx = g.ox + g.width / 2;
    const cy = g.oy + g.height / 2;
    const top = state.config.streakPercent.length;
    this.tweens.after(t, () => {
      if (c.clean) {
        // The beat is the clean sector, the move the puzzle pays most for, and a longer streak is a stronger one.
        this.beat(Math.min(1, 0.4 + (0.6 * (c.streak - 1)) / Math.max(1, top - 1)));
        this.fx.say(c.streak >= 2 ? labels.streak(c.streak) : labels.clean, INK.cream);
        if (c.bonus > 0) this.fx.popup(cx, cy + g.cell * 0.4, labels.saved(c.saved, c.bonus), INK.cream, big * 1.15);
      } else {
        sfx.good();
        this.fx.say(labels.sectorClear, INK.dim);
      }
    });
    t = Math.max(t, this.until) + 620;
    // The fog closes over everything: the marks and the numbers shrink away and a plate grows back on every open cell.
    this.tweens.after(t, () => {
      this.cells.forEach((ch, cell) => {
        const plate = this.plates[cell];
        if (ch === "." || !plate) return;
        plate.visible = true;
        plate.scale.set(0);
      });
    });
    this.cells.forEach((_, cell) => {
      const plate = this.plates[cell]!;
      const mark = this.marks[cell]!;
      const number = this.numbers[cell]!;
      this.tweens.remove(mark, { delay: t });
      this.tweens.remove(number, { delay: t });
      this.tweens.move(plate, { scale: 1 }, { delay: t });
    });
    t += MOTION.clear + 40;
    const next = scannerViewString(state);
    const open = state.pings[0];
    this.tweens.after(t, () => {
      // The new sector is on screen from here, all fog: its strip, and taps again.
      this.cells = this.cells.map(() => ".");
      this.cells.forEach((ch, cell) => this.show(cell, ch));
      this.dirty = true;
      this.holding = false;
      this.stripFor = state;
      this.drawStrip();
      this.drawSwitch();
      this.touchView();
    });
    this.until = t;
    if (open) {
      // The opening ping is dealt, not the player's: its ring is cream.
      this.tweens.after(t, () => sfx.ping(open.distance));
      const ms = this.sound(open.cell, open.distance, INK.cream, t);
      this.land(open.cell, open.distance.toString(36), t);
      this.shade(next, open.cell, t, ms / Math.max(1, open.distance), true);
    }
    // Whatever the tweens did, the sector ends as the engine holds it.
    this.tweens.after(this.until + 20, () => this.snap(next, state, true));
  }

  // ---- every frame

  protected override update(dt: number): void {
    if (this.dirty) {
      this.dirty = false;
      this.drawDots();
    }
    // A long press locks, whatever the switch says.
    if (this.press && !this.press.fired && performance.now() - this.press.at >= LONG_PRESS_MS) {
      // The wall clock, not the frame count: a slow frame must not make a press longer.
      this.press.fired = true;
      this.act(this.press.cell, "lock");
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i]!;
      if (pulse.fade === null) continue;
      pulse.fade -= dt;
      pulse.alpha = Math.max(0, pulse.fade / MOTION.clear);
      if (pulse.fade <= 0) this.pulses.splice(i, 1);
    }
    this.drawOverlay();
    this.updateHint(dt);
  }

  private diamond(l: Graphics, cell: number, r: number, color: number, alpha = 1): void {
    const x = this.grid.x(cell);
    const y = this.grid.y(cell);
    l.poly([x, y - r, x + r, y, x, y + r, x - r, y]).stroke({ width: 2, color, alpha, join: "round" });
  }

  /** An amber ring round a cell: the player's own cell, by key or by picking a ping. */
  private ring(l: Graphics, cell: number): void {
    const g = this.grid;
    const half = g.cell * RING_HALF;
    l.roundRect(g.x(cell) - half, g.y(cell) - half, half * 2, half * 2, g.cell * 0.2).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
  }

  /** The pings going out, the lit ring, and the brackets closing under a held finger. */
  private drawOverlay(): void {
    const g = this.grid;
    const p = this.pulseLayer;
    p.clear();
    for (const pulse of this.pulses) {
      if (pulse.alpha <= 0.01 || pulse.r * g.cell < 2) continue;
      this.diamond(p, pulse.cell, pulse.r * g.cell, pulse.color, pulse.alpha);
    }
    const l = this.ringLayer;
    const marksLayer = this.candidateLayer;
    l.clear();
    marksLayer.clear();
    const state = this.state;
    const ping = state && this.selected !== null && !this.holding ? scannerPingAt(state, this.selected) : null;
    const ringAttr = ping && state ? `${ping.cell}:${scannerPingCandidates(state, ping).join(",")}` : "";
    if (ringAttr !== this.ringAttr) {
      this.ringAttr = ringAttr;
      this.app.canvas.setAttribute("data-ring", ringAttr);
    }
    if (ping && state) {
      // The picked ping is the player's own: an amber ring round it and its diamond in amber. On the
      // diamond, a cream pip stands on each fog plate where the contact it hears can be, and the
      // dot of each cell proven empty is lit.
      this.diamond(l, ping.cell, ping.distance * g.cell, INK.amber);
      this.ring(marksLayer, ping.cell);
      const could = new Set(scannerPingCandidates(state, ping));
      const d = g.cell * 0.13;
      for (const cell of scannerRingCells(state.config, ping.cell, ping.distance)) {
        const cx = g.x(cell);
        const cy = g.y(cell);
        if (could.has(cell)) {
          const pts = [cx, cy - d, cx + d, cy, cx, cy + d, cx - d, cy];
          marksLayer.poly(pts).fill({ color: INK.cream });
          marksLayer.poly(pts).stroke({ width: d * 0.6, color: INK.cream, join: "round" });
        } else if (this.cells[cell] === "-") drawDot(marksLayer, cx, cy, g.cell, INK.dim);
      }
    }
    // The lock being set is the player's own: amber brackets that close on the cell while it is held.
    const held = this.press && !this.press.fired ? performance.now() - this.press.at : 0;
    const s = this.pressSprite;
    if (this.press && held > 110) {
      const k = Math.min(1, (held - 110) / (LONG_PRESS_MS - 110));
      s.texture = this.texture("brackets", "amber");
      s.position.set(g.x(this.press.cell), g.y(this.press.cell));
      s.scale.set(this.reduced ? 1 : 1.5 - 0.5 * k);
      s.alpha = 0.5 + 0.5 * k;
      s.visible = true;
    } else s.visible = false;
  }

  /** A safe move pulses after a pause, in rounds that allow hints: brackets where a lock is proven, a diamond where a ping is safe. */
  private updateHint(dt: number): void {
    const state = this.state;
    const can = this.interactive && this.hints && state !== null && !state.finished && !this.busy && !this.press && !this.holding;
    this.idle = can ? this.idle + dt : 0;
    const s = this.hintSprite;
    if (!can || state === null || this.idle < HINT_AFTER_MS) {
      if (this.hintShown) {
        this.hintShown = false;
        s.visible = false;
        this.app.canvas.removeAttribute("data-hint");
      }
      return;
    }
    if (this.hintFor !== state) {
      this.hintFor = state;
      this.hint = scannerHint(state);
    }
    if (!this.hint) {
      s.visible = false;
      return;
    }
    if (!this.hintShown) {
      this.hintShown = true;
      this.app.canvas.setAttribute("data-hint", `${this.hint.type}:${this.hint.cell}`);
    }
    // A hint is cream, never amber: it is the board's advice, not the player's own mark.
    s.texture = this.texture(this.hint.type === "lock" ? "brackets" : "ping");
    s.position.set(this.grid.x(this.hint.cell), this.grid.y(this.hint.cell));
    s.alpha = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    s.visible = true;
  }

  // ---- input

  /** Ping or lock `cell`, if the engine would take it; a cell that already holds a ping lights its ring. */
  private act(cell: number, verb: ScannerVerb): void {
    const state = this.state;
    if (!state || state.finished || !this.interactive) return;
    // A cleared sector is still on screen: a tap now is aimed at cells that are about to change.
    if (this.holding) return;
    this.idle = 0;
    if (scannerPingAt(state, cell) !== null) {
      this.selected = this.selected === cell ? null : cell;
      sfx.pop(this.selected === null ? 0 : 3);
      return;
    }
    const reason = verb === "ping" ? scannerPingIllegalReason(state, cell) : scannerLockIllegalReason(state, cell);
    if (reason !== null) {
      sfx.bump();
      return;
    }
    if (this.busy) this.tweens.flush();
    if (verb === "ping") this.cb.onPing(cell);
    else this.cb.onLock(cell);
  }

  protected override pointerDown(x: number, y: number): void {
    const [ping, lock] = this.switchRects();
    const inside = (r: { x: number; y: number; w: number; h: number }): boolean => x >= r.x - 4 && x <= r.x + r.w + 4 && y >= r.y - 6 && y <= r.y + r.h + 8;
    if (inside(ping)) return this.setVerb("ping");
    if (inside(lock)) return this.setVerb("lock");
    const at = this.grid.at(x, y);
    if (!at) return;
    this.cursorShown = false;
    this.cursor = at.index;
    this.drawCursor();
    this.press = { cell: at.index, at: performance.now(), fired: false };
  }

  protected override pointerMove(x: number, y: number): void {
    // A finger that slides off its cell means neither a tap nor a press.
    if (this.press && this.grid.at(x, y)?.index !== this.press.cell) this.press = null;
  }

  protected override pointerUp(x: number, y: number): void {
    const press = this.press;
    this.press = null;
    if (!press || press.fired || this.grid.at(x, y)?.index !== press.cell) return;
    this.act(press.cell, this.verb);
  }

  protected override pointerCancel(): void {
    this.press = null;
  }

  protected override onInteractive(): void {
    this.press = null;
  }

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    if (this.cursorShown) this.ring(this.cursorLayer, this.cursor);
  }

  /** Arrows or WASD move the cursor. Space pings, enter or L locks, X flips the switch, escape puts a lit ring out. */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const g = this.grid;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const steps: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
    const step = steps[k];
    if (step) {
      const col = (this.cursor % g.cols) + step[0];
      const row = Math.floor(this.cursor / g.cols) + step[1];
      this.cursorShown = true;
      if (col >= 0 && col < g.cols && row >= 0 && row < g.rows) this.cursor = row * g.cols + col;
      this.idle = 0;
      this.drawCursor();
      return true;
    }
    if (k === " " || k === "Enter" || k === "l") {
      this.cursorShown = true;
      this.drawCursor();
      this.act(this.cursor, k === " " ? "ping" : "lock");
      return true;
    }
    if (k === "x") {
      this.setVerb(this.verb === "ping" ? "lock" : "ping");
      return true;
    }
    if (k === "Escape" && this.selected !== null) {
      this.selected = null;
      return true;
    }
    return false;
  }
}
