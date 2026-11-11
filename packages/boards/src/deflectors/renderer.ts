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
import { FONT, INK, drawMark, drawPanel, drawPiece, drawPips, drawWell, kindStyle, mix, shapePath } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";

/**
 * The sign each beam of a volley wears, on its entry port, its exit port and along its route: a
 * kit silhouette first, a color second, so beams read apart without color (CLAUDE.md rule 6). The
 * third is the kit's triangle in another color, because the triangle's own red is what a beam gone
 * astray is marked in.
 */
export const DEFLECTORS_SIGNS: ReadonlyArray<{ readonly kind: number; readonly color: number; readonly id: string }> = [
  { kind: 0, color: 0xf5d021, id: "gold" },
  { kind: 1, color: 0x58c4f6, id: "ice" },
  { kind: 2, color: 0xb48cff, id: "violet" },
];

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
  showMarks: boolean;
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
/** How far outside the grid a port's centre sits, in cells. */
const PORT_OUT = 0.5;
/** The strip over the grid, in cells. */
const STRIP = 0.8;

/** Draws the deflector grid and turns taps into flips and fires. Scores nothing: every number it shows is the engine's. */
export class DeflectorsRenderer extends KitBoard<DeflectorsState> {
  private readonly grid = new Grid(6, 6);
  private readonly bg = new Graphics();
  /** The waiting beams' routes: redrawn every frame from the engine's trace of the mirrors as they stand. */
  private readonly routeLayer = new Graphics();
  private readonly mirrorLayer = new Container();
  /** Port signs, counts, the beads on a route that is home, the hint. */
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
  private drawn: readonly DeflectorsBeam[] = [];
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
    super(host, "deflectors", cb.onFrame, opts.showMarks);
    this.hints = opts.hints;
  }

  override setHints(on: boolean): void {
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
    this.label = new Text({ text: "", style: { fontFamily: FONT, fontSize: 16, fontWeight: "700", fill: INK.text, letterSpacing: 0.5 } });
    this.label.anchor.set(0.5);
    this.world.addChild(this.bg, this.routeLayer, this.mirrorLayer, this.markLayer, this.flightLayer, this.cursorLayer, this.label);
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
    this.bg.clear();
    drawPanel(this.bg, g.ox - c, g.oy - c - c * STRIP, g.width + c * 2, g.height + c * 2 + c * STRIP, Math.max(10, c * 0.3));
    this.bg.roundRect(g.ox - 3, g.oy - 3, g.width + 6, g.height + 6, c * 0.18).fill({ color: INK.bg });
    this.bg.roundRect(g.ox - 3, g.oy - 3, g.width + 6, g.height + 6, c * 0.18).stroke({ width: 1.5, color: INK.edge, alpha: 0.7 });
    for (let i = 0; i < n * n; i++) drawWell(this.bg, g.x(i) - c / 2, g.y(i) - c / 2, c);
    // A socket at each end of every row and column: where a beam can come in or leave.
    for (let port = 0; port < n * 4; port++) {
      const p = this.portXY(port);
      const s = c * 0.5;
      this.bg.roundRect(p.x - s / 2, p.y - s / 2, s, s, s * 0.3).fill({ color: INK.well });
      this.bg.circle(p.x, p.y, Math.max(1.5, c * 0.05)).fill({ color: INK.edge, alpha: 0.8 });
    }
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(c * 0.33));
      this.label.position.set(g.ox + g.width / 2, g.oy - c - c * STRIP * 0.45);
    }
    this.flights.length = 0;
    this.cursor = Math.min(this.cursor, n * n - 1);
    this.publishGeom(g.ox, g.oy, c);
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

  /**
   * A mirror's texture. A `\\` is a sprite a quarter turn on from a `/`, so the code-drawn bar is one
   * texture for both. The sheet paints each on its own mount, lit from the upper left: the `\\` frame
   * is baked a quarter turn back, and the sprite's own turn stands it upright again.
   */
  private mirrorTexture(way: number = DEFLECTORS_SLASH): Texture {
    const cell = this.grid.cell;
    const back = way !== DEFLECTORS_SLASH && this.hasSprite("mirror-backslash");
    return this.bake(back ? "mirror-back" : "mirror", cell, (g) => {
      if (back && this.sprite(g, "mirror-backslash", 0, 0, cell * 0.84, 1, cell * 0.84, -1)) return;
      if (this.sprite(g, "mirror-slash", 0, 0, cell * 0.84)) return;
      // A `/` bar: a dark mount, a pale glass face, a bright edge, a pivot in the middle.
      const r = cell * 0.31;
      const glass = 0xdfe9f5;
      const bar = (width: number, color: number, alpha = 1, dx = 0, dy = 0): void => {
        g.moveTo(-r + dx, r + dy).lineTo(r + dx, -r + dy).stroke({ width, color, alpha, cap: "round" });
      };
      bar(cell * 0.2, INK.black, 0.4, 0, cell * 0.04);
      bar(cell * 0.2, mix(glass, INK.black, 0.62));
      bar(cell * 0.12, glass);
      bar(cell * 0.035, INK.white, 0.9, -cell * 0.025, -cell * 0.025);
      g.circle(0, 0, cell * 0.07).fill({ color: INK.brass });
      g.circle(0, 0, cell * 0.07).stroke({ width: Math.max(1, cell * 0.02), color: mix(INK.brass, INK.black, 0.5) });
    });
  }

  /** Put exactly the state's mirrors on the grid, each as it is set, with nothing in motion. */
  private snapMirrors(state: DeflectorsState): void {
    for (const s of this.mirrors.values()) s.destroy();
    this.mirrors.clear();
    state.mirrors.forEach((m, cell) => {
      if (m === DEFLECTORS_EMPTY) return;
      const s = new Sprite(this.mirrorTexture(m));
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
    // It turns as it is, then takes the art of the way it now stands.
    this.tweens.to(s, { rotation: way === DEFLECTORS_SLASH ? SLASH_ROTATION : BACKSLASH_ROTATION }, 150, {
      ease: ease.outBack,
      done: () => {
        if (!s.destroyed) s.texture = this.mirrorTexture(way);
      },
    });
    this.tweens.run(150, (k) => s.scale.set(1 + 0.18 * Math.sin(k * Math.PI)), { ease: ease.linear, done: () => s.scale.set(1) });
    this.fx.ring(s.x, s.y, INK.white, this.grid.cell * 0.2, this.grid.cell * 0.52, 240, 2);
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

  /** A volley is announced: its signs pop in at their ports. */
  private playDeal(volley: DeflectorsVolley): void {
    const c = this.grid.cell;
    this.appeared = { id: volley.id, at: this.time };
    this.idle = 0;
    this.hintHot = false;
    this.warned = 0;
    sfx.power(0.15 + 0.25 * volley.beams.length);
    for (const beam of volley.beams) {
      const color = signOf(beam.sign).color;
      const a = this.portXY(beam.entry);
      const b = this.portXY(beam.exit);
      this.fx.ring(a.x, a.y, color, c * 0.2, c * 0.75, 420, 3);
      this.fx.ring(b.x, b.y, color, c * 0.6, c * 0.25, 420, 2);
    }
  }

  /** A volley fires: every beam runs its whole path, a spark at each turn, and lands where the engine says. */
  private playFire(outcome: DeflectorsOutcome): void {
    const g = this.grid;
    const c = g.cell;
    sfx.zap();
    let longest = 0;
    let end = 0;
    outcome.shots.forEach((shot, i) => {
      const color = signOf(shot.sign).color;
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
          // The head has passed a turn: a spark there, and a note one step up the ladder.
          while (flight.sparked < shot.turns.length && k * total >= lens[flight.sparked + 1]! - 0.5) {
            const x = pts[(flight.sparked + 1) * 2]!;
            const y = pts[(flight.sparked + 1) * 2 + 1]!;
            this.fx.burst(x, y, color, 5, 0.18, Math.max(2, c * 0.06));
            this.fx.ring(x, y, INK.white, c * 0.12, c * 0.42, 260, 2);
            sfx.pop(Math.min(9, flight.sparked));
            flight.sparked++;
          }
        },
        {
          delay,
          ease: ease.linear,
          done: () => {
            if (shot.hit) {
              this.fx.ring(outX, outY, color, c * 0.25, c * 0.85, 420, 4);
              this.fx.burst(outX, outY, color, 10, 0.22, Math.max(2.5, c * 0.07));
              this.fx.popup(outX, outY - c * 0.25, `+${shot.points}`, INK.gold, Math.max(15, c * (shot.bounces >= LONG_ROUTE ? 0.5 : 0.4)));
              sfx.good();
            } else {
              this.fx.burst(outX, outY, INK.danger, 12, 0.26, Math.max(2.5, c * 0.08));
              this.fx.ring(outX, outY, INK.danger, c * 0.2, c * 0.7, 360, 4);
              if (shot.points < 0) this.fx.popup(outX, outY - c * 0.25, `${shot.points}`, INK.danger, Math.max(15, c * 0.4));
              this.fx.shake(6, 240);
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
        this.fx.flash(INK.danger, 0.16, 280);
        return;
      }
      if (outcome.gained !== outcome.base) this.fx.popup(cx, g.oy + c * 0.5, `+${outcome.gained}`, INK.gold, Math.max(18, c * 0.6));
      if (outcome.perfect) {
        this.fx.say(labels.perfect, INK.gold);
        this.fx.flash(INK.gold, 0.14, 260);
        this.fx.shake(8, 260);
        sfx.streak(outcome.streak);
      } else if (longest >= LONG_ROUTE) {
        this.fx.say(labels.longRoute(longest), INK.gold);
        this.fx.shake(6, 220);
        sfx.multi(3);
      } else if (outcome.streak >= 3) {
        this.fx.say(labels.streak(outcome.streak), 0x7fd7ff);
        sfx.multi(2);
      }
    });
  }

  protected view(): string {
    // Read off the sprites and the signs drawn, not the state: a mirror stuck half way would show here.
    const cells = new Array<number>(this.grid.cols * this.grid.rows).fill(DEFLECTORS_EMPTY);
    for (const [cell, s] of this.mirrors) cells[cell] = Math.abs(Math.round(s.rotation / (Math.PI / 2))) % 2 === 0 ? DEFLECTORS_SLASH : DEFLECTORS_BACKSLASH;
    return deflectorsViewString(cells, this.drawn);
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
    this.drawn = volley ? volley.beams : [];
    if (state && volley) this.drawVolley(state, volley);
    this.drawFlights();
    this.setLabel(state);
    this.updateHint(state, dt);
  }

  /** The waiting volley: each beam's route as the mirrors stand, its signs at both ports, and the count. */
  private drawVolley(state: DeflectorsState, volley: DeflectorsVolley): void {
    const g = this.grid;
    const c = g.cell;
    const told = this.ask(state);
    const out = told.outlook;
    if (!out) return;
    const lines = this.routeLayer;
    const marks = this.markLayer;
    const left = this.msLeft(state, volley);
    const whole = Math.max(1, (volley.fireTick - volley.dealTick) * state.config.tickMs);
    const pop = volley.id === this.appeared.id ? ease.outBack(Math.min(1, (this.time - this.appeared.at) / 260)) : 1;
    const urgent = left <= 3000;
    const r = c * 0.27 * pop;
    // A tick for each of the last three seconds of the count.
    const secs = Math.ceil(left / 1000);
    if (this.interactive && urgent && secs > 0 && secs !== this.warned) {
      this.warned = secs;
      sfx.tick(secs === 1);
    }
    out.shots.forEach((shot, i) => {
      const sign = signOf(shot.sign);
      const pts = this.pathOf(shot.entry, shot);
      const entry = this.portXY(shot.entry);
      const exit = this.portXY(shot.exit);
      if (shot.hit) {
        // Home: a lit line, and beads of the beam's own shape running down it.
        strokePath(lines, pts, c * 0.24, sign.color, 0.2);
        strokePath(lines, pts, c * 0.1, sign.color, 0.95);
        strokePath(lines, pts, c * 0.035, INK.white, 0.85);
        const lens = lengths(pts);
        const total = lens[lens.length - 1]!;
        const gap = c * 1.15;
        const shape = kindStyle(sign.kind).shape;
        for (let d = ((this.time * c) / 620) % gap; d < total; d += gap) {
          const p = along(pts, lens, d);
          shapePath(marks, shape, p.x, p.y, c * 0.085);
        }
        marks.fill({ color: INK.white, alpha: 0.95 });
      } else {
        // Astray: a broken line to the port it would leave by, and a cross there.
        dashPath(lines, pts, c * 0.17, c * 0.13, (this.time * c) / 900);
        lines.stroke({ width: Math.max(2, c * 0.07), color: mix(sign.color, INK.dim, 0.25), alpha: 0.9, cap: "round" });
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
            lines.circle(p.x, p.y, Math.max(1.2, c * 0.036));
          }
          lines.fill({ color: sign.color, alpha: 0.6 });
        }
      }
      // The entry: the beam's sign, an arrow into the grid, and the count as a ring that drains.
      const inward = this.portInward(shot.entry);
      const tip = { x: entry.x + inward.x * c * 0.52, y: entry.y + inward.y * c * 0.52 };
      const w = c * 0.12;
      marks.poly([tip.x, tip.y, tip.x - inward.x * w * 1.3 - inward.y * w, tip.y - inward.y * w * 1.3 + inward.x * w, tip.x - inward.x * w * 1.3 + inward.y * w, tip.y - inward.y * w * 1.3 - inward.x * w]);
      marks.fill({ color: sign.color });
      const ringColor = urgent ? INK.danger : sign.color;
      const ringR = c * 0.4 * pop;
      marks.circle(entry.x, entry.y, ringR).stroke({ width: Math.max(2, c * 0.07), color: INK.line, alpha: 0.9 });
      const frac = Math.max(0, Math.min(1, left / whole));
      if (frac > 0) {
        const pulse = urgent ? 0.65 + 0.35 * Math.sin(this.time / 90) : 1;
        // An arc joins on from wherever the pen was, so the pen is put at its start first.
        marks.moveTo(entry.x, entry.y - ringR).arc(entry.x, entry.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac).stroke({ width: Math.max(2, c * 0.07), color: ringColor, alpha: pulse, cap: "round" });
      }
      // Ready to fire: the entry breathes.
      const ready = out.clean ? 1 + 0.07 * Math.sin(this.time / 170) : 1;
      // A sign on its post is taller than the bare shape; `r` stays the size its ring is drawn round.
      const art = c * 0.6;
      if (this.sprite(marks, `sign-${sign.id}`, entry.x, entry.y, art * pop * ready, 1, art)) {
        if (this.showMarks) drawMark(marks, sign.kind, entry.x, entry.y - art * 0.06, r);
      } else drawPiece(marks, sign.kind, entry.x, entry.y, r * ready, { color: sign.color, marks: this.showMarks });
      // The exit: the same sign as an outline, filled once the beam is home.
      if (shot.hit) {
        marks.circle(exit.x, exit.y, c * (0.4 + 0.03 * Math.sin(this.time / 170))).stroke({ width: Math.max(2, c * 0.05), color: sign.color, alpha: 0.9 });
      }
      // Home, the outline is the sign itself; astray, it is the hollow target.
      if (this.sprite(marks, `${shot.hit ? "sign" : "target"}-${sign.id}`, exit.x, exit.y, art * pop, 1, art)) {
        if (this.showMarks) drawMark(marks, sign.kind, exit.x, exit.y - art * 0.06, r);
      } else {
        if (shot.hit) drawPiece(marks, sign.kind, exit.x, exit.y, r, { color: sign.color, alpha: 0.55 });
        drawPiece(marks, sign.kind, exit.x, exit.y, r, { color: sign.color, hollow: true });
        if (this.showMarks) drawPips(marks, sign.kind + 1, exit.x, exit.y, r * 0.9, shot.hit ? INK.black : sign.color, 0.9);
      }
    });
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
      const a = 1 - f.fade;
      strokePath(l, pts, c * 0.34, f.color, 0.28 * a);
      strokePath(l, pts, c * 0.15, f.color, 0.95 * a);
      strokePath(l, pts, c * 0.06, INK.white, a);
      if (f.run < 1) {
        const p = along(f.pts, f.lens, head);
        l.circle(p.x, p.y, c * 0.13).fill({ color: INK.white });
        l.circle(p.x, p.y, c * 0.24).fill({ color: f.color, alpha: 0.35 });
      }
    }
  }

  private setLabel(state: DeflectorsState | null): void {
    if (!this.label) return;
    let text = "";
    let color: number = INK.text;
    if (state?.volley && !state.finished) {
      const told = this.ask(state);
      const out = told.outlook;
      const labels = this.opts.labels;
      if (out?.perfect) {
        text = labels.outlookPerfect(out.points);
        color = INK.gold;
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
    const pulse = 0.5 + 0.4 * Math.sin(this.time / 220);
    this.markLayer.circle(g.x(cell), g.y(cell), g.cell * (0.44 + 0.03 * Math.sin(this.time / 220))).stroke({ width: Math.max(2.5, g.cell * 0.07), color: INK.gold, alpha: pulse });
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
    const half = g.cell / 2 - 2;
    this.cursorLayer.roundRect(g.x(this.cursor) - half, g.y(this.cursor) - half, half * 2, half * 2, g.cell * 0.16).stroke({ width: 3, color: INK.white, alpha: 0.9 });
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

function signOf(sign: number): { readonly kind: number; readonly color: number; readonly id: string } {
  return DEFLECTORS_SIGNS[sign % DEFLECTORS_SIGNS.length]!;
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
