import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  DEFLECTORS_BACKSLASH,
  DEFLECTORS_EMPTY,
  DEFLECTORS_LENS,
  DEFLECTORS_LENS_KINDS,
  DEFLECTORS_SLASH,
  deflectorsHint,
  deflectorsIsMirror,
  deflectorsOutlook,
  deflectorsRecipeLenses,
  deflectorsViewString,
  type DeflectorsEvent,
  type DeflectorsOutcome,
  type DeflectorsState,
  type DeflectorsTarget,
  type DeflectorsTrace,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION, ink } from "../look/tokens.js";
import { FONT_MONO, INK, drawDot, drawHairline, mix } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";
import { MIRROR_COLOR, MIRROR_PAINT, TARGET_COLOR, TARGET_PAINT, lensOf, lensPaint, signOf, signPaint, type SignShape } from "./pieces.js";

export interface DeflectorsCallbacks {
  /** The player put the next piece on `cell`. */
  onPlace(cell: number): void;
  /** The player turned the next piece, a mirror. */
  onTurn(): void;
  /** The player binned the next piece. */
  onBin(): void;
  /** The player fired the emitters. */
  onFire(): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface DeflectorsLabels {
  /** The strip over the grid while a shot would light something: what it scores, how many it lights, and what that multiplies it by. */
  outlook(points: number, lit: number, percent: number): string;
  /** The strip while a shot would light nothing. */
  outlookNone: string;
  /** Called out after a shot that lit more than one target. */
  lit(count: number, percent: number): string;
  longRoute(turns: number): string;
  /** Beside the queue: how many pieces the round has left, the queue's own included. */
  left(count: number): string;
}

export interface DeflectorsRendererOptions {
  /** Pulse where the next piece would make the shot worth more, after a pause. Off for recorded rounds. */
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

const HINT_AFTER_MS = 6000;
/** A route this long is called out. */
const LONG_ROUTE = 8;
const SLASH_ROTATION = 0;
const BACKSLASH_ROTATION = Math.PI / 2;
/** A sign's picture, and a target's, in cells. */
const SIGN = 0.7;
const TARGET = 0.74;
/** How far outside the grid a port's centre sits, in cells. */
const PORT_OUT = 0.5;
/** How far outside the grid a recipe's glasses sit, and how big they are, in cells. */
const RECIPE_OUT = 1.06;
const RECIPE = 0.42;
/** The ring round the grid, in cells: the ports, and the recipes outside them. */
const RING = 1.36;
/** The strip over the grid, in cells: what a shot is worth. */
const STRIP = 0.7;
/** The queue under the grid, in cells, and the size of the next piece and the ones after it. */
const QUEUE = 1.3;
const NEXT = 0.92;
const AFTER = 0.6;

/** Draws the deflector grid and its queue, and turns taps into places, turns and shots. Scores nothing: every number it shows is the engine's. */
export class DeflectorsRenderer extends KitBoard<DeflectorsState> {
  private readonly grid = new Grid(6, 6);
  private readonly bg = new Graphics();
  /** The beams' routes as the grid stands: redrawn every frame from the engine's outlook. */
  private readonly routeLayer = new Graphics();
  private readonly mirrorLayer = new Container();
  /** The emitters' signs, the targets, the recipes' glasses and the queue: a pool of sprites drawn each frame. */
  private readonly portLayer = new Container();
  private readonly ports: Sprite[] = [];
  /** The arrows into the grid, the rings round what lights, the hint. */
  private readonly markLayer = new Graphics();
  private readonly flightLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private label: Text | null = null;
  private labelText = "";
  /** Beside the queue: the pieces left. */
  private leftLabel: Text | null = null;
  private leftText = "";
  /** A sprite for every cell that holds a mirror or a lens. */
  private readonly cells = new Map<number, Sprite>();
  /** What each cell is drawn as. */
  private shownCells: number[] = [];
  /** A shot spent cells: they go once its beams have landed. Until then the grid is drawn as it was. */
  private settling: { spent: readonly number[] } | null = null;
  private readonly flights: Flight[] = [];
  /** The last engine event played: a ticked board is handed every event more than once. */
  private lastSeq = 0;
  /** The targets and the queue drawn this frame: what `view` reports. */
  private shownTargets: readonly DeflectorsTarget[] = [];
  private shownQueue: readonly number[] = [];
  /** The next piece's rotation as drawn, easing towards the way it is set. */
  private headRotation = 0;
  private headCount = -1;
  /** The engine's word on a shot now, kept for as long as the state it was asked of. */
  private told: { state: DeflectorsState; outlook: DeflectorsOutcome; hint: { cell: number; turn: boolean } | null | undefined } | null = null;
  /** The keyboard's cell. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private hints: boolean;
  private idle = 0;

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
   * move as well as the state on show, so a shot fired on the last instant of a tick is still seen
   * to fire when the state on show has already moved on.
   */
  noteEvents(events: readonly DeflectorsEvent[]): void {
    if (!this.isReady || !this.state) return;
    this.play(events);
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(0.5);
    this.leftLabel = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 14, fontWeight: "700", fill: INK.dim }, resolution: 2 });
    this.leftLabel.anchor.set(0, 0.5);
    this.world.addChild(this.bg, this.routeLayer, this.mirrorLayer, this.portLayer, this.markLayer, this.flightLayer, this.cursorLayer, this.label, this.leftLabel);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    const n = this.state?.config.size ?? g.cols;
    g.cols = n;
    g.rows = n;
    // The strip, the grid with its ring of ports and recipes, and the queue under it.
    const margin = 6;
    const tall = n + RING * 2 + STRIP + QUEUE;
    const cell = Math.floor(Math.min((width - margin * 2) / (n + RING * 2), (height - margin * 2) / tall));
    g.cell = Math.max(12, Math.min(84, cell));
    g.ox = Math.floor((width - g.cell * n) / 2);
    g.oy = Math.floor((height - g.cell * tall) / 2 + g.cell * (STRIP + RING));
    const c = g.cell;
    this.bg.clear();
    this.paintGround(this.bg, g.ox - c * RING, g.oy - c * RING - c * STRIP, g.width + c * RING * 2, g.height + c * (RING * 2 + STRIP + QUEUE), false);
    drawHairline(this.bg, g.ox, g.oy, g.width, g.height);
    // A dot in every cell, so an empty one a beam runs straight through is seen, and one at each port.
    for (let i = 0; i < n * n; i++) drawDot(this.bg, g.x(i), g.y(i), c);
    for (let port = 0; port < n * 4; port++) {
      const p = this.portXY(port);
      drawDot(this.bg, p.x, p.y, c);
    }
    // The next piece's slot: a hairline round it.
    const slot = this.queueXY(0);
    const half = (c * (NEXT + 0.2)) / 2;
    this.bg.roundRect(slot.x - half, slot.y - half, half * 2, half * 2, c * 0.16).stroke({ width: 1, color: INK.line });
    this.paintBin(this.binXY(), c);
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(c * 0.33));
      this.label.position.set(g.ox + g.width / 2, g.oy - c * RING - c * STRIP * 0.5);
    }
    if (this.leftLabel) {
      this.leftLabel.style.fontSize = Math.max(11, Math.round(c * 0.28));
      const last = this.queueXY(Math.max(1, (this.state?.config.queueSize ?? 3) - 1));
      this.leftLabel.position.set(last.x + c * (AFTER / 2 + 0.35), last.y);
    }
    this.flights.length = 0;
    this.cursor = Math.min(this.cursor, n * n - 1);
    this.publishGeom(g.ox, g.oy, c);
    // The layout dropped the baked pictures: the pool takes new ones on the next frame.
    for (const sp of this.ports) sp.visible = false;
    if (this.state) this.snapCells(this.state);
    this.drawCursor();
  }

  /** The centre of a port's socket, or of what sits `outCells` out past it. Ports run along the top, the right, the bottom, then the left, as the engine numbers them. */
  private portXY(port: number, outCells = PORT_OUT): { x: number; y: number } {
    const g = this.grid;
    const n = g.cols;
    const i = port % n;
    const out = g.cell * outCells;
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

  /** The centre of the queue's slot `i`: the next piece first, the rest after it to the right. */
  private queueXY(i: number): { x: number; y: number } {
    const g = this.grid;
    const c = g.cell;
    const y = g.oy + g.height + c * RING + (c * QUEUE) / 2;
    const first = g.ox + g.width / 2 - c * 1.2;
    return { x: i === 0 ? first : first + c * (NEXT / 2 + 0.35 + (i - 1) * (AFTER + 0.18) + AFTER / 2), y };
  }

  /** The centre of the bin, left of the next piece's slot. */
  private binXY(): { x: number; y: number } {
    const p = this.queueXY(0);
    return { x: p.x - this.grid.cell * 1.25, y: p.y };
  }

  /** True when a point is on the bin, with room for a thumb. */
  private onBin(x: number, y: number): boolean {
    const p = this.binXY();
    return Math.abs(x - p.x) <= this.grid.cell * 0.55 && Math.abs(y - p.y) <= this.grid.cell * 0.6;
  }

  /** The bin: an open tub under a lid, in hairline ink. A control, not a piece. */
  private paintBin(at: { x: number; y: number }, c: number): void {
    const w = c * 0.42;
    const h = c * 0.5;
    const top = at.y - h / 2 + c * 0.08;
    const stroke = { width: Math.max(1.5, c * 0.04), color: INK.dim };
    this.bg.poly([at.x - w / 2, top, at.x + w / 2, top, at.x + w * 0.38, at.y + h / 2, at.x - w * 0.38, at.y + h / 2], true).stroke(stroke);
    this.bg.moveTo(at.x - w * 0.62, top - c * 0.06).lineTo(at.x + w * 0.62, top - c * 0.06).stroke(stroke);
    this.bg.moveTo(at.x - w * 0.16, top - c * 0.06).lineTo(at.x - w * 0.16, top - c * 0.13).lineTo(at.x + w * 0.16, top - c * 0.13).lineTo(at.x + w * 0.16, top - c * 0.06).stroke(stroke);
    for (const f of [-0.17, 0, 0.17]) this.bg.moveTo(at.x + w * f, top + h * 0.2).lineTo(at.x + w * f * 0.85, at.y + h / 2 - h * 0.14).stroke({ width: Math.max(1, c * 0.03), color: INK.dim });
  }

  /** True when a point is on the next piece in the queue, with room for a thumb. */
  private onQueueHead(x: number, y: number): boolean {
    const p = this.queueXY(0);
    return Math.abs(x - p.x) <= this.grid.cell * 0.7 && Math.abs(y - p.y) <= this.grid.cell * 0.7;
  }

  /** True when a point is in the ring left of the grid, where the emitters sit. */
  private onEmitters(x: number, y: number): boolean {
    const g = this.grid;
    return x < g.ox && x >= g.ox - g.cell * 1.35 && y >= g.oy && y < g.oy + g.height;
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

  /** A cell's picture at `size` cells: a mirror drawn as a `/` (a `\\` is the same sprite a quarter turn on), or a lens. */
  private cellTexture(m: number, size = 1): Texture {
    const c = this.grid.cell;
    if (deflectorsIsMirror(m)) return this.piece(`mirror:${size}`, Math.round(c * size), MIRROR_COLOR, MIRROR_PAINT);
    const lens = lensOf(m - DEFLECTORS_LENS);
    return this.piece(`lens:${lens.shape}:${size}`, Math.round(c * 0.78 * size), lens.color, lensPaint(lens.shape));
  }

  private cellSprite(cell: number, m: number): Sprite {
    const s = new Sprite(this.cellTexture(m));
    s.anchor.set(0.5);
    s.position.set(this.grid.x(cell), this.grid.y(cell));
    s.rotation = m === DEFLECTORS_BACKSLASH ? BACKSLASH_ROTATION : SLASH_ROTATION;
    this.mirrorLayer.addChild(s);
    return s;
  }

  /** Put exactly the state's mirrors and lenses on the grid, each as it is set. */
  private snapCells(state: DeflectorsState): void {
    for (const s of this.cells.values()) s.destroy();
    this.cells.clear();
    state.mirrors.forEach((m, cell) => {
      if (m !== DEFLECTORS_EMPTY) this.cells.set(cell, this.cellSprite(cell, m));
    });
    this.shownCells = state.mirrors.slice();
    this.touchView();
  }

  /** A cell takes what the state holds: what was there goes, and the new piece drops in. */
  private setCell(cell: number, m: number): void {
    const old = this.cells.get(cell);
    if (old) {
      this.cells.delete(cell);
      this.tweens.remove(old, { done: () => old.destroy() });
    }
    this.shownCells[cell] = m;
    if (m !== DEFLECTORS_EMPTY) {
      const s = this.cellSprite(cell, m);
      if (!this.reduced) {
        s.scale.set(0.6);
        this.tweens.move(s, { scale: 1 });
      }
      this.cells.set(cell, s);
    }
    this.touchView();
  }

  /** The beams have landed: the cells the shot spent go, and the grid takes the state as it stands now. */
  private settle(): void {
    const pending = this.settling;
    this.settling = null;
    const state = this.state;
    if (!pending || !state) return;
    for (const cell of pending.spent) {
      const s = this.cells.get(cell);
      if (!s) continue;
      this.cells.delete(cell);
      this.shownCells[cell] = DEFLECTORS_EMPTY;
      this.tweens.remove(s, { done: () => s.destroy() });
    }
    if (pending.spent.length) sfx.whoosh();
    this.sync(state);
  }

  /** Bring every cell to what `state` holds. */
  private sync(state: DeflectorsState): void {
    for (let c = 0; c < state.mirrors.length; c++) if (state.mirrors[c] !== this.shownCells[c]) this.setCell(c, state.mirrors[c]!);
  }

  /** True when `state` is not the round `prev` was a moment later: a new round, a step back in a review, another grid. */
  private isReset(state: DeflectorsState, prev: DeflectorsState | null): boolean {
    if (!prev) return true;
    if (state.tick === 0 && state.eventSeq === 0 && state.logLength === 0) return true;
    if (state.eventSeq < prev.eventSeq || state.tick < prev.tick || state.mirrors.length !== prev.mirrors.length) return true;
    if (state.placed < prev.placed || state.shots < prev.shots) return true;
    // A grid changes by a piece put down, a piece dropped or a shot; any other change is another grid.
    if (state.eventSeq === prev.eventSeq && state.placed === prev.placed) for (let c = 0; c < state.mirrors.length; c++) if (state.mirrors[c] !== prev.mirrors[c]) return true;
    return false;
  }

  protected override keepsPlaying(state: DeflectorsState, prev: DeflectorsState | null): boolean {
    return !this.isReset(state, prev);
  }

  protected onState(state: DeflectorsState, prev: DeflectorsState | null): void {
    if (this.isReset(state, prev)) {
      this.lastSeq = state.eventSeq;
      this.flights.length = 0;
      this.settling = null;
      this.idle = 0;
      this.headCount = -1;
      if (this.grid.cols !== state.config.size) this.layout(this.app.screen.width, this.app.screen.height);
      else this.snapCells(state);
      return;
    }
    if (state.placed !== prev?.placed) {
      sfx.swap();
      this.idle = 0;
    }
    this.play(state.lastMove?.events ?? []);
    // While a shot's beams are in flight, the grid is drawn as it was; the settle puts it right.
    if (!this.settling) this.sync(state);
  }

  private play(events: readonly DeflectorsEvent[]): void {
    for (const e of events) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      if (e.type === "bin") this.playBin();
      else if (e.type === "fire") this.playFire(e.outcome, e.spent);
    }
  }

  /** A piece binned: a dim ring at the bin, and a soft thud. */
  private playBin(): void {
    const p = this.binXY();
    this.fx.ring(p.x, p.y, INK.dim, this.grid.cell * 0.25, this.grid.cell * 0.45, 320, Math.max(1.5, this.grid.cell * 0.05));
    sfx.thud();
  }

  /**
   * A shot: every beam runs its whole path, a note at each turn, and lands where the engine says.
   * Once every beam has landed, the cells it spent go.
   */
  private playFire(outcome: DeflectorsOutcome, spent: readonly number[]): void {
    const g = this.grid;
    const c = g.cell;
    sfx.zap();
    let longest = 0;
    let end = 0;
    outcome.shots.forEach((shot, i) => {
      const color = ink(signOf(i).color);
      const pts = this.pathOf(shot.entry, shot);
      const lens = lengths(pts);
      const total = lens[lens.length - 1]!;
      const flight: Flight = { pts, lens, color, run: 0, fade: 0, sparked: 0 };
      this.flights.push(flight);
      const delay = i * 90;
      const ms = Math.max(220, Math.min(560, 160 + shot.bounces * 42));
      end = Math.max(end, delay + ms);
      const lit = shot.target >= 0;
      if (lit) longest = Math.max(longest, shot.bounces);
      const outX = pts[pts.length - 2]!;
      const outY = pts[pts.length - 1]!;
      this.tweens.run(
        ms,
        (k) => {
          flight.run = k;
          while (flight.sparked < shot.turns.length && k * total >= lens[flight.sparked + 1]! - 0.5) {
            sfx.pop(Math.min(9, flight.sparked));
            flight.sparked++;
          }
        },
        {
          delay,
          ease: ease.linear,
          done: () => {
            if (lit) {
              this.fx.ring(outX, outY, color, c * 0.3, c * 0.55, 420, Math.max(2, c * 0.08));
              this.fx.popup(outX, outY - c * 0.25, `+${shot.points}`, INK.cream, Math.max(15, c * (shot.bounces >= LONG_ROUTE ? 0.5 : 0.4)));
              sfx.good();
            }
            this.tweens.run(lit ? 420 : 260, (k) => (flight.fade = k), {
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
    this.settling = { spent };
    this.tweens.after(end + 40, () => this.settle());
    // Once every beam has landed: what the shot came to when more than one target lit, and the long way round.
    this.tweens.after(end + 60, () => {
      const labels = this.opts.labels;
      if (outcome.lit === 0) {
        sfx.bump();
        return;
      }
      if (outcome.lit > 1) {
        this.fx.popup(g.ox + g.width / 2, g.oy + c * 0.5, `+${outcome.points}`, INK.cream, Math.max(18, c * 0.6));
        this.fx.say(labels.lit(outcome.lit, outcome.litPercent));
        sfx.multi(outcome.lit);
        this.beat(Math.min(1, 0.4 + outcome.lit * 0.2));
      } else if (longest >= LONG_ROUTE) {
        this.fx.say(labels.longRoute(longest));
        this.beat(0.5);
      }
    });
  }

  protected view(): string {
    // Read off the sprites drawn, not the state: a piece stuck half way would show here.
    const cells = new Array<number>(this.grid.cols * this.grid.rows).fill(DEFLECTORS_EMPTY);
    for (const [cell, s] of this.cells) {
      const shown = this.shownCells[cell]!;
      if (!deflectorsIsMirror(shown)) cells[cell] = shown;
      else cells[cell] = Math.abs(Math.round(s.rotation / (Math.PI / 2))) % 2 === 0 ? DEFLECTORS_SLASH : DEFLECTORS_BACKSLASH;
    }
    return deflectorsViewString(cells, this.shownTargets, this.shownQueue);
  }

  // ---- every frame

  /** Ask the engine about a shot now once a state, not once a frame. */
  private ask(state: DeflectorsState): NonNullable<DeflectorsRenderer["told"]> {
    if (this.told?.state === state) return this.told;
    this.told = { state, outlook: deflectorsOutlook(state), hint: undefined };
    return this.told;
  }

  protected override update(dt: number): void {
    const state = this.state;
    this.routeLayer.clear();
    this.markLayer.clear();
    this.flightLayer.clear();
    let used = 0;
    this.shownTargets = state?.targets ?? [];
    this.shownQueue = state?.queue ?? [];
    if (state) {
      if (!this.settling) this.drawRoutes(state);
      used = this.drawPorts(state, used);
      used = this.drawQueue(state, used, dt);
    }
    for (let i = used; i < this.ports.length; i++) this.ports[i]!.visible = false;
    this.drawFlights();
    this.setLabel(state);
    this.updateHint(state, dt);
  }

  /** The sprite at `index` of the pool, shown. */
  private poolSprite(index: number): Sprite {
    let sp = this.ports[index];
    if (!sp) {
      sp = new Sprite();
      sp.anchor.set(0.5);
      this.portLayer.addChild(sp);
      this.ports[index] = sp;
    }
    sp.visible = true;
    sp.alpha = 1;
    sp.rotation = 0;
    sp.scale.set(1);
    return sp;
  }

  /**
   * Each beam's route as the grid stands: a solid line, beaded with the emitter's sign, into the
   * target it would light; a thin broken line to wherever else it would leave. A lens on the way to
   * a target that its recipe does not ask for is ringed in danger: it spoils the beam.
   */
  private drawRoutes(state: DeflectorsState): void {
    const c = this.grid.cell;
    const g = this.grid;
    const out = this.ask(state).outlook;
    const lines = this.routeLayer;
    const spoiled = new Set<number>();
    out.shots.forEach((shot, i) => {
      const sign = signOf(i);
      const color = ink(sign.color);
      const pts = this.pathOf(shot.entry, shot);
      if (shot.target >= 0) {
        strokePath(lines, pts, Math.max(3, c * 0.09), color, 1);
        const lens = lengths(pts);
        const total = lens[lens.length - 1]!;
        for (let d = c * 0.75; d < total - c * 0.5; d += c * 1.25) {
          const p = along(pts, lens, d);
          bead(lines, sign.shape, p.x, p.y, c * 0.12);
        }
        lines.fill({ color });
        return;
      }
      dashPath(lines, pts, c * 0.17, c * 0.15, 0);
      lines.stroke({ width: Math.max(1.5, c * 0.05), color, alpha: 0.75, cap: "round" });
      // At a target's port through the wrong lenses: the lenses it should not have passed.
      const at = state.targets.find((t) => t.port === shot.out);
      if (at) for (const cell of shot.lensCells) if (!(at.recipe & (1 << (state.mirrors[cell]! - DEFLECTORS_LENS)))) spoiled.add(cell);
    });
    for (const cell of spoiled) this.markLayer.circle(g.x(cell), g.y(cell), c * 0.42).stroke({ width: Math.max(2, c * 0.06), color: INK.danger });
  }

  /** The emitters, solid signs with an arrow in, dim while they recharge; the targets with their recipes outside them. */
  private drawPorts(state: DeflectorsState, start: number): number {
    const c = this.grid.cell;
    const out = this.ask(state).outlook;
    const marks = this.markLayer;
    const ready = state.tick >= state.fireTick && !state.finished;
    let used = start;
    state.emitters.forEach((port, i) => {
      const s = signOf(i);
      const color = ink(s.color);
      const p = this.portXY(port);
      const sp = this.poolSprite(used++);
      sp.texture = this.piece(`sign:${s.shape}`, Math.round(c * SIGN), s.color, signPaint(s.shape));
      sp.position.set(p.x, p.y);
      sp.alpha = ready ? 1 : 0.45;
      const inward = this.portInward(port);
      const tip = { x: p.x + inward.x * c * 0.54, y: p.y + inward.y * c * 0.54 };
      const w = c * 0.11;
      marks.poly([tip.x, tip.y, tip.x - inward.x * w * 1.3 - inward.y * w, tip.y - inward.y * w * 1.3 + inward.x * w, tip.x - inward.x * w * 1.3 + inward.y * w, tip.y - inward.y * w * 1.3 - inward.x * w]);
      marks.fill({ color, alpha: ready ? 1 : 0.45 });
      // A shot that lights something: the emitters are ringed in amber, the thing to tap.
      if (ready && out.lit > 0) marks.circle(p.x, p.y, c * 0.4).stroke({ width: Math.max(2, c * 0.06), color: INK.amber });
    });
    const recipes = deflectorsRecipeLenses(state.config) > 0;
    for (const t of state.targets) {
      const p = this.portXY(t.port);
      const sp = this.poolSprite(used++);
      sp.texture = this.piece("target", Math.round(c * TARGET), TARGET_COLOR, TARGET_PAINT);
      sp.position.set(p.x, p.y);
      // Lit by a shot now: ringed in the colour of the beam that lights it.
      const by = out.shots.findIndex((s) => s.target === t.id);
      if (by >= 0) marks.circle(p.x, p.y, c * 0.44).stroke({ width: Math.max(2, c * 0.07), color: ink(signOf(by).color) });
      if (!recipes) continue;
      // The recipe: its glasses outside the target, side by side along the edge, solid once the beam that reaches it passes one of the kind.
      const reach = out.shots.find((s) => s.out === t.port);
      const kinds: number[] = [];
      for (let k = 0; k < DEFLECTORS_LENS_KINDS; k++) if (t.recipe & (1 << k)) kinds.push(k);
      const inward = this.portInward(t.port);
      const side = { x: -inward.y, y: inward.x };
      const at = this.portXY(t.port, RECIPE_OUT);
      kinds.forEach((k, j) => {
        const off = (j - (kinds.length - 1) / 2) * c * RECIPE * 1.12;
        const lens = lensOf(k);
        const glass = this.poolSprite(used++);
        glass.texture = this.piece(`lens:${lens.shape}:small`, Math.round(c * RECIPE), lens.color, lensPaint(lens.shape), 1);
        glass.position.set(at.x + side.x * off, at.y + side.y * off);
        glass.alpha = reach && reach.lenses & (1 << k) ? 1 : 0.5;
      });
      // A plain target asks for no lens: a small dot of its own colour where the glasses would be.
      if (kinds.length === 0) marks.circle(at.x, at.y, c * 0.06).fill({ color: mix(INK.ground, ink(TARGET_COLOR), 0.6) });
    }
    return used;
  }

  /** The queue under the grid: the next piece in its slot, turning when it is turned, and the rest smaller after it. */
  private drawQueue(state: DeflectorsState, start: number, dt: number): number {
    let used = start;
    const head = state.queue[0];
    const count = state.placed + state.binned;
    const want = head === DEFLECTORS_BACKSLASH ? BACKSLASH_ROTATION : SLASH_ROTATION;
    if (count !== this.headCount || this.reduced) this.headRotation = want;
    else this.headRotation += (want - this.headRotation) * Math.min(1, dt / 60);
    this.headCount = count;
    state.queue.forEach((piece, i) => {
      const p = this.queueXY(i);
      const sp = this.poolSprite(used++);
      sp.texture = this.cellTexture(piece, i === 0 ? NEXT : AFTER);
      sp.position.set(p.x, p.y);
      sp.rotation = i === 0 ? this.headRotation : piece === DEFLECTORS_BACKSLASH ? BACKSLASH_ROTATION : SLASH_ROTATION;
      sp.alpha = i === 0 ? 1 : 0.7;
    });
    const left = this.opts.labels.left(state.left + state.queue.length);
    if (this.leftLabel && left !== this.leftText) {
      this.leftText = left;
      this.leftLabel.text = left;
    }
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
    if (state && !state.finished) {
      const out = this.ask(state).outlook;
      const labels = this.opts.labels;
      if (out.lit > 0) text = labels.outlook(out.points, out.lit, out.litPercent);
      else {
        text = labels.outlookNone;
        color = INK.dim;
      }
    }
    if (text === this.labelText) return;
    this.labelText = text;
    this.label.text = text;
    this.label.style.fill = color;
  }

  /** After a pause, in rounds that allow it, the cell where the next piece would make the shot worth more pulses, and the piece too when it wants turning. */
  private updateHint(state: DeflectorsState | null, dt: number): void {
    if (!state || !this.interactive || !this.hints || state.finished || state.queue.length === 0) {
      this.idle = 0;
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    const told = this.ask(state);
    if (told.hint === undefined) told.hint = deflectorsHint(state);
    const hint = told.hint;
    if (!hint) return;
    const g = this.grid;
    // A hint is cream, never amber: it is the board's advice, not the player's own mark.
    const pulse = this.reduced ? 0.8 : 0.5 + 0.4 * Math.sin(this.time / 220);
    this.markLayer.circle(g.x(hint.cell), g.y(hint.cell), g.cell * 0.45).stroke({ width: Math.max(2, g.cell * 0.07), color: INK.cream, alpha: pulse });
    if (hint.turn) {
      const p = this.queueXY(0);
      this.markLayer.circle(p.x, p.y, g.cell * 0.55).stroke({ width: Math.max(2, g.cell * 0.07), color: INK.cream, alpha: pulse });
    }
  }

  // ---- input

  private place(cell: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (state.queue.length === 0 || this.settling) {
      sfx.bump();
      return;
    }
    this.idle = 0;
    this.cb.onPlace(cell);
  }

  private turnHead(): void {
    const state = this.state;
    if (!state || state.finished) return;
    const head = state.queue[0];
    if (head === undefined || !deflectorsIsMirror(head)) {
      sfx.bump();
      return;
    }
    this.idle = 0;
    this.cb.onTurn();
  }

  private bin(): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (state.queue.length === 0 || this.settling) {
      sfx.bump();
      return;
    }
    this.idle = 0;
    this.cb.onBin();
  }

  private fire(): void {
    const state = this.state;
    if (!state || state.finished || this.settling) return;
    if (state.tick < state.fireTick) {
      sfx.bump();
      return;
    }
    this.idle = 0;
    this.cb.onFire();
  }

  protected override pointerDown(x: number, y: number): void {
    const at = this.grid.at(x, y);
    if (at) {
      this.cursor = at.index;
      this.cursorShown = false;
      this.drawCursor();
      this.place(at.index);
      return;
    }
    if (this.onQueueHead(x, y)) this.turnHead();
    else if (this.onBin(x, y)) this.bin();
    else if (this.onEmitters(x, y)) this.fire();
  }

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    if (!this.cursorShown) return;
    const half = g.cell / 2 - 3;
    this.cursorLayer.roundRect(g.x(this.cursor) - half, g.y(this.cursor) - half, half * 2, half * 2, g.cell * 0.16).stroke({ width: Math.max(2, g.cell * 0.07), color: INK.amber });
  }

  /** Arrows or WASD move the cursor, space or enter puts the next piece under it, R turns the next piece, X bins it, F fires. */
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
      this.place(this.cursor);
      return true;
    }
    if (k === "r") {
      this.turnHead();
      return true;
    }
    if (k === "x" || k === "Backspace" || k === "Delete") {
      this.bin();
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
