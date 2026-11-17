import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  DEFLECTORS_BACKSLASH,
  DEFLECTORS_EMPTY,
  DEFLECTORS_SLASH,
  deflectorsBestPoints,
  deflectorsHint,
  deflectorsOutlook,
  deflectorsTrace,
  deflectorsViewString,
  type DeflectorsBeam,
  type DeflectorsEvent,
  type DeflectorsOutcome,
  type DeflectorsState,
  type DeflectorsTrace,
  type DeflectorsVolley,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION, ink } from "../look/tokens.js";
import { FONT_MONO, INK, drawDot, drawHairline, mix } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";
import { MIRROR_COLOR, MIRROR_PAINT, signOf, signPaint, type SignShape } from "./pieces.js";

export interface DeflectorsCallbacks {
  /** The player tapped the mirror at `cell`. */
  onFlip(cell: number): void;
  /** The player asked for the waiting volley `volley` to fire now. */
  onFire(volley: number): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface DeflectorsLabels {
  /** The strip over the grid while every beam is home: what firing now adds, and the most the volley could. */
  outlook(points: number, best: number): string;
  /** The strip when the volley is perfect as it stands. */
  outlookPerfect(points: number): string;
  /** The strip while a beam is astray: how many are home, and the most the volley could add. */
  outlookAstray(home: number, beams: number, best: number): string;
  perfect: string;
  streak(count: number): string;
  longRoute(turns: number): string;
  hull: string;
}

export interface DeflectorsRendererOptions {
  /** Pulse the next mirror to flip after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: DeflectorsLabels;
}

/** A fired beam on its way: drawn from its entry to where its head has got to, then fading. */
interface Flight {
  /** x0, y0, x1, y1, ...: the entry port, every turn, the port it left by. */
  pts: number[];
  /** The length of the path up to each point. */
  lens: number[];
  color: number;
  /** How far the head has run, 0 to 1, and how far the trail has faded, 0 to 1. */
  run: number;
  fade: number;
  /** Turns the head has passed. */
  sparked: number;
}

const HINT_AFTER_MS = 5000;
/** A fire tap this soon after a volley appears was meant for the one before it. */
const FIRE_GUARD_MS = 350;
/** A route this long is called out. */
const LONG_ROUTE = 8;
const SLASH_ROTATION = 0;
const BACKSLASH_ROTATION = Math.PI / 2;
/** A sign's picture, in cells. */
const SIGN = 0.7;
/** How far outside the grid a port's centre sits, in cells. */
const PORT_OUT = 0.5;
/** The strip over the grid, in cells: what the volley is worth, and the count as a bar under it. */
const STRIP = 0.8;

/** Draws the deflector grid and turns taps into flips and fires. Scores nothing: every number it shows is the engine's. */
export class DeflectorsRenderer extends KitBoard<DeflectorsState> {
  private readonly grid = new Grid(6, 6);
  private readonly bg = new Graphics();
  /** The waiting beams' routes: redrawn every frame from the engine's trace of the mirrors as they stand. */
  private readonly routeLayer = new Graphics();
  private readonly mirrorLayer = new Container();
  /** The signs at the ports: a sprite for each beam's entry and one for its exit. */
  private readonly signLayer = new Container();
  private readonly signs: Sprite[] = [];
  /** The count, the arrows into the grid, the cross where a beam would leave, the hint. */
  private readonly markLayer = new Graphics();
  private readonly flightLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private label: Text | null = null;
  private labelText = "";
  private readonly mirrors = new Map<number, Sprite>();
  /** What each cell is drawn as, once any turn in progress ends. */
  private shownMirrors: number[] = [];
  private readonly flights: Flight[] = [];
  /** The last engine event played: a ticked board is handed every event more than once. */
  private lastSeq = 0;
  /** When the state's tick last changed, so the count runs smoothly between ticks. */
  private tickAt = 0;
  /** The volley that last appeared, and when: its signs pop in. */
  private appeared = { id: 0, at: 0 };
  /** The beams whose signs were drawn this frame: what `view` reports. */
  private shownBeams: readonly DeflectorsBeam[] = [];
  /** The engine's word on the waiting volley, kept for as long as the state it was asked of. */
  private told: { state: DeflectorsState; outlook: DeflectorsOutcome | null; back: DeflectorsTrace[]; best: number } | null = null;
  /** The keyboard's cell. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private hints: boolean;
  private idle = 0;
  /** True while the player is following the hint flip by flip: the next one shows at once. */
  private hintHot = false;
  private hint: { volley: number; flips: number; cell: number | null } | null = null;
  /** Flips seen, so a hint is asked for once a setting, not once a frame. */
  private flipsSeen = 0;
  private warned = 0;

  constructor(
    host: HTMLElement,
    private readonly cb: DeflectorsCallbacks,
    private readonly opts: DeflectorsRendererOptions,
  ) {
    super(host, "deflectors", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  /**
   * Play whatever in `events` has not been played. The page hands over the report of every logged
   * move as well as the state on show, so a volley fired on the last instant of a tick is still
   * seen to fire when the state on show has already moved on.
   */
  noteEvents(events: readonly DeflectorsEvent[]): void {
    if (!this.isReady || !this.state) return;
    this.play(events);
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(0.5);
    this.world.addChild(this.bg, this.routeLayer, this.mirrorLayer, this.signLayer, this.markLayer, this.flightLayer, this.cursorLayer, this.label);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    const n = this.state?.config.size ?? g.cols;
    g.cols = n;
    g.rows = n;
    // The grid, a ring of ports round it, and the strip above.
    const margin = 6;
    const cell = Math.floor(Math.min((width - margin * 2) / (n + 2), (height - margin * 2) / (n + 2 + STRIP)));
    g.cell = Math.max(12, Math.min(84, cell));
    g.ox = Math.floor((width - g.cell * n) / 2);
    g.oy = Math.floor((height - g.cell * (n + 2 + STRIP)) / 2 + g.cell * (STRIP + 1));
    const c = g.cell;
    // Bare ground under the strip, the ports and the grid. The one hairline is round the grid: a beam leaves across it.
    this.bg.clear();
    this.paintGround(this.bg, g.ox - c, g.oy - c - c * STRIP, g.width + c * 2, g.height + c * 2 + c * STRIP, false);
    drawHairline(this.bg, g.ox, g.oy, g.width, g.height);
    // A dot in every cell, so an empty one a beam runs straight through is seen, and one at each port.
    for (let i = 0; i < n * n; i++) drawDot(this.bg, g.x(i), g.y(i), c);
    for (let port = 0; port < n * 4; port++) {
      const p = this.portXY(port);
      drawDot(this.bg, p.x, p.y, c);
    }
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(c * 0.33));
      this.label.position.set(g.ox + g.width / 2, g.oy - c - c * STRIP * 0.55);
    }
    this.flights.length = 0;
    this.cursor = Math.min(this.cursor, n * n - 1);
    this.publishGeom(g.ox, g.oy, c);
    // The layout dropped the baked pictures: the signs take new ones on the next frame.
    for (const sp of this.signs) sp.visible = false;
    if (this.state) this.snapMirrors(this.state);
    this.drawCursor();
  }

  /** The centre of a port's socket. Ports run along the top, the right, the bottom, then the left, as the engine numbers them. */
  private portXY(port: number): { x: number; y: number } {
    const g = this.grid;
    const n = g.cols;
    const i = port % n;
    const out = g.cell * PORT_OUT;
    switch (Math.floor(port / n)) {
      case 0:
        return { x: g.cx(i), y: g.oy - out };
      case 1:
        return { x: g.ox + g.width + out, y: g.cy(i) };
      case 2:
        return { x: g.cx(i), y: g.oy + g.height + out };
      default:
        return { x: g.ox - out, y: g.cy(i) };
    }
  }

  /** The way into the grid from a port, as a unit step. */
  private portInward(port: number): { x: number; y: number } {
    switch (Math.floor(port / this.grid.cols)) {
      case 0:
        return { x: 0, y: 1 };
      case 1:
        return { x: -1, y: 0 };
      case 2:
        return { x: 0, y: -1 };
      default:
        return { x: 1, y: 0 };
    }
  }

  /** The port under a point in the ring round the grid, with some room past its outer edge for a thumb. */
  private portAt(x: number, y: number): number | null {
    const g = this.grid;
    const n = g.cols;
    const c = g.cell;
    const col = Math.floor((x - g.ox) / c);
    const row = Math.floor((y - g.oy) / c);
    const reach = c * 1.35;
    if (col >= 0 && col < n) {
      if (y < g.oy && y >= g.oy - reach) return col;
      if (y >= g.oy + g.height && y < g.oy + g.height + reach) return 2 * n + col;
    }
    if (row >= 0 && row < n) {
      if (x >= g.ox + g.width && x < g.ox + g.width + reach) return n + row;
      if (x < g.ox && x >= g.ox - reach) return 3 * n + row;
    }
    return null;
  }

  /** A route as points: the port it comes in by, every turn, the port it leaves by. */
  private pathOf(entry: number, t: DeflectorsTrace): number[] {
    const g = this.grid;
    const a = this.portXY(entry);
    const pts = [a.x, a.y];
    for (const cell of t.turns) pts.push(g.x(cell), g.y(cell));
    const b = this.portXY(t.out);
    pts.push(b.x, b.y);
    return pts;
  }

  /** A mirror's picture, drawn as a `/`. A `\\` is the same sprite a quarter turn on. */
  private mirrorTexture(): Texture {
    return this.piece("mirror", this.grid.cell, MIRROR_COLOR, MIRROR_PAINT);
  }

  /** Put exactly the state's mirrors on the grid, each as it is set, with nothing in motion. */
  private snapMirrors(state: DeflectorsState): void {
    for (const s of this.mirrors.values()) s.destroy();
    this.mirrors.clear();
    state.mirrors.forEach((m, cell) => {
      if (m === DEFLECTORS_EMPTY) return;
      const s = new Sprite(this.mirrorTexture());
      s.anchor.set(0.5);
      s.position.set(this.grid.x(cell), this.grid.y(cell));
      s.rotation = m === DEFLECTORS_SLASH ? SLASH_ROTATION : BACKSLASH_ROTATION;
      this.mirrorLayer.addChild(s);
      this.mirrors.set(cell, s);
    });
    this.shownMirrors = state.mirrors.slice();
    this.flipsSeen++;
    this.touchView();
  }

  /** Turn the mirror at `cell` over to `way`. */
  private turnMirror(cell: number, way: number): void {
    const s = this.mirrors.get(cell);
    this.shownMirrors[cell] = way;
    this.flipsSeen++;
    if (!s) return;
    sfx.swap();
    this.tweens.move(s, { rotation: way === DEFLECTORS_SLASH ? SLASH_ROTATION : BACKSLASH_ROTATION });
  }

  /** True when `state` is not the round `prev` was a moment later: a new round, a step back in a review, another grid. */
  private isReset(state: DeflectorsState, prev: DeflectorsState | null): boolean {
    if (!prev) return true;
    if (state.tick === 0 && state.eventSeq === 0 && state.logLength === 0) return true;
    if (state.eventSeq < prev.eventSeq || state.tick < prev.tick || state.mirrors.length !== prev.mirrors.length) return true;
    for (let c = 0; c < state.mirrors.length; c++) if ((state.mirrors[c] === DEFLECTORS_EMPTY) !== (prev.mirrors[c] === DEFLECTORS_EMPTY)) return true;
    return false;
  }

  protected override keepsPlaying(state: DeflectorsState, prev: DeflectorsState | null): boolean {
    return !this.isReset(state, prev);
  }

  protected onState(state: DeflectorsState, prev: DeflectorsState | null): void {
    if (!prev || state.tick !== prev.tick) this.tickAt = this.time;
    if (this.isReset(state, prev)) {
      this.lastSeq = state.eventSeq;
      this.flights.length = 0;
      this.appeared = { id: state.volley?.id ?? 0, at: this.time - 1000 };
      this.idle = 0;
      this.hintHot = false;
      this.hint = null;
      if (this.grid.cols !== state.config.size) this.layout(this.app.screen.width, this.app.screen.height);
      else this.snapMirrors(state);
      return;
    }
    for (let c = 0; c < state.mirrors.length; c++) if (state.mirrors[c] !== this.shownMirrors[c]) this.turnMirror(c, state.mirrors[c]!);
    this.play(state.lastMove?.events ?? []);
  }

  private play(events: readonly DeflectorsEvent[]): void {
    for (const e of events) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      if (e.type === "deal") this.playDeal(e.volley);
      else this.playFire(e.outcome);
    }
  }

  /** A volley is announced: its signs grow in at their ports. */
  private playDeal(volley: DeflectorsVolley): void {
    this.appeared = { id: volley.id, at: this.time };
    this.idle = 0;
    this.hintHot = false;
    this.warned = 0;
    sfx.power(0.15 + 0.25 * volley.beams.length);
  }

  /** A volley fires: every beam runs its whole path, a note at each turn, and lands where the engine says. */
  private playFire(outcome: DeflectorsOutcome): void {
    const g = this.grid;
    const c = g.cell;
    sfx.zap();
    let longest = 0;
    let end = 0;
    outcome.shots.forEach((shot, i) => {
      const color = ink(signOf(shot.sign).color);
      const pts = this.pathOf(shot.entry, shot);
      const lens = [0];
      for (let p = 2; p + 1 < pts.length; p += 2) lens.push(lens[lens.length - 1]! + Math.hypot(pts[p]! - pts[p - 2]!, pts[p + 1]! - pts[p - 1]!));
      const total = lens[lens.length - 1]!;
      const flight: Flight = { pts, lens, color, run: 0, fade: 0, sparked: 0 };
      this.flights.push(flight);
      const delay = i * 90;
      const ms = Math.max(220, Math.min(560, 160 + shot.bounces * 42));
      end = Math.max(end, delay + ms);
      if (shot.hit) longest = Math.max(longest, shot.bounces);
      const outX = pts[pts.length - 2]!;
      const outY = pts[pts.length - 1]!;
      this.tweens.run(
        ms,
        (k) => {
          flight.run = k;
          // The head has passed a turn: a note one step up the ladder.
          while (flight.sparked < shot.turns.length && k * total >= lens[flight.sparked + 1]! - 0.5) {
            sfx.pop(Math.min(9, flight.sparked));
            flight.sparked++;
          }
        },
        {
          delay,
          ease: ease.linear,
          done: () => {
            if (shot.hit) {
              this.fx.popup(outX, outY - c * 0.25, `+${shot.points}`, INK.cream, Math.max(15, c * (shot.bounces >= LONG_ROUTE ? 0.5 : 0.4)));
              sfx.good();
            } else {
              // Where the hull was hit: one ring in danger, and what it cost.
              this.fx.ring(outX, outY, INK.danger, c * 0.36, c * 0.36, 420, Math.max(2, c * 0.07));
              if (shot.points < 0) this.fx.popup(outX, outY - c * 0.25, `${shot.points}`, INK.danger, Math.max(15, c * 0.4));
              sfx.thud();
              sfx.bad();
            }
            this.tweens.run(420, (k) => (flight.fade = k), {
              ease: ease.inQuad,
              done: () => {
                const at = this.flights.indexOf(flight);
                if (at >= 0) this.flights.splice(at, 1);
              },
            });
          },
        },
      );
    });
    // Once every beam has landed: what the volley came to, and the name of what happened.
    this.tweens.after(end + 60, () => {
      const labels = this.opts.labels;
      const cx = g.ox + g.width / 2;
      if (!outcome.clean) {
        this.fx.say(labels.hull, INK.danger);
        return;
      }
      if (outcome.gained !== outcome.base) this.fx.popup(cx, g.oy + c * 0.5, `+${outcome.gained}`, INK.cream, Math.max(18, c * 0.6));
      // The beat is for the long way round, and for a perfect volley; stronger when a perfect one went the long way.
      if (outcome.perfect) {
        this.fx.say(labels.perfect);
        this.beat(longest >= LONG_ROUTE ? 1 : 0.6);
      } else if (longest >= LONG_ROUTE) {
        this.fx.say(labels.longRoute(longest));
        this.beat(0.5 + Math.min(0.4, (longest - LONG_ROUTE) * 0.08));
      } else if (outcome.streak >= 3) {
        this.fx.say(labels.streak(outcome.streak));
        sfx.multi(2);
      }
    });
  }

  protected view(): string {
    // Read off the sprites and the signs drawn, not the state: a mirror stuck half way would show here.
    const cells = new Array<number>(this.grid.cols * this.grid.rows).fill(DEFLECTORS_EMPTY);
    for (const [cell, s] of this.mirrors) cells[cell] = Math.abs(Math.round(s.rotation / (Math.PI / 2))) % 2 === 0 ? DEFLECTORS_SLASH : DEFLECTORS_BACKSLASH;
    return deflectorsViewString(cells, this.shownBeams);
  }

  // ---- every frame

  /** Ask the engine about the waiting volley once a state, not once a frame. */
  private ask(state: DeflectorsState): NonNullable<DeflectorsRenderer["told"]> {
    if (this.told?.state === state) return this.told;
    const volley = state.volley;
    this.told = {
      state,
      outlook: deflectorsOutlook(state),
      // The way back from each exit: what a beam must join to get home.
      back: volley ? volley.beams.map((b) => deflectorsTrace(state.config, state.mirrors, b.exit)) : [],
      best: deflectorsBestPoints(state),
    };
    return this.told;
  }

  /** Ms left on the waiting volley's count, running smoothly between the engine's ticks. */
  private msLeft(state: DeflectorsState, volley: DeflectorsVolley): number {
    const tickMs = state.config.tickMs;
    const into = this.interactive ? Math.min(tickMs, this.time - this.tickAt) : 0;
    return Math.max(0, (volley.fireTick - state.tick) * tickMs - into);
  }

  protected override update(dt: number): void {
    const state = this.state;
    this.routeLayer.clear();
    this.markLayer.clear();
    this.flightLayer.clear();
    const volley = state?.volley ?? null;
    this.shownBeams = volley ? volley.beams : [];
    let used = 0;
    if (state && volley) used = this.drawVolley(state, volley);
    for (let i = used; i < this.signs.length; i++) this.signs[i]!.visible = false;
    this.drawFlights();
    this.setLabel(state);
    this.updateHint(state, dt);
  }

  /** A sign at a port: the sprite at `index` of the pool, wearing `shape` solid or hollow. */
  private placeSign(index: number, sign: number, hollow: boolean, x: number, y: number, scale: number): void {
    let sp = this.signs[index];
    if (!sp) {
      sp = new Sprite();
      sp.anchor.set(0.5);
      this.signLayer.addChild(sp);
      this.signs[index] = sp;
    }
    const s = signOf(sign);
    sp.texture = this.piece(`sign:${s.shape}:${hollow ? 1 : 0}`, Math.round(this.grid.cell * SIGN), s.color, signPaint(s.shape, hollow));
    sp.position.set(x, y);
    sp.scale.set(scale);
    sp.visible = true;
  }

  /**
   * The waiting volley: each beam's route as the mirrors stand, its signs at both ports, and the
   * count as a bar in the strip. Returns how many sign sprites it used.
   */
  private drawVolley(state: DeflectorsState, volley: DeflectorsVolley): number {
    const g = this.grid;
    const c = g.cell;
    const told = this.ask(state);
    const out = told.outlook;
    if (!out) return 0;
    const lines = this.routeLayer;
    const marks = this.markLayer;
    const left = this.msLeft(state, volley);
    const whole = Math.max(1, (volley.fireTick - volley.dealTick) * state.config.tickMs);
    const pop = volley.id === this.appeared.id && !this.reduced ? ease.outCubic(Math.min(1, (this.time - this.appeared.at) / MOTION.move)) : 1;
    const urgent = left <= 3000;
    // A tick for each of the last three seconds of the count.
    const secs = Math.ceil(left / 1000);
    if (this.interactive && urgent && secs > 0 && secs !== this.warned) {
      this.warned = secs;
      sfx.tick(secs === 1);
    }
    // The count: a plain bar that drains, in danger for its last three seconds.
    const barH = Math.max(3, c * 0.07);
    const barY = g.oy - c - c * STRIP * 0.14;
    marks.roundRect(g.ox, barY, g.width, barH, barH / 2).fill({ color: INK.line });
    const frac = Math.max(0, Math.min(1, left / whole));
    if (frac > 0) marks.roundRect(g.ox, barY, Math.max(barH, g.width * frac), barH, barH / 2).fill({ color: urgent ? INK.danger : INK.cream });
    let used = 0;
    out.shots.forEach((shot, i) => {
      const sign = signOf(shot.sign);
      const color = ink(sign.color);
      const pts = this.pathOf(shot.entry, shot);
      const entry = this.portXY(shot.entry);
      const exit = this.portXY(shot.exit);
      if (shot.hit) {
        // Home: a solid line, beaded with the beam's own shape so two routes that cross are told apart.
        strokePath(lines, pts, Math.max(3, c * 0.09), color, 1);
        const lens = lengths(pts);
        const total = lens[lens.length - 1]!;
        for (let d = c * 0.75; d < total - c * 0.5; d += c * 1.25) {
          const p = along(pts, lens, d);
          bead(lines, sign.shape, p.x, p.y, c * 0.12);
        }
        lines.fill({ color });
      } else {
        // Astray: a broken line to the port it would leave by, and a cross there in danger.
        dashPath(lines, pts, c * 0.17, c * 0.15, 0);
        lines.stroke({ width: Math.max(2, c * 0.07), color, cap: "round" });
        const wrong = this.portXY(shot.out);
        const k = c * 0.16;
        marks.moveTo(wrong.x - k, wrong.y - k).lineTo(wrong.x + k, wrong.y + k).moveTo(wrong.x + k, wrong.y - k).lineTo(wrong.x - k, wrong.y + k);
        marks.stroke({ width: Math.max(2.5, c * 0.08), color: INK.danger, cap: "round" });
        // The way back from its exit, in dots: where the two cross at a mirror, a flip joins them.
        const back = told.back[i];
        if (back) {
          const way = this.pathOf(shot.exit, back);
          const lens = lengths(way);
          const total = lens[lens.length - 1]!;
          for (let d = c * 0.5; d < total - c * 0.3; d += c * 0.24) {
            const p = along(way, lens, d);
            lines.circle(p.x, p.y, Math.max(1.4, c * 0.04));
          }
          lines.fill({ color: mix(INK.ground, color, 0.65) });
        }
      }
      // The entry: the beam's sign, solid, and an arrow into the grid.
      const inward = this.portInward(shot.entry);
      const tip = { x: entry.x + inward.x * c * 0.54, y: entry.y + inward.y * c * 0.54 };
      const w = c * 0.11;
      marks.poly([tip.x, tip.y, tip.x - inward.x * w * 1.3 - inward.y * w, tip.y - inward.y * w * 1.3 + inward.x * w, tip.x - inward.x * w * 1.3 + inward.y * w, tip.y - inward.y * w * 1.3 - inward.x * w]);
      marks.fill({ color });
      this.placeSign(used++, shot.sign, false, entry.x, entry.y, pop);
      // Every beam home: the entry is ringed in amber, the thing to tap that goes on.
      if (out.clean) marks.circle(entry.x, entry.y, c * 0.4).stroke({ width: Math.max(2, c * 0.06), color: INK.amber });
      // The exit: the same sign with its middle cut out, filled once the beam is home.
      this.placeSign(used++, shot.sign, !shot.hit, exit.x, exit.y, pop);
    });
    return used;
  }

  /** Beams in flight: the trail from the entry to the head, bright, then fading where it lies. */
  private drawFlights(): void {
    const c = this.grid.cell;
    const l = this.flightLayer;
    for (const f of this.flights) {
      const total = f.lens[f.lens.length - 1]!;
      const head = total * f.run;
      const pts: number[] = [f.pts[0]!, f.pts[1]!];
      for (let i = 1; i < f.lens.length; i++) {
        if (f.lens[i]! <= head) pts.push(f.pts[i * 2]!, f.pts[i * 2 + 1]!);
        else {
          const p = along(f.pts, f.lens, head);
          pts.push(p.x, p.y);
          break;
        }
      }
      // One flat line in the beam's colour, and a cream dot at its head.
      strokePath(l, pts, c * 0.14, f.color, 1 - f.fade);
      if (f.run < 1) {
        const p = along(f.pts, f.lens, head);
        l.circle(p.x, p.y, c * 0.12).fill({ color: INK.cream });
      }
    }
  }

  private setLabel(state: DeflectorsState | null): void {
    if (!this.label) return;
    let text = "";
    let color: number = INK.cream;
    if (state?.volley && !state.finished) {
      const told = this.ask(state);
      const out = told.outlook;
      const labels = this.opts.labels;
      if (out?.perfect) {
        text = labels.outlookPerfect(out.points);
      } else if (out?.clean) text = labels.outlook(out.points, told.best);
      else if (out) {
        text = labels.outlookAstray(out.hits, out.shots.length, told.best);
        color = INK.dim;
      }
    }
    if (text === this.labelText) return;
    this.labelText = text;
    this.label.text = text;
    this.label.style.fill = color;
  }

  /** After a pause, in rounds that allow it, the next mirror to flip pulses: the engine's hint. */
  private updateHint(state: DeflectorsState | null, dt: number): void {
    const volley = state?.volley ?? null;
    if (!state || !volley || !this.interactive || !this.hints || state.finished) {
      this.idle = 0;
      this.hint = null;
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS && !this.hintHot) {
      this.hint = null;
      return;
    }
    if (!this.hint || this.hint.volley !== volley.id || this.hint.flips !== this.flipsSeen) this.hint = { volley: volley.id, flips: this.flipsSeen, cell: deflectorsHint(state)?.cell ?? null };
    const cell = this.hint.cell;
    if (cell === null) return;
    const g = this.grid;
    // A hint is cream, never amber: it is the board's advice, not the player's own mark.
    const pulse = this.reduced ? 0.8 : 0.5 + 0.4 * Math.sin(this.time / 220);
    this.markLayer.circle(g.x(cell), g.y(cell), g.cell * 0.45).stroke({ width: Math.max(2, g.cell * 0.07), color: INK.cream, alpha: pulse });
  }

  // ---- input

  private flip(cell: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (state.mirrors[cell] === DEFLECTORS_EMPTY) {
      sfx.bump();
      return;
    }
    // Following the hint keeps it coming; a flip of the player's own sends it away until the next pause.
    this.hintHot = this.hint?.cell === cell;
    this.idle = 0;
    this.cb.onFlip(cell);
  }

  private fire(): void {
    const volley = this.state?.volley;
    if (!volley || this.state?.finished) return;
    if (volley.id === this.appeared.id && this.time - this.appeared.at < FIRE_GUARD_MS) return;
    this.cb.onFire(volley.id);
  }

  protected override pointerDown(x: number, y: number): void {
    const at = this.grid.at(x, y);
    if (at) {
      this.cursor = at.index;
      this.cursorShown = false;
      this.drawCursor();
      this.flip(at.index);
      return;
    }
    // A tap on a lit entry port fires the volley.
    const port = this.portAt(x, y);
    if (port !== null && this.state?.volley?.beams.some((b) => b.entry === port)) this.fire();
  }

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    if (!this.cursorShown) return;
    // The keyboard's cell is the player's selection: an amber ring.
    const half = g.cell / 2 - 3;
    this.cursorLayer.roundRect(g.x(this.cursor) - half, g.y(this.cursor) - half, half * 2, half * 2, g.cell * 0.16).stroke({ width: Math.max(2, g.cell * 0.07), color: INK.amber });
  }

  /** Arrows or WASD move the cursor, space or enter flips the mirror under it, F fires the volley. */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const g = this.grid;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const steps: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
    const step = steps[k];
    if (step) {
      const col = Math.max(0, Math.min(g.cols - 1, (this.cursor % g.cols) + step[0]));
      const row = Math.max(0, Math.min(g.rows - 1, Math.floor(this.cursor / g.cols) + step[1]));
      this.cursor = row * g.cols + col;
      this.cursorShown = true;
      this.drawCursor();
      return true;
    }
    if (k === " " || k === "Enter") {
      this.cursorShown = true;
      this.drawCursor();
      this.flip(this.cursor);
      return true;
    }
    if (k === "f") {
      this.fire();
      return true;
    }
    return false;
  }
}

/** One bead of a beam's shape centred on (x, y), added to `g` as a path; the caller fills it. */
function bead(g: Graphics, shape: SignShape, x: number, y: number, r: number): void {
  if (shape === "disc") g.circle(x, y, r);
  else if (shape === "square") g.roundRect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, r * 0.3);
  else g.poly([x, y - r * 1.15, x + r * 1.1, y + r * 0.85, x - r * 1.1, y + r * 0.85]);
}

/** The length of a path up to each of its points. */
function lengths(pts: readonly number[]): number[] {
  const lens = [0];
  for (let p = 2; p + 1 < pts.length; p += 2) lens.push(lens[lens.length - 1]! + Math.hypot(pts[p]! - pts[p - 2]!, pts[p + 1]! - pts[p - 1]!));
  return lens;
}

/** The point `d` along a path. */
function along(pts: readonly number[], lens: readonly number[], d: number): { x: number; y: number } {
  const last = lens.length - 1;
  if (d <= 0) return { x: pts[0]!, y: pts[1]! };
  for (let i = 1; i <= last; i++) {
    if (d > lens[i]!) continue;
    const span = lens[i]! - lens[i - 1]!;
    const k = span > 0 ? (d - lens[i - 1]!) / span : 0;
    return { x: pts[(i - 1) * 2]! + (pts[i * 2]! - pts[(i - 1) * 2]!) * k, y: pts[(i - 1) * 2 + 1]! + (pts[i * 2 + 1]! - pts[(i - 1) * 2 + 1]!) * k };
  }
  return { x: pts[last * 2]!, y: pts[last * 2 + 1]! };
}

function strokePath(g: Graphics, pts: readonly number[], width: number, color: number, alpha: number): void {
  if (pts.length < 4 || alpha <= 0) return;
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i + 1 < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.stroke({ width: Math.max(1, width), color, alpha, cap: "round", join: "round" });
}

/** Add a path to `g` as dashes, `phase` along the pattern; the caller strokes it. */
function dashPath(g: Graphics, pts: readonly number[], dash: number, gap: number, phase: number): void {
  const period = dash + gap;
  let at = ((phase % period) + period) % period;
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const x0 = pts[i - 2]!;
    const y0 = pts[i - 1]!;
    const len = Math.hypot(pts[i]! - x0, pts[i + 1]! - y0);
    if (len <= 0) continue;
    const ux = (pts[i]! - x0) / len;
    const uy = (pts[i + 1]! - y0) / len;
    let d = 0;
    while (d < len) {
      if (at < dash) {
        const run = Math.min(dash - at, len - d);
        g.moveTo(x0 + ux * d, y0 + uy * d).lineTo(x0 + ux * (d + run), y0 + uy * (d + run));
        d += run;
        at += run;
      } else {
        const skip = Math.min(period - at, len - d);
        d += skip;
        at += skip;
      }
      if (at >= period) at -= period;
    }
  }
}
