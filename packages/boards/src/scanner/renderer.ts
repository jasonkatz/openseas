import { Container, Graphics, Text } from "pixi.js";
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
import { FONT, INK, drawPanel, drawPips, mix } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";

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
  showMarks: boolean;
  /** Pulse a safe move after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: ScannerLabels;
}

/** One cell as it is drawn. `view` is read from these, not from the state. */
interface CellLook {
  /** The view string's character for the cell: `.` fog, `-` proven empty, a base 36 digit for a ping, `X`, `S`, `!`. */
  ch: string;
  /** 0 fog to 1 shaded, so shading can fade in. */
  shade: number;
  /** Scale of the cell's mark, so a number or a contact can land. */
  pop: number;
}

/** A diamond travelling out from a cell: a ping going out, or a ring flashing where it stopped. */
interface Pulse {
  cell: number;
  /** Radius in cells. */
  r: number;
  alpha: number;
  color: number;
  width: number;
  /** Ms left of its fade once it has stopped; null while it is still going out. */
  fade: number | null;
}

const HINT_AFTER_MS = 6000;
const LONG_PRESS_MS = 420;
const RING_FADE_MS = 520;
const PING = 0x7fd7ff;
const LOCK = 0xf5d58a;
const FOG = 0x2b4369;
const FOG_LIT = 0x3a5687;
const CLEAR = 0x0b1627;
/** Room for the strip over the sector and the switch under it, in cells. */
const STRIP = 0.62;
const SWITCH = 1.22;

const isPing = (ch: string): boolean => /^[0-9a-z]$/.test(ch);

/** Draws the scanner sector and turns taps into pings and locks. Scores nothing and solves nothing: every number and every shaded cell is the engine's. */
export class ScannerRenderer extends KitBoard<ScannerState> {
  private readonly grid = new Grid(6, 6);
  private readonly bg = new Graphics();
  private readonly cellLayer = new Graphics();
  private readonly numberLayer = new Container();
  /** Rings and pulses, clipped to the sector so a diamond does not spill over the strips. */
  private readonly overlay = new Container();
  private readonly overlayMask = new Graphics();
  private readonly ringLayer = new Graphics();
  private readonly pulseLayer = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private readonly switchLayer = new Graphics();
  private readonly numbers: Text[] = [];
  private stripPings: Text | null = null;
  private stripSector: Text | null = null;
  private stripHidden: Text | null = null;
  private switchPing: Text | null = null;
  private switchLock: Text | null = null;
  private switchBounty: Text | null = null;
  private cells: CellLook[] = [];
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
  private dirty = true;
  private ringAttr = "";

  constructor(
    host: HTMLElement,
    private readonly cb: ScannerCallbacks,
    private readonly opts: ScannerRendererOptions,
  ) {
    super(host, "scanner", cb.onFrame, opts.showMarks);
    this.hints = opts.hints;
  }

  override setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    const text = (weight: "700" | "900", fill: number): Text => {
      const t = new Text({ text: "", style: { fontFamily: FONT, fontSize: 14, fontWeight: weight, fill, letterSpacing: 0.4 } });
      t.anchor.set(0.5);
      return t;
    };
    this.stripPings = text("700", INK.text);
    this.stripPings.anchor.set(0, 0.5);
    this.stripSector = text("700", INK.dim);
    this.stripHidden = text("700", INK.text);
    this.stripHidden.anchor.set(1, 0.5);
    this.switchPing = text("900", INK.text);
    this.switchLock = text("900", INK.text);
    this.switchBounty = text("700", INK.text);
    this.overlay.addChild(this.ringLayer, this.pulseLayer);
    this.overlay.mask = this.overlayMask;
    this.world.addChild(this.overlayMask, this.bg, this.cellLayer, this.numberLayer, this.overlay, this.hintLayer, this.cursorLayer, this.switchLayer, this.stripPings, this.stripSector, this.stripHidden, this.switchPing, this.switchLock, this.switchBounty);
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
    this.bg.clear();
    drawPanel(this.bg, g.ox - pad, g.oy - g.cell * STRIP - pad, g.width + pad * 2, g.height + g.cell * (STRIP + SWITCH) + pad * 2, Math.max(10, g.cell * 0.28));
    this.overlayMask.clear().rect(g.ox, g.oy, g.width, g.height).fill({ color: 0xffffff });
    while (this.numbers.length > n) this.numbers.pop()!.destroy();
    while (this.numbers.length < n) {
      const t = new Text({ text: "", style: { fontFamily: FONT, fontSize: 20, fontWeight: "900", fill: INK.white } });
      t.anchor.set(0.5);
      t.visible = false;
      this.numberLayer.addChild(t);
      this.numbers.push(t);
    }
    this.numbers.forEach((t, i) => {
      t.style.fontSize = Math.max(12, Math.round(g.cell * 0.46));
      t.position.set(g.x(i), g.y(i));
    });
    const small = Math.max(11, Math.round(g.cell * 0.26));
    const stripY = g.oy - g.cell * STRIP * 0.5;
    for (const t of [this.stripPings, this.stripSector, this.stripHidden]) if (t) t.style.fontSize = small;
    this.stripPings?.position.set(g.ox + 2, stripY);
    this.stripSector?.position.set(g.ox + g.width / 2, stripY);
    this.stripHidden?.position.set(g.ox + g.width - 2, stripY);
    for (const t of [this.switchPing, this.switchLock]) if (t) t.style.fontSize = Math.max(13, Math.round(g.cell * 0.34));
    if (this.switchBounty) this.switchBounty.style.fontSize = small;
    this.cursor = Math.min(this.cursor, n - 1);
    this.press = null;
    this.pulses = [];
    this.holding = false;
    this.publishGeom(g.ox, g.oy, g.cell);
    const [ping, lock] = this.switchRects();
    this.app.canvas.setAttribute("data-switch", [ping.x + ping.w / 2, ping.y + ping.h / 2, lock.x + lock.w / 2, lock.y + lock.h / 2].map(Math.round).join(","));
    if (this.state) this.snap(scannerViewString(this.state), this.state);
    else this.cells = Array.from({ length: n }, () => ({ ch: ".", shade: 0, pop: 1 }));
    this.drawSwitch();
    this.drawCursor();
    this.dirty = true;
  }

  // ---- the picture

  /** Show exactly this view, with nothing in motion, and the strip for `state`. A ring still fading from the move just played may be kept. */
  private snap(view: string, state: ScannerState, keepRings = false): void {
    this.cells = [...view].map((ch) => ({ ch, shade: ch === "." ? 0 : 1, pop: 1 }));
    this.pulses = keepRings ? this.pulses.filter((p) => p.fade !== null) : [];
    this.holding = false;
    this.stripFor = state;
    this.drawStrip();
    this.drawSwitch();
    this.dirty = true;
    this.touchView();
  }

  protected view(): string {
    return this.cells.map((c) => c.ch).join("");
  }

  private drawCells(): void {
    const g = this.grid;
    const l = this.cellLayer;
    l.clear();
    const size = g.cell;
    const inset = Math.max(1, size * 0.04);
    const round = size * 0.16;
    this.cells.forEach((c, i) => {
      const x = g.x(i);
      const y = g.y(i);
      const x0 = x - size / 2 + inset;
      const y0 = y - size / 2 + inset;
      const w = size - inset * 2;
      // The recess a proven cell shows, then the fog over it, thinner as the shading comes in.
      const fog = 1 - c.shade;
      const plate = this.sprite(l, "clear", x, y, w);
      if (plate) {
        // The sheet's fog is clouded, which reads apart from a shaded plate as the stipple does.
        if (fog > 0.01) this.sprite(l, "fog", x, y, w, fog);
      } else {
        l.roundRect(x0, y0, w, w, round).fill({ color: CLEAR });
        l.roundRect(x0, y0, w, w, round).stroke({ width: 1, color: INK.line, alpha: 0.9 });
      }
      if (!plate && fog > 0.01) {
        l.roundRect(x0, y0, w, w, round).fill({ color: FOG, alpha: fog });
        l.roundRect(x0 + 1, y0 + 1, w - 2, w * 0.45, round).fill({ color: FOG_LIT, alpha: 0.45 * fog });
        // Fog is stippled, so it reads apart from a shaded cell by more than its brightness.
        const s = size * 0.2;
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [0, 0],
          [-1, 1],
          [1, 1],
        ] as const)
          l.circle(x + dx * s, y + dy * s, Math.max(1, size * 0.035)).fill({ color: INK.white, alpha: 0.2 * fog });
      }
      const t = this.numbers[i];
      const ping = isPing(c.ch);
      if (t) {
        t.visible = ping;
        if (ping) {
          t.text = String(parseInt(c.ch, 36));
          t.scale.set(c.pop);
        }
      }
      const r = size * 0.3 * c.pop;
      // What a frame is drawn down for: a mark pops in, and must not be drawn down afresh at every size on the way.
      const full = size * 0.3;
      if (ping) {
        // A ping's own cell: a diamond behind its number.
        const d = size * 0.4 * Math.min(1.15, c.pop);
        if (this.sprite(l, "ping", x, y, d * 2.1, 0.5, size * 0.84)) return;
        l.poly([x, y - d, x + d, y, x, y + d, x - d, y]).fill({ color: PING, alpha: 0.14 });
        l.poly([x, y - d, x + d, y, x, y + d, x - d, y]).stroke({ width: Math.max(1.5, size * 0.035), color: PING, alpha: 0.75, join: "round" });
      } else if (c.ch === "X") {
        if (!this.sprite(l, "found", x, y, r * 2.7, 1, full * 2.7)) drawFound(l, x, y, r, this.showMarks);
        else if (this.showMarks) drawPips(l, 1, x, y, r * 0.8);
      } else if (c.ch === "S") {
        if (!this.sprite(l, "spooked", x, y, r * 2.4, 1, full * 2.4)) drawSpooked(l, x, y, r, this.showMarks);
        else if (this.showMarks) drawPips(l, 2, x, y, r * 0.9, INK.text, 0.9);
      } else if (c.ch === "!") this.sprite(l, "miss", x, y, r * 2, 1, full * 2) || drawMiss(l, x, y, r);
      else if (c.ch === "-" && this.showMarks && c.shade > 0.5) l.rect(x - size * 0.09, y - 1, size * 0.18, 2).fill({ color: INK.dim, alpha: 0.7 });
    });
  }

  private drawStrip(): void {
    const s = this.stripFor;
    if (!s || !this.stripPings || !this.stripSector || !this.stripHidden) return;
    const left = scannerPingsLeft(s);
    this.stripPings.text = left >= 0 ? this.opts.labels.pings(left, s.par) : this.opts.labels.over(-left);
    this.stripPings.style.fill = left > 0 ? INK.text : left === 0 ? INK.brass : INK.danger;
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

  /** The switch under the sector: two big halves, the live one filled and marked with a notch, each with its own glyph. */
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
      const color = verb === "ping" ? PING : LOCK;
      const round = r.h * 0.28;
      l.roundRect(r.x, r.y, r.w, r.h, round).fill({ color: on ? color : INK.well, alpha: on ? 1 : 0.9 });
      l.roundRect(r.x, r.y, r.w, r.h, round).stroke({ width: on ? 3 : 1.5, color: on ? INK.white : mix(color, INK.panel, 0.45), alpha: on ? 0.95 : 0.9 });
      // The live half points up at the sector.
      if (on) l.poly([r.x + r.w / 2 - r.h * 0.2, r.y, r.x + r.w / 2, r.y - r.h * 0.2, r.x + r.w / 2 + r.h * 0.2, r.y]).fill({ color: INK.white });
      const ink = on ? INK.bg : color;
      const gx = r.x + r.h * 0.55;
      const gy = r.y + r.h / 2;
      const gr = r.h * 0.26;
      if (verb === "ping") {
        for (const k of [1, 0.5]) l.poly([gx, gy - gr * k, gx + gr * k, gy, gx, gy + gr * k, gx - gr * k, gy]).stroke({ width: Math.max(1.5, gr * 0.2), color: ink, join: "round" });
        l.circle(gx, gy, Math.max(1.5, gr * 0.14)).fill({ color: ink });
      } else {
        drawBrackets(l, gx, gy, gr, gr * 0.5, Math.max(1.5, gr * 0.22), ink, 1);
        l.circle(gx, gy, gr * 0.36).fill({ color: ink });
      }
      const t = texts[i];
      if (t) {
        t.text = labels[i]!;
        t.style.fill = ink;
        t.position.set(r.x + r.w * 0.56, gy);
      }
    });
    if (this.switchBounty && this.switchLock) {
      const r = rects[1];
      const s = this.stripFor;
      this.switchBounty.text = s ? this.opts.labels.bounty(scannerLockValue(s)) : "";
      this.switchBounty.style.fill = this.verb === "lock" ? INK.bg : INK.dim;
      // Under the word when the half is too narrow to hold both side by side.
      const beside = r.w > g.cell * 2.6;
      this.switchLock.position.set(r.x + r.w * (beside ? 0.46 : 0.58), r.y + r.h * (beside ? 0.5 : 0.36));
      this.switchBounty.position.set(r.x + r.w * (beside ? 0.78 : 0.58), r.y + r.h * (beside ? 0.52 : 0.72));
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

  /** A diamond going out from `cell` to `d` cells from `at`; the ring it reaches stays lit a moment and fades on its own. Returns the ms it takes to get there. */
  private sound(cell: number, d: number, color: number, at: number): number {
    const ms = 200 + d * 85;
    const pulse: Pulse = { cell, r: 0, alpha: 0.95, color, width: 3, fade: null };
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
          pulse.fade = RING_FADE_MS;
        },
      },
    );
    return ms;
  }

  /** Put a mark in a cell at `at` and let it land: it starts big and settles. */
  private land(cell: number, ch: string, at: number, from = 1.7): void {
    const look = this.cells[cell];
    if (!look) return;
    this.tweens.after(at, () => {
      look.ch = ch;
      look.shade = 1;
      look.pop = from;
      this.touchView();
    });
    this.tweens.run(
      260,
      (k) => {
        look.pop = from + (1 - from) * k;
      },
      { delay: at, ease: ease.outBack },
    );
  }

  /** Shade the cells that are fog now (or all of them, when the sector will be `blank` by then) and proven empty in `view`, each as the ring from `origin` reaches it. */
  private shade(view: string, origin: number, at: number, perStep: number, blank = false): void {
    const state = this.state;
    if (!state) return;
    this.cells.forEach((look, cell) => {
      if ((!blank && look.ch !== ".") || view[cell] !== "-") return;
      const delay = at + scannerDistance(state.config, origin, cell) * perStep;
      this.tweens.after(delay, () => {
        look.ch = "-";
        this.touchView();
      });
      this.tweens.run(
        220,
        (k) => {
          look.shade = k;
        },
        { delay },
      );
    });
  }

  /** Play a move out: the ping going out or the lock closing, the numbers that sound again, then a cleared sector giving way to the next. */
  private play(state: ScannerState, prev: ScannerState, r: ScannerMoveReport): void {
    const g = this.grid;
    const labels = this.opts.labels;
    const x = g.x(r.cell);
    const y = g.y(r.cell);
    const big = Math.max(16, g.cell * 0.46);
    const lostStreak = prev.combo >= 2 && state.combo === 0 && (r.wrong || r.spooked);
    // The old sector as it stands once this move is on it. A move that clears it leaves the numbers as they were.
    const after = r.cleared === null ? scannerViewString(state) : this.view();
    let t = 0;
    if (r.cleared === null) {
      this.stripFor = state;
      this.drawStrip();
      this.drawSwitch();
    }

    if (r.distance !== null && !r.spooked) {
      // A ping: the diamond goes out to its distance, the number lands, and the cells it proves empty shade as the ring passes.
      const d = r.distance;
      this.tweens.after(0, () => sfx.ping(d));
      const ms = this.sound(r.cell, d, PING, 0);
      this.land(r.cell, d.toString(36), Math.min(140, ms * 0.4));
      this.shade(after, r.cell, 40, ms / Math.max(1, d));
      if (r.cost < 0) {
        this.tweens.after(160, () => {
          sfx.bump();
          this.fx.popup(x, y - g.cell * 0.45, String(r.cost), INK.danger, big * 0.9);
          if (scannerPingsLeft(state) === -1) this.fx.say(labels.overPar, INK.danger);
        });
      }
      t = ms + 120;
    } else if (r.spooked) {
      // A ping on a contact: it bolts.
      this.tweens.after(0, () => sfx.ping(0));
      this.sound(r.cell, 0.6, INK.danger, 0);
      this.land(r.cell, "S", 120);
      this.tweens.after(120, () => {
        sfx.bad();
        sfx.whoosh();
        this.fx.burst(x, y, INK.danger, 14, 0.3, 4);
        this.fx.flash(INK.danger, 0.16, 300);
        this.fx.shake(7, 280);
        this.fx.say(lostStreak ? labels.streakLost : labels.spooked, INK.danger);
        this.fx.popup(x, y - g.cell * 0.45, String(r.cost), INK.danger, big);
        if (lostStreak) sfx.streakLost();
      });
      t = 380;
    } else if (r.found) {
      // A lock on a contact: the brackets close and the bounty pops.
      this.land(r.cell, "X", 60, 0.3);
      this.tweens.after(60, () => {
        sfx.good();
        this.fx.ring(x, y, LOCK, g.cell * 0.25, g.cell * 0.95, 420, 4);
        this.fx.burst(x, y, LOCK, 10, 0.22, 4);
        this.fx.popup(x, y - g.cell * 0.45, `+${r.findPoints}`, INK.gold, big * (r.streakPercent > 100 ? 1.2 : 1));
      });
      t = 300;
    } else if (r.wrong) {
      this.land(r.cell, "!", 0);
      this.tweens.after(0, () => {
        sfx.bad();
        this.fx.shake(6, 260);
        this.fx.flash(INK.danger, 0.12, 240);
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
      this.sound(e.cell, 0.75, PING, at);
      this.land(e.cell, e.to.toString(36), at, 1.5);
    });
    if (r.resound.length > 0) {
      this.shade(after, r.cell, t + 60, 30);
      t += r.resound.length * 70 + 220;
    }

    const c = r.cleared;
    if (c === null) {
      this.tweens.after(t, () => this.snap(after, state, true));
      return;
    }

    // The sector is cleared: say so, pay the pings saved, then let the fog close and the next sector open on its ping.
    this.holding = true;
    const cx = g.ox + g.width / 2;
    const cy = g.oy + g.height / 2;
    this.tweens.after(t, () => {
      for (const cell of c.contacts) this.fx.ring(g.x(cell), g.y(cell), c.clean ? LOCK : PING, g.cell * 0.3, g.cell * 0.8, 480, 3);
      this.fx.flash(c.clean ? LOCK : PING, 0.14, 320);
      if (c.clean) {
        sfx.streak(c.streak * 3);
        this.fx.say(c.streak >= 2 ? labels.streak(c.streak) : labels.clean, INK.gold);
        if (c.streak >= 2) this.fx.shake(Math.min(9, 3 + c.streak), 260);
        if (c.bonus > 0) this.fx.popup(cx, cy + g.cell * 0.4, labels.saved(c.saved, c.bonus), INK.gold, big * 1.15);
      } else {
        sfx.good();
        this.fx.say(labels.sectorClear, INK.text);
      }
    });
    t += 620;
    // The fog closes over everything.
    this.cells.forEach((look) => {
      let shade: number | null = null;
      this.tweens.run(
        220,
        (k) => {
          shade ??= look.shade;
          look.shade = shade * (1 - k);
          if (look.ch !== "." && look.ch !== "-") look.pop = 1 - k;
        },
        {
          delay: t,
          ease: ease.inQuad,
          done: () => {
            look.ch = ".";
            look.shade = 0;
            look.pop = 1;
          },
        },
      );
    });
    t += 260;
    const next = scannerViewString(state);
    const open = state.pings[0];
    this.tweens.after(t, () => {
      // The new sector is on screen from here: its strip, and taps again.
      this.holding = false;
      this.stripFor = state;
      this.drawStrip();
      this.drawSwitch();
      this.touchView();
    });
    if (open) {
      this.tweens.after(t, () => sfx.ping(open.distance));
      const ms = this.sound(open.cell, open.distance, PING, t);
      this.land(open.cell, open.distance.toString(36), t + Math.min(140, ms * 0.4));
      this.shade(next, open.cell, t + 40, ms / Math.max(1, open.distance), true);
      t += ms + 120;
    }
    // Whatever the tweens did, the sector ends as the engine holds it.
    this.tweens.after(t, () => this.snap(next, state, true));
  }

  // ---- every frame

  protected override update(dt: number): void {
    if (this.busy || this.dirty) {
      this.dirty = false;
      this.drawCells();
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
      const k = Math.max(0, pulse.fade / RING_FADE_MS);
      pulse.alpha = 0.95 * k * k;
      pulse.width = 3 + 2 * k;
      if (pulse.fade <= 0) this.pulses.splice(i, 1);
    }
    this.drawOverlay();
    this.updateHint(dt);
  }

  /** The lit ring, the pulses in flight, and the brackets closing under a held finger. */
  private drawOverlay(): void {
    const g = this.grid;
    const p = this.pulseLayer;
    p.clear();
    for (const pulse of this.pulses) {
      if (pulse.alpha <= 0.01) continue;
      const x = g.x(pulse.cell);
      const y = g.y(pulse.cell);
      const r = Math.max(0.12, pulse.r) * g.cell;
      p.poly([x, y - r, x + r, y, x, y + r, x - r, y]).stroke({ width: pulse.width * 2.6, color: pulse.color, alpha: pulse.alpha * 0.22, join: "round" });
      p.poly([x, y - r, x + r, y, x, y + r, x - r, y]).stroke({ width: pulse.width, color: pulse.color, alpha: pulse.alpha, join: "round" });
    }
    const l = this.ringLayer;
    l.clear();
    const state = this.state;
    const ping = state && this.selected !== null && !this.holding ? scannerPingAt(state, this.selected) : null;
    const ringAttr = ping && state ? `${ping.cell}:${scannerPingCandidates(state, ping).join(",")}` : "";
    if (ringAttr !== this.ringAttr) {
      this.ringAttr = ringAttr;
      this.app.canvas.setAttribute("data-ring", ringAttr);
    }
    if (ping && state) {
      const x = g.x(ping.cell);
      const y = g.y(ping.cell);
      const r = ping.distance * g.cell;
      const beat = 0.5 + 0.5 * Math.sin(this.time / 220);
      // The diamond itself, then each cell on it: bright where the contact it hears can be, faint where it cannot.
      l.poly([x, y - r, x + r, y, x, y + r, x - r, y]).stroke({ width: 2, color: PING, alpha: 0.55, join: "round" });
      const half = g.cell / 2 - 3;
      l.roundRect(x - half, y - half, half * 2, half * 2, g.cell * 0.16).stroke({ width: 2.5, color: PING, alpha: 0.9 });
      const could = new Set(scannerPingCandidates(state, ping));
      for (const cell of scannerRingCells(state.config, ping.cell, ping.distance)) {
        const cx = g.x(cell);
        const cy = g.y(cell);
        if (could.has(cell)) {
          l.roundRect(cx - half, cy - half, half * 2, half * 2, g.cell * 0.16).fill({ color: PING, alpha: 0.16 + 0.1 * beat });
          l.roundRect(cx - half, cy - half, half * 2, half * 2, g.cell * 0.16).stroke({ width: 3, color: INK.white, alpha: 0.75 + 0.25 * beat });
          const d = g.cell * 0.13;
          l.poly([cx, cy - d, cx + d, cy, cx, cy + d, cx - d, cy]).fill({ color: INK.white, alpha: 0.9 });
        } else {
          l.circle(cx, cy, g.cell * 0.06).fill({ color: PING, alpha: 0.5 });
        }
      }
    }
    const held = this.press && !this.press.fired ? performance.now() - this.press.at : 0;
    if (this.press && held > 110) {
      const k = Math.min(1, (held - 110) / (LONG_PRESS_MS - 110));
      const cell = this.press.cell;
      const half = g.cell * (0.74 - 0.3 * k);
      if (!this.sprite(l, "brackets", g.x(cell), g.y(cell), half * 2.1, 0.5 + 0.5 * k, g.cell * 0.92)) drawBrackets(l, g.x(cell), g.y(cell), half, g.cell * 0.18, 3, LOCK, 0.5 + 0.5 * k);
    }
  }

  /** A safe move pulses after a pause, in rounds that allow hints: brackets where a lock is proven, a diamond where a ping is safe. */
  private updateHint(dt: number): void {
    const state = this.state;
    const can = this.interactive && this.hints && state !== null && !state.finished && !this.busy && !this.press && !this.holding;
    this.idle = can ? this.idle + dt : 0;
    if (!can || state === null || this.idle < HINT_AFTER_MS) {
      if (this.hintShown) {
        this.hintShown = false;
        this.hintLayer.clear();
        this.app.canvas.removeAttribute("data-hint");
      }
      return;
    }
    if (this.hintFor !== state) {
      this.hintFor = state;
      this.hint = scannerHint(state);
    }
    this.hintLayer.clear();
    if (!this.hint) return;
    if (!this.hintShown) {
      this.hintShown = true;
      this.app.canvas.setAttribute("data-hint", `${this.hint.type}:${this.hint.cell}`);
    }
    const g = this.grid;
    const x = g.x(this.hint.cell);
    const y = g.y(this.hint.cell);
    const beat = 0.5 + 0.5 * Math.sin(this.time / 260);
    if (this.hint.type === "lock") {
      const half = g.cell * (0.4 + 0.05 * beat);
      if (!this.sprite(this.hintLayer, "lock", x, y, half * 2.1, 0.45 + 0.5 * beat, g.cell * 0.92)) drawBrackets(this.hintLayer, x, y, half, g.cell * 0.16, 3, LOCK, 0.45 + 0.5 * beat);
    } else {
      const r = g.cell * (0.3 + 0.06 * beat);
      this.hintLayer.poly([x, y - r, x + r, y, x, y + r, x - r, y]).stroke({ width: 3, color: PING, alpha: 0.45 + 0.5 * beat, join: "round" });
    }
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
    if (!this.cursorShown) return;
    const half = g.cell / 2 - 2;
    this.cursorLayer.roundRect(g.x(this.cursor) - half, g.y(this.cursor) - half, half * 2, half * 2, g.cell * 0.16).stroke({ width: 3, color: INK.white, alpha: 0.9 });
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

/** Four corner brackets round (x, y): the mark of a lock. `r` is the half-width, `arm` the length of each leg. */
function drawBrackets(g: Graphics, x: number, y: number, r: number, arm: number, width: number, color: number, alpha: number): void {
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    g.moveTo(x + sx * r, y + sy * (r - arm));
    g.lineTo(x + sx * r, y + sy * r);
    g.lineTo(x + sx * (r - arm), y + sy * r);
  }
  g.stroke({ width, color, alpha, cap: "round", join: "round" });
}

/** A contact found by a lock: a solid gold disc held in four brackets. */
function drawFound(g: Graphics, x: number, y: number, r: number, marks: boolean): void {
  if (r <= 0.5) return;
  g.circle(x, y + r * 0.1, r * 0.72).fill({ color: INK.black, alpha: 0.35 });
  g.circle(x, y, r * 0.72).fill({ color: LOCK });
  g.circle(x, y, r * 0.72).stroke({ width: Math.max(1.2, r * 0.12), color: mix(LOCK, INK.black, 0.5) });
  g.circle(x - r * 0.18, y - r * 0.2, r * 0.3).fill({ color: INK.white, alpha: 0.45 });
  drawBrackets(g, x, y, r * 1.22, r * 0.5, Math.max(2, r * 0.2), LOCK, 1);
  if (marks) drawPips(g, 1, x, y, r * 0.8);
}

/** A contact a ping spooked: a hollow, broken outline with a stroke through it. Nothing like a found one. */
function drawSpooked(g: Graphics, x: number, y: number, r: number, marks: boolean): void {
  if (r <= 0.5) return;
  const color = mix(INK.danger, INK.text, 0.25);
  const n = 8;
  for (let i = 0; i < n; i += 2) {
    const a0 = (i / n) * Math.PI * 2 + 0.3;
    const a1 = ((i + 1.2) / n) * Math.PI * 2 + 0.3;
    g.moveTo(x + Math.cos(a0) * r * 0.85, y + Math.sin(a0) * r * 0.85);
    g.arc(x, y, r * 0.85, a0, a1);
  }
  g.stroke({ width: Math.max(2, r * 0.18), color, alpha: 0.95, cap: "round" });
  g.moveTo(x - r * 1.05, y + r * 1.05);
  g.lineTo(x + r * 1.05, y - r * 1.05);
  g.stroke({ width: Math.max(2, r * 0.2), color, alpha: 0.95, cap: "round" });
  if (marks) drawPips(g, 2, x, y, r * 0.9, INK.text, 0.9);
}

/** A lock on empty space: a cross. */
function drawMiss(g: Graphics, x: number, y: number, r: number): void {
  if (r <= 0.5) return;
  const a = r * 0.7;
  g.moveTo(x - a, y - a);
  g.lineTo(x + a, y + a);
  g.moveTo(x + a, y - a);
  g.lineTo(x - a, y + a);
  g.stroke({ width: Math.max(2.5, r * 0.26), color: INK.danger, alpha: 0.95, cap: "round" });
}
