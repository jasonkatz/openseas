import { loadPuzzleSprites, spritesReady } from "../sprites/atlas.js";
import { soundsFor } from "../audio.js";
import { Application, CanvasSource, Container, FillGradient, Graphics, Sprite, Text, Texture, TilingSprite, type FederatedPointerEvent } from "pixi.js";
import {
  BATTLE_PERMILLE,
  battleArcCells,
  battleCellAt,
  battlePlanIllegalReason,
  previewBattleCourse,
  type BattleEvent,
  type BattleOutcome,
  type BattlePlan,
  type BattleSegment,
  type BattleState,
  type MoveToken,
  type Pose,
  type ShipIndex,
  type Side,
} from "@openseas/engine";
import { paintBall, paintTurret, paintCaustic, paintWell, paintSpace, paintShip } from "./art.js";
import { boardSurface } from "../surface.js";
import { HULL, hullFrame, hullGradient } from "../hull.js";

export interface BattleCallbacks {
  /** The captain flew the plot: by the button, the key, or the host's turn clock. */
  onCommit(plan: BattlePlan): void;
  /** The plot changed, for a host that mirrors it (the smoke test reads it). */
  onPlanChange(plan: BattlePlan): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** Events of a resolved turn as they are shown, segment by segment, for sound. */
  onEvents(events: readonly BattleEvent[]): void;
  onNudge(): void;
}

export interface BattleRendererOptions {
  showMarks: boolean;
  showArcs: boolean;
  labels: {
    you: string;
    raider: string;
    hull: string;
    loaded: string;
    turn(turn: number, max: number): string;
    slot(n: number): string;
    hold: string;
    token(t: MoveToken): string;
    port: string;
    starboard: string;
    grapple: string;
    fly: string;
    clear: string;
    hit: string;
    hitTaken: string;
    miss: string;
    asteroids: string;
    rammed: string;
    blown: string;
    spun: string;
    outcome(o: BattleOutcome): string;
    grappleReady: string;
  };
}

interface ShipView {
  x: number;
  y: number;
  rot: number;
  damage: number;
  /** ms of hit flash left. */
  flash: number;
  /** True while a tween carries it, for the wake. */
  moving: boolean;
}

interface Tween {
  ship: ShipIndex;
  from: { x: number; y: number; rot: number };
  to: { x: number; y: number; rot: number };
}

interface Shot {
  from: { x: number; y: number };
  to: { x: number; y: number };
  hit: boolean;
  ship: ShipIndex;
  ball: Sprite;
}

/** One beat of a resolved turn's playback. */
interface Step {
  ms: number;
  tweens: Tween[];
  shots: Shot[];
  events: BattleEvent[];
  /** Run when the step starts: damage, popups, callbacks. */
  begin(): void;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  color: number;
  alpha: number;
  life: number;
  max: number;
  /** Drawn as an ellipse flattened to the board. */
  flat?: boolean;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  max: number;
  r: number;
  color: number;
}

interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLORS = {
  arc: 0xf5d58a,
  arcEnemy: 0xf0604d,
  good: 0x6fdc8c,
  warn: 0xf5d58a,
  danger: 0xf0604d,
  brass: 0xd4a548,
  brassLight: 0xf5d58a,
  brassDeep: 0x8f6a22,
  ink: 0x070e1a,
  inkGlass: 0x121a2b,
  inkDeep: 0x0b1526,
  text: 0xefe3c6,
  muted: 0x9aa7bd,
  flash: 0xfff3c4,
  smoke: 0x8a93a3,
  // A miss puffs pale dust, a hit throws hot metal, a ship's wake is its thrusters' cyan.
  splash: 0xd8f0ff,
  foam: 0x8fe9ff,
  sparks: 0xffb066,
  current: 0xaae4ff,
  well: 0xd6f4f0,
};
// A turn's playback runs on the same clock the next plot is made against, so its beats are brisk.
const MOVE_MS = 360;
const PUSH_MS = 260;
const SPIN_MS = 220;
const SHOT_MS = 320;
const END_MS = 900;
/** After a turn resolves, a tap on fly with nothing plotted is a double tap, not a turn of holds. */
const FLY_GUARD_MS = 700;
const FONT = "Atkinson Hyperlegible, sans-serif";
const DISPLAY = "Fraunces, Georgia, serif";
const SHIP_SCALE = 2.1;

/** What the board shows, for the smoke test: both ships, the turn and the outcome. */
export function battleViewString(state: BattleState): string {
  const ships = state.ships.map((s) => `${s.x}.${s.y}.${s.heading}.${s.damage}.${s.loaded}`).join("|");
  return `${state.turn}:${ships}:${state.outcome ?? "-"}`;
}

function trimTrailingHolds(segments: readonly BattleSegment[]): BattleSegment[] {
  const segs = segments.slice();
  while (segs.length && segs[segs.length - 1]!.move === null && !segs[segs.length - 1]!.port && !segs[segs.length - 1]!.starboard) segs.pop();
  return segs;
}

function linear(vertical: boolean, stops: number[]): FillGradient {
  const g = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 }, textureSpace: "local" });
  stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
  return g;
}

function texture(canvas: HTMLCanvasElement, resolution: number): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution }) });
}

export class BattleRenderer {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly frameG = new Graphics();
  private readonly spaceLayer = new Container();
  private spaceSprite: Sprite | null = null;
  private caustic: TilingSprite | null = null;
  private readonly wellLayer = new Container();
  private readonly arcG = new Graphics();
  private readonly ghostLayer = new Container();
  private readonly ghostG = new Graphics();
  private readonly wakeG = new Graphics();
  private readonly shipLayer = new Container();
  private readonly hullG = new Graphics();
  private readonly ballLayer = new Container();
  private readonly fxG = new Graphics();
  private readonly fxLayer = new Container();
  private readonly hudG = new Graphics();
  private readonly hudTexts = new Container();
  private readonly stripG = new Graphics();
  private readonly stripIcons = new Container();
  private readonly stripTexts = new Container();
  private readonly brassFill = linear(true, [0xe9bd63, COLORS.brass, COLORS.brassDeep]);
  private readonly inkFill = linear(true, [0x1a2438, COLORS.inkDeep]);
  private readonly hullFill = hullGradient(true, [HULL.plateTop, HULL.plateMid, HULL.plateBottom]);
  private readonly textures = new Map<string, Texture>();
  private shipSprites: [Sprite, Sprite] | null = null;
  private ghostSprites: Sprite[] = [];
  private ghostTexts: Text[] = [];
  private state: BattleState | null = null;
  private ships: [ShipView, ShipView] = [
    { x: 0, y: 0, rot: 0, damage: 0, flash: 0, moving: false },
    { x: 0, y: 0, rot: Math.PI, damage: 0, flash: 0, moving: false },
  ];
  private shownTurn = -1;
  private shownOutcome: BattleOutcome | null = null;
  private queue: Step[] = [];
  private step: Step | null = null;
  private stepT = 0;
  private popups: Popup[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private segments: BattleSegment[] = [];
  private grapple = false;
  /** The slot the next token goes in; -1 when every slot holds a move, so nothing is overwritten unasked. */
  private selected = 0;
  /** The slot the gun keys arm: the one last plotted or picked. */
  private focus = 0;
  private flyGuard = 0;
  private buttons: Button[] = [];
  private pressed: { id: string; t: number } | null = null;
  private interactive = false;
  private framePending = false;
  private destroyed = false;
  private shake = 0;
  private endFlash = 0;
  private time = 0;
  private turnLeftMs: number | null = null;
  private turnMs = 1;
  /** Geometry. */
  private cell = 24;
  private gx = 0;
  private gy = 0;
  private cols = 1;
  private rows = 1;
  private pad = 10;
  private vertical = false;
  private strip = { x: 0, y: 0, w: 0, h: 0 };
  private hud = { x: 0, y: 0, w: 0, h: 0 };
  private readonly reduced = typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  private stripDirty = true;
  private bakedKey = "";

  constructor(
    private readonly host: HTMLElement,
    private readonly cb: BattleCallbacks,
    private readonly opts: BattleRendererOptions,
  ) {}

  /** This puzzle's picked samples play while the board is open (ADR 0041). */
  private readonly releaseSounds = soundsFor("battle");

  async init(): Promise<void> {
    await loadPuzzleSprites("battle");
    if (this.destroyed) return;
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      ...boardSurface(),
      autoDensity: true,
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.app.canvas.dataset.spriteAtlas = spritesReady("battle") ? "battle" : "fallback";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "battle-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    this.ghostLayer.addChild(this.ghostG);
    this.world.addChild(this.frameG, this.spaceLayer, this.wellLayer, this.arcG, this.ghostLayer, this.wakeG, this.shipLayer, this.hullG, this.ballLayer, this.fxG, this.fxLayer);
    this.app.stage.addChild(this.world, this.hudG, this.hudTexts, this.stripG, this.stripIcons, this.stripTexts);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((ticker) => this.tick(Math.min(50, ticker.deltaMS)));
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    this.releaseSounds();
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
      for (const t of this.textures.values()) t.destroy(true);
      this.brassFill.destroy();
      this.inkFill.destroy();
      this.hullFill.destroy();
    }
  }

  setInteractive(on: boolean): void {
    if (this.interactive === on) return;
    this.interactive = on;
    this.stripDirty = true;
  }

  setShowMarks(on: boolean): void {
    if (this.opts.showMarks === on) return;
    this.opts.showMarks = on;
    if (this.app.renderer) {
      this.bakedKey = "";
      this.bake();
      this.drawShips();
      this.drawPreview();
    }
  }

  setShowArcs(on: boolean): void {
    if (this.opts.showArcs === on) return;
    this.opts.showArcs = on;
    this.drawPreview();
  }

  /** The host's turn clock: ms left to plot, and the turn's length. Null hides the bar. */
  setTurnClock(leftMs: number | null, turnMs: number): void {
    this.turnLeftMs = leftMs;
    this.turnMs = Math.max(1, turnMs);
  }

  /** The plot as it stands, trimmed of trailing holds. */
  plan(): BattlePlan {
    return { segments: trimTrailingHolds(this.segments), grapple: this.grapple };
  }

  /**
   * Fly the plot now, as the turn clock does. A plot the ship can no longer pay for flies what it
   * can: a move without its token becomes a hold, a broadside without a load stays quiet.
   * `manual` is the captain's own tap or key, which is ignored on an empty plot just after a turn.
   */
  commit(manual = false): void {
    const s = this.state;
    if (!s || s.finished) return;
    let plan = this.plan();
    if (manual && this.flyGuard > 0 && plan.segments.length === 0 && !plan.grapple) return;
    if (battlePlanIllegalReason(s, plan) !== null) plan = { segments: trimTrailingHolds(this.affordable(s, plan.segments)), grapple: this.grapple };
    if (battlePlanIllegalReason(s, plan) !== null) plan = { segments: [], grapple: this.grapple };
    this.cb.onCommit(plan);
  }

  /** The segments with every move and shot the ship cannot pay for taken out, earliest kept first. */
  private affordable(s: BattleState, segments: readonly BattleSegment[]): BattleSegment[] {
    const tokens = { ...s.ships[0].tokens };
    let loaded = s.ships[0].loaded;
    return segments.map((seg) => {
      let move = seg.move;
      if (move !== null) {
        if (tokens[move] > 0) tokens[move] -= 1;
        else move = null;
      }
      const port = seg.port && loaded > 0;
      if (port) loaded -= 1;
      const starboard = seg.starboard && loaded > 0;
      if (starboard) loaded -= 1;
      return { move, port, starboard };
    });
  }

  setState(state: BattleState): void {
    if (!this.app.renderer) return;
    const prev = this.state;
    const reset = !prev || state.turn < this.shownTurn || state.board !== prev.board || (state.turn === this.shownTurn && state.outcome === null && prev.finished);
    const boardChanged = !prev || prev.board.width !== state.board.width || prev.board.height !== state.board.height || prev.boardIndex !== state.boardIndex || prev.board !== state.board;
    this.state = state;
    this.framePending = true;
    if (boardChanged) this.layout();
    if (reset) {
      this.queue = [];
      this.clearStep();
      this.popups.forEach((p) => p.t.destroy());
      this.popups = [];
      this.particles = [];
      this.rings = [];
      this.snap(state);
      this.shownTurn = state.turn;
      this.shownOutcome = state.outcome;
      this.resetPlan(state);
    } else if (state.turn > this.shownTurn && state.lastTurn) {
      this.enqueueTurn(state, state.lastTurn.events);
      this.shownTurn = state.turn;
      this.shownOutcome = state.outcome;
      this.resetPlan(state);
      this.flyGuard = FLY_GUARD_MS;
    } else if (state.finished && this.shownOutcome !== state.outcome && state.lastTurn) {
      // Ended without a turn: a disengage, or the ship's hull gave out.
      this.enqueueTurn(state, state.lastTurn.events);
      this.shownOutcome = state.outcome;
    } else {
      // Supply arrived, or the same turn re-rendered: keep the plot, less whatever it can no longer pay for.
      if (this.queue.length === 0 && !this.step) this.snap(state);
      if (!state.finished && this.segments.length === state.config.segments) {
        const kept = this.affordable(state, this.segments);
        if (kept.some((seg, i) => seg.move !== this.segments[i]!.move || seg.port !== this.segments[i]!.port || seg.starboard !== this.segments[i]!.starboard)) {
          this.segments = kept;
          this.selected = this.firstOpen();
          this.cb.onPlanChange(this.plan());
        }
      }
      this.stripDirty = true;
    }
    this.drawPreview();
    this.drawHud();
    this.app.canvas.setAttribute("data-view", battleViewString(state));
  }

  private clearStep(): void {
    if (this.step) for (const sh of this.step.shots) sh.ball.destroy();
    this.step = null;
  }

  private resetPlan(state: BattleState): void {
    this.segments = Array.from({ length: state.config.segments }, () => ({ move: null, port: false, starboard: false }));
    this.grapple = false;
    this.selected = 0;
    this.focus = 0;
    this.stripDirty = true;
    this.drawPreview();
    this.cb.onPlanChange(this.plan());
  }

  /** Take back the last plotted move (its guns with it) and select that slot again. */
  private undo(): void {
    const i = this.lastPlotted();
    const seg = this.segments[i];
    if (!seg || (seg.move === null && !seg.port && !seg.starboard)) return;
    this.setSegment(i, { move: null, port: false, starboard: false });
    this.selected = i;
    this.focus = i;
    this.stripDirty = true;
    this.cb.onNudge();
  }

  private snap(state: BattleState): void {
    for (const i of [0, 1] as const) {
      const s = state.ships[i];
      this.ships[i] = { x: this.cx(s.x), y: this.cy(s.y), rot: (s.heading * Math.PI) / 2, damage: s.damage, flash: 0, moving: false };
    }
    this.drawShips();
  }

  // ---- playback of a resolved turn

  private enqueueTurn(state: BattleState, events: readonly BattleEvent[]): void {
    const bySeg = new Map<number, BattleEvent[]>();
    for (const e of events) {
      const list = bySeg.get(e.seg) ?? [];
      list.push(e);
      bySeg.set(e.seg, list);
    }
    const segs = [...bySeg.keys()].sort((a, b) => a - b);
    for (const seg of segs) {
      const list = bySeg.get(seg)!;
      const moves = list.filter((e) => e.type === "move");
      const pushes = list.filter((e) => e.type === "push");
      const spins = list.filter((e) => e.type === "spin");
      const shots = list.filter((e) => e.type === "shot");
      const rest = list.filter((e) => e.type === "grapple" || e.type === "ended");
      if (moves.length) this.queue.push(this.moveStep(moves, MOVE_MS));
      if (pushes.length) this.queue.push(this.moveStep(pushes, PUSH_MS));
      if (spins.length) this.queue.push(this.moveStep(spins, SPIN_MS));
      if (shots.length) this.queue.push(this.shotStep(shots));
      for (const e of rest) this.queue.push(this.endStep(e, state));
    }
    if (this.queue.length === 0) this.snap(state);
  }

  private moveStep(events: BattleEvent[], ms: number): Step {
    const tweens: Tween[] = [];
    for (const e of events) {
      if (e.type !== "move" && e.type !== "push" && e.type !== "spin") continue;
      const from = { x: this.cx(e.from.x), y: this.cy(e.from.y), rot: (e.from.heading * Math.PI) / 2 };
      const to = { x: this.cx(e.to.x), y: this.cy(e.to.y), rot: this.nearRot((e.to.heading * Math.PI) / 2, from.rot) };
      tweens.push({ ship: e.ship, from, to });
    }
    return {
      ms: this.reduced ? 1 : ms,
      tweens,
      shots: [],
      events,
      begin: () => {
        for (const e of events) {
          if (e.type === "spin") {
            this.popup(this.cx(e.to.x), this.cy(e.to.y) - this.cell * 0.9, this.opts.labels.spun, COLORS.well, 0.4);
            continue;
          }
          if (e.type !== "move" && e.type !== "push") continue;
          if (e.type === "push" && !e.blocked) this.popup(this.cx(e.to.x), this.cy(e.to.y) - this.cell * 0.9, this.opts.labels.blown, COLORS.current, 0.4);
          if (e.damage > 0) {
            this.hurt(e.ship, e.damage);
            const t = e.blocked === "ship" ? this.opts.labels.rammed : this.opts.labels.asteroids;
            this.popup(this.cx(e.to.x), this.cy(e.to.y) - this.cell * 1.2, t, COLORS.danger, 0.55);
            this.shake = Math.max(this.shake, 260);
            this.burst(this.cx(e.to.x), this.cy(e.to.y), COLORS.sparks, 10, 0.8);
            this.burst(this.cx(e.to.x), this.cy(e.to.y), COLORS.foam, 8, 0.7, true);
          }
        }
        this.cb.onEvents(events);
      },
    };
  }

  private shotStep(events: BattleEvent[]): Step {
    const step: Step = {
      ms: this.reduced ? 1 : SHOT_MS,
      tweens: [],
      shots: [],
      events,
      begin: () => {
        // A shot leaves from where the firing ship stands once this segment's moves have played.
        for (const e of events) {
          if (e.type !== "shot") continue;
          const v = this.ships[e.ship];
          const last = e.cells[e.cells.length - 1];
          const to = last ? { x: this.cx(last.x), y: this.cy(last.y) } : { x: v.x, y: v.y };
          const ball = new Sprite(this.textures.get("ball") ?? Texture.WHITE);
          ball.anchor.set(0.5);
          ball.position.set(v.x, v.y);
          // The slug sprite points up; turn its nose along the line of flight.
          if (to.x !== v.x || to.y !== v.y) ball.rotation = Math.atan2(to.y - v.y, to.x - v.x) + Math.PI / 2;
          this.ballLayer.addChild(ball);
          step.shots.push({ from: { x: v.x, y: v.y }, to, hit: e.hit, ship: e.ship, ball });
          // Muzzle flash and smoke off the firing side.
          const side = e.side === "port" ? -1 : 1;
          const ang = v.rot - Math.PI / 2 + (side * Math.PI) / 2;
          const mx = v.x + Math.cos(ang) * this.cell * 0.3;
          const my = v.y + Math.sin(ang) * this.cell * 0.3;
          this.particles.push({ x: mx, y: my, vx: 0, vy: 0, r: this.cell * 0.4, grow: 0.05, color: COLORS.flash, alpha: 0.95, life: 0, max: 160 });
          for (let k = 0; k < (this.reduced ? 0 : 8); k++) {
            const a = ang + (Math.random() - 0.5) * 0.9;
            const sp = 0.03 + Math.random() * 0.06;
            this.particles.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: this.cell * 0.1, grow: 0.012, color: COLORS.smoke, alpha: 0.55, life: 0, max: 700 + Math.random() * 500 });
          }
        }
        this.shake = Math.max(this.shake, 140);
        this.cb.onEvents(events);
      },
    };
    return step;
  }

  private endStep(e: BattleEvent, state: BattleState): Step {
    return {
      ms: this.reduced ? 1 : END_MS,
      tweens: [],
      shots: [],
      events: [e],
      begin: () => {
        if (e.type === "grapple") {
          const target = this.ships[e.ship === 0 ? 1 : 0];
          this.burst(target.x, target.y, COLORS.brass, 18, 1.1);
          this.shake = Math.max(this.shake, 400);
        } else if (e.type === "ended") {
          this.endFlash = 1600;
          const mid = { x: this.gx + (this.cols * this.cell) / 2, y: this.gy + (this.rows * this.cell) / 2 };
          const win = e.outcome === "boarded" || e.outcome === "crippled";
          this.popup(mid.x, mid.y, this.opts.labels.outcome(e.outcome), win ? COLORS.brassLight : e.outcome === "broke_off" || e.outcome === "disengaged" ? COLORS.muted : COLORS.danger, 1.1, 2600);
          if (win) this.burst(mid.x, mid.y, COLORS.brass, 30, 1.6);
          this.snap(state);
        }
        this.cb.onEvents([e]);
      },
    };
  }

  private hurt(ship: ShipIndex, damage: number): void {
    const v = this.ships[ship];
    v.damage = Math.min(BATTLE_PERMILLE, v.damage + damage);
    v.flash = 420;
  }

  private nearRot(target: number, from: number): number {
    let t = target;
    while (t - from > Math.PI) t -= Math.PI * 2;
    while (t - from < -Math.PI) t += Math.PI * 2;
    return t;
  }

  // ---- geometry and baking

  private cx(x: number): number {
    return this.gx + (x + 0.5) * this.cell;
  }

  private cy(y: number): number {
    return this.gy + (y + 0.5) * this.cell;
  }

  private layout(): void {
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    const board = this.state?.board;
    this.cols = board?.width ?? 18;
    this.rows = board?.height ?? 14;
    const hudH = Math.max(36, Math.min(50, H * 0.08));
    this.vertical = H > W * 1.05;
    const gutter = 8;
    const sized = (availW: number, availH: number): void => {
      // The frame takes half a cell a side; solve for the cell that fits with it.
      this.cell = Math.max(8, Math.floor(Math.min(availW / (this.cols + 1), availH / (this.rows + 1))));
      this.pad = Math.max(8, Math.floor(this.cell * 0.5));
    };
    if (this.vertical) {
      // The grid takes what it needs under a strip of the smallest size; the strip then grows into
      // the height the grid left over, so its buttons are as big as a thumb wants.
      const minStrip = Math.max(156, Math.min(216, H * 0.3));
      const availW = W - gutter * 2;
      sized(availW, H - hudH - minStrip - gutter * 3);
      const gridH = this.rows * this.cell + this.pad * 2;
      const stripH = Math.max(minStrip, Math.min(320, H - hudH - gridH - gutter * 3));
      const availH = H - hudH - stripH - gutter * 3;
      this.gx = Math.floor((W - this.cols * this.cell) / 2);
      this.gy = hudH + gutter + Math.floor((availH - this.rows * this.cell) / 2);
      this.hud = { x: gutter, y: 0, w: W - gutter * 2, h: hudH };
      this.strip = { x: gutter, y: H - stripH - gutter, w: W - gutter * 2, h: stripH };
    } else {
      const stripW = Math.max(196, Math.min(264, W * 0.3));
      const availW = W - stripW - gutter * 3;
      const availH = H - hudH - gutter * 2;
      sized(availW, availH);
      this.gx = gutter + Math.floor((availW - this.cols * this.cell) / 2);
      this.gy = hudH + gutter + Math.floor((availH - this.rows * this.cell) / 2);
      this.hud = { x: gutter, y: 0, w: availW, h: hudH };
      this.strip = { x: W - stripW - gutter, y: gutter, w: stripW, h: H - gutter * 2 };
    }
    this.app.canvas.setAttribute("data-geom", `${this.gx},${this.gy},${this.cell}`);
    this.bake();
    this.drawFrame();
    this.placeSpace();
    if (this.state) this.snap(this.state);
    this.drawPreview();
    this.drawHud();
    this.stripDirty = true;
  }

  /** Paint every texture for this cell size and board, once. */
  private bake(): void {
    const board = this.state?.board;
    const key = `${this.cell}:${this.cols}x${this.rows}:${this.state?.boardIndex ?? -1}:${this.opts.showMarks ? 1 : 0}`;
    if (key === this.bakedKey) return;
    this.bakedKey = key;
    const r = this.app.renderer.resolution;
    // Sprites go before their textures, so nothing is destroyed while still bound.
    if (this.shipSprites) for (const s of this.shipSprites) s.destroy();
    this.shipSprites = null;
    for (const s of this.ghostSprites) s.destroy();
    this.ghostSprites = [];
    for (const e of this.wellLayer.removeChildren()) e.destroy();
    if (this.spaceSprite) {
      this.spaceSprite.destroy();
      this.spaceSprite = null;
    }
    if (this.caustic) {
      this.caustic.destroy();
      this.caustic = null;
    }
    // Plot-strip gun icons and in-flight shots can still reference the old bake between ticks.
    for (const icon of this.stripIcons.removeChildren()) icon.destroy();
    const oldTextures = [...this.textures.values()];
    this.textures.clear();
    const shipPx = Math.ceil(this.cell * SHIP_SCALE);
    this.textures.set("ship0", texture(paintShip(shipPx, 0, this.opts.showMarks, r), r));
    this.textures.set("ship1", texture(paintShip(shipPx, 1, this.opts.showMarks, r), r));
    this.textures.set("well", texture(paintWell(Math.ceil(this.cell * 1.1), r), r));
    this.textures.set("ball", texture(paintBall(Math.max(6, Math.ceil(this.cell * 0.3)), r), r));
    this.textures.set("caustic", texture(paintCaustic(128, 1), 1));
    const iconPx = 28;
    this.textures.set("turret0", texture(paintTurret(iconPx, false, r), r));
    this.textures.set("turret1", texture(paintTurret(iconPx, true, r), r));
    if (board) this.textures.set("space", texture(paintSpace(board, this.cell, r), r));
    if (this.step) for (const shot of this.step.shots) shot.ball.texture = this.textures.get("ball")!;
    for (const t of oldTextures) t.destroy(true);
  }

  private drawFrame(): void {
    const g = this.frameG;
    g.clear();
    const W = this.cols * this.cell;
    const H = this.rows * this.cell;
    const p = this.pad;
    const x = this.gx;
    const y = this.gy;
    hullFrame(g, this.hullFill, { x: x - p, y: y - p, w: W + p * 2, h: H + p * 2, r: p + 4 }, { x, y, w: W, h: H }, { rivetStep: this.cell * 2 });
    // The board sits in a recess with a dark lip.
    g.rect(x, y, W, H).stroke({ width: 3, color: 0x000000, alpha: 0.55, alignment: 1 });
  }

  private placeSpace(): void {
    const space = this.textures.get("space");
    if (!space) return;
    if (!this.spaceSprite) {
      this.spaceSprite = new Sprite(space);
      this.spaceLayer.addChild(this.spaceSprite);
    } else this.spaceSprite.texture = space;
    this.spaceSprite.position.set(this.gx, this.gy);
    const W = this.cols * this.cell;
    const H = this.rows * this.cell;
    const caustic = this.textures.get("caustic");
    if (caustic && !this.reduced) {
      if (!this.caustic) {
        this.caustic = new TilingSprite({ texture: caustic, width: W, height: H });
        this.caustic.alpha = 0.5;
        this.spaceLayer.addChild(this.caustic);
      }
      this.caustic.width = W;
      this.caustic.height = H;
      this.caustic.position.set(this.gx, this.gy);
      this.caustic.tileScale.set(Math.max(0.6, this.cell / 40));
    }
    // Wells spin on their own.
    for (const e of this.wellLayer.removeChildren()) e.destroy();
    const board = this.state?.board;
    const wellTex = this.textures.get("well");
    if (!board || !wellTex) return;
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        if (battleCellAt(board, x, y)?.kind !== "well") continue;
        const s = new Sprite(wellTex);
        s.anchor.set(0.5);
        s.position.set(this.cx(x), this.cy(y));
        s.rotation = (x * 7 + y * 3) % 6;
        this.wellLayer.addChild(s);
      }
    }
  }

  // ---- ships, preview, arcs

  private shipSprite(i: ShipIndex): Sprite {
    if (!this.shipSprites) {
      const make = (who: ShipIndex): Sprite => {
        const s = new Sprite(this.textures.get(`ship${who}`) ?? Texture.WHITE);
        s.anchor.set(0.5);
        return s;
      };
      this.shipSprites = [make(0), make(1)];
      this.shipLayer.addChild(this.shipSprites[1], this.shipSprites[0]);
    }
    return this.shipSprites[i];
  }

  private drawShips(): void {
    const g = this.hullG;
    g.clear();
    const c = this.cell;
    for (const i of [1, 0] as const) {
      const v = this.ships[i];
      const s = this.shipSprite(i);
      const bob = v.moving || this.reduced ? 0 : 1;
      s.position.set(v.x, v.y + Math.sin(this.time / 850 + i * 1.7) * c * 0.025 * bob);
      s.rotation = v.rot + Math.sin(this.time / 1100 + i * 2.3) * 0.03 * bob;
      const hurt = v.damage / BATTLE_PERMILLE;
      s.tint = v.flash > 0 ? 0xffb38a : hurt > 0.5 ? 0xd8c8c0 : 0xffffff;
      // Hull bar under the ship: rounded, with a dark well, lit brass when she can be boarded.
      const w = c * 0.95;
      const h = Math.max(3, c * 0.1);
      const bx = v.x - w / 2;
      const by = v.y + c * 0.5;
      const hull = 1 - hurt;
      g.roundRect(bx - 1, by - 1, w + 2, h + 2, h).fill({ color: COLORS.ink, alpha: 0.85 });
      g.roundRect(bx, by, Math.max(h, w * hull), h, h / 2).fill(hull > 0.5 ? COLORS.good : hull > 0.25 ? COLORS.warn : COLORS.danger);
      const grappleAt = this.state ? this.state.config.grappleDamage / BATTLE_PERMILLE : 0.5;
      if (hurt >= grappleAt) g.roundRect(bx - 1, by - 1, w + 2, h + 2, h).stroke({ width: 1.5, color: COLORS.brassLight, alpha: 0.6 + Math.sin(this.time / 200) * 0.3 });
    }
  }

  /** The plotted path as ghost ships, and the arcs of the broadsides plotted along it. */
  private drawPreview(): void {
    const g = this.ghostG;
    const a = this.arcG;
    g.clear();
    a.clear();
    for (const t of this.ghostTexts) t.destroy();
    this.ghostTexts = [];
    for (const s of this.ghostSprites) s.visible = false;
    const s = this.state;
    if (!s || s.finished) return;
    // Every segment is previewed, plotted or not: a current carries a ship that holds, too.
    const course = previewBattleCourse(s, this.segments);
    const c = this.cell;
    let prev: Pose = { x: s.ships[0].x, y: s.ships[0].y, heading: s.ships[0].heading };
    this.segments.forEach((seg, i) => {
      const step = course[i];
      if (!step) return;
      const p = step.pose;
      if (this.opts.showArcs) {
        for (const side of ["port", "starboard"] as const) {
          if (!seg[side]) continue;
          const cells = battleArcCells(s.board, p, side, s.config.turretRange);
          cells.forEach((cell, k) => {
            const inset = 3;
            a.roundRect(this.gx + cell.x * c + inset, this.gy + cell.y * c + inset, c - inset * 2, c - inset * 2, c * 0.18).fill({ color: COLORS.arc, alpha: 0.3 - k * 0.06 });
          });
        }
      }
      const moved = p.x !== prev.x || p.y !== prev.y;
      if (seg.move !== null || moved) {
        // A dashed course line, then the ghost of the ship where the segment ends, numbered. The
        // ghosts along the way are small so the course reads; the last stands at nearly full size.
        const x0 = this.cx(prev.x);
        const y0 = this.cy(prev.y);
        const x1 = this.cx(p.x);
        const y1 = this.cy(p.y);
        const n = 5;
        for (let k = 0; k < n; k++) {
          const t0 = k / n;
          const t1 = (k + 0.5) / n;
          g.moveTo(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0).lineTo(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
        }
        g.stroke({ width: Math.max(1.5, c * 0.07), color: COLORS.text, alpha: 0.55, cap: "round" });
        const final = !course.slice(i + 1).some((later, k) => later.pose.x !== p.x || later.pose.y !== p.y || this.segments[i + 1 + k]?.move != null);
        let ghost = this.ghostSprites[i];
        if (!ghost) {
          ghost = new Sprite(this.textures.get("ship0") ?? Texture.WHITE);
          ghost.anchor.set(0.5);
          this.ghostLayer.addChild(ghost);
          this.ghostSprites[i] = ghost;
        }
        ghost.texture = this.textures.get("ship0") ?? Texture.WHITE;
        ghost.visible = true;
        ghost.alpha = final ? 0.6 : 0.45;
        ghost.scale.set(final ? 0.72 : 0.48);
        ghost.position.set(x1, y1);
        ghost.rotation = (p.heading * Math.PI) / 2;
        // The number rides a badge off the ship's quarter: brass, or red with a ring round the
        // cell when the segment costs hull (an asteroid, a ram) or the move is stopped.
        const bad = step.damage > 0 || step.blocked !== null;
        if (bad) g.circle(x1, y1, c * 0.48).stroke({ width: Math.max(2, c * 0.09), color: COLORS.danger, alpha: 0.9 });
        const bx = x1 + c * 0.42;
        const by = y1 - c * 0.42;
        g.circle(bx, by, c * 0.24).fill(bad ? COLORS.danger : COLORS.brass).stroke({ width: 1, color: COLORS.ink, alpha: 0.8 });
        const t = new Text({ text: String(i + 1), style: { fontFamily: FONT, fontSize: Math.max(9, c * 0.34), fontWeight: "700", fill: COLORS.ink } });
        t.anchor.set(0.5);
        t.position.set(bx, by);
        this.ghostLayer.addChild(t);
        this.ghostTexts.push(t);
      }
      prev = p;
    });
    // Where the raider's guns reach from where it stands, so the captain sees the danger.
    if (this.opts.showArcs && s.ships[1].loaded > 0) {
      const them: Pose = { x: s.ships[1].x, y: s.ships[1].y, heading: s.ships[1].heading };
      for (const side of ["port", "starboard"] as const) {
        for (const cell of battleArcCells(s.board, them, side, s.config.turretRange)) {
          a.roundRect(this.gx + cell.x * c + 5, this.gy + cell.y * c + 5, c - 10, c - 10, c * 0.14).stroke({ width: 1.5, color: COLORS.arcEnemy, alpha: 0.55 });
        }
      }
    }
  }

  // ---- the HUD: both hulls, loads, the turn

  private drawHud(): void {
    const g = this.hudG;
    g.clear();
    for (const t of this.hudTexts.removeChildren()) t.destroy();
    const s = this.state;
    if (!s) return;
    const { x, y, w, h } = this.hud;
    const half = (w - 8) / 2;
    const fs = Math.max(10, Math.min(13, h * 0.3));
    const barH = Math.max(6, h * 0.2);
    const panels: Array<{ px: number; who: ShipIndex; label: string }> = [
      { px: x, who: 0, label: this.opts.labels.you },
      { px: x + half + 8, who: 1, label: this.opts.labels.raider },
    ];
    for (const p of panels) {
      const ship = s.ships[p.who];
      const hull = 1 - ship.damage / BATTLE_PERMILLE;
      g.roundRect(p.px, y + 4, half, h - 4, 8).fill({ color: 0x000000, alpha: 0.35 });
      g.roundRect(p.px, y + 2, half, h - 4, 8).fill(this.inkFill);
      g.roundRect(p.px, y + 2, half, h - 4, 8).stroke({ width: 1, color: COLORS.text, alpha: 0.12 });
      const name = new Text({ text: p.label.toUpperCase(), style: { fontFamily: FONT, fontSize: fs - 1, fontWeight: "700", fill: p.who === 0 ? COLORS.brassLight : COLORS.danger, letterSpacing: 2 } });
      name.position.set(p.px + 10, y + 6);
      this.hudTexts.addChild(name);
      const hullText = new Text({ text: `${this.opts.labels.hull} ${Math.round(hull * 100)}%`, style: { fontFamily: FONT, fontSize: fs - 1, fill: COLORS.muted } });
      hullText.anchor.set(1, 0);
      hullText.position.set(p.px + half - 10, y + 6);
      this.hudTexts.addChild(hullText);
      const bx = p.px + 10;
      const by = y + h - barH - 7;
      const lampW = ship.turrets > 0 ? ship.turrets * (barH + 4) + 8 : 0;
      const bw = half - 20 - lampW;
      g.roundRect(bx, by, bw, barH, barH / 2).fill({ color: COLORS.ink, alpha: 0.95 });
      g.roundRect(bx, by, Math.max(barH, bw * hull), barH, barH / 2).fill(hull > 0.5 ? COLORS.good : hull > 0.25 ? COLORS.warn : COLORS.danger);
      g.roundRect(bx + 1, by + 1, Math.max(barH, bw * hull) - 2, barH * 0.4, barH / 3).fill({ color: 0xffffff, alpha: 0.18 });
      if (ship.damage >= s.config.grappleDamage) g.roundRect(bx - 1, by - 1, bw + 2, barH + 2, barH / 2 + 1).stroke({ width: 1.5, color: COLORS.brassLight, alpha: 0.9 });
      for (let i = 0; i < ship.turrets; i++) {
        const lx = bx + bw + 8 + i * (barH + 4) + barH / 2;
        const ly = by + barH / 2;
        const lit = i < ship.loaded;
        if (lit) g.circle(lx, ly, barH * 0.85).fill({ color: COLORS.brassLight, alpha: 0.2 });
        g.circle(lx, ly, barH / 2).fill(lit ? COLORS.brassLight : COLORS.ink).stroke({ width: 1, color: lit ? COLORS.brassDeep : COLORS.brass, alpha: 0.9 });
      }
    }
    this.stripDirty = true;
  }

  // ---- the plot strip

  private drawStrip(): void {
    this.stripDirty = false;
    const g = this.stripG;
    g.clear();
    for (const t of this.stripTexts.removeChildren()) t.destroy();
    for (const t of this.stripIcons.removeChildren()) t.destroy();
    this.buttons = [];
    const s = this.state;
    if (!s) return;
    const { x, y, w, h } = this.strip;
    g.roundRect(x, y + 3, w, h, 12).fill({ color: 0x000000, alpha: 0.4 });
    g.roundRect(x, y, w, h, 12).fill(this.inkFill);
    g.roundRect(x, y, w, h, 12).stroke({ width: 1, color: COLORS.text, alpha: 0.12 });
    const me = s.ships[0];
    const n = s.config.segments;
    const live = this.interactive && !s.finished;
    const fs = Math.max(10, Math.min(13, this.vertical ? h * 0.075 : w * 0.055));
    const label = (text: string, tx: number, ty: number, color = COLORS.text, size = fs, anchorX = 0.5, weight: "400" | "700" = "700", spacing = 0): Text => {
      const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color, letterSpacing: spacing } });
      t.anchor.set(anchorX, 0.5);
      t.position.set(tx, ty);
      this.stripTexts.addChild(t);
      return t;
    };
    const button = (id: string, bx: number, by: number, bw: number, bh: number, kind: "brass" | "ink" | "ghost", enabled: boolean): void => {
      const press = this.pressed?.id === id ? 1 - Math.min(1, this.pressed.t / 160) : 0;
      const alpha = enabled ? 1 : 0.4;
      const r = 8;
      if (kind === "brass") {
        g.roundRect(bx, by + 2, bw, bh, r).fill({ color: COLORS.brass, alpha: 0.35 * alpha });
        g.roundRect(bx, by + press, bw, bh, r).fill(this.brassFill);
        if (!enabled) g.roundRect(bx, by, bw, bh, r).fill({ color: COLORS.inkDeep, alpha: 0.55 });
        g.roundRect(bx + 1, by + 1 + press, bw - 2, bh * 0.45, r - 1).fill({ color: 0xffffff, alpha: 0.18 * alpha });
      } else if (kind === "ink") {
        g.roundRect(bx, by + 2, bw, bh, r).fill({ color: 0x000000, alpha: 0.35 });
        g.roundRect(bx, by + press, bw, bh, r).fill({ color: COLORS.ink, alpha: 0.95 });
        g.roundRect(bx, by + press, bw, bh, r).stroke({ width: 1, color: COLORS.brass, alpha: 0.55 * alpha });
        g.roundRect(bx + 1, by + 1 + press, bw - 2, bh * 0.4, r - 1).fill({ color: 0xffffff, alpha: 0.05 });
      } else {
        g.roundRect(bx, by + press, bw, bh, r).stroke({ width: 1, color: COLORS.text, alpha: 0.3 * alpha });
      }
      if (enabled) this.buttons.push({ id, x: bx, y: by, w: bw, h: bh });
    };
    // Turn clock.
    const top = y + 10;
    label(this.opts.labels.turn(s.turn + 1, s.config.maxTurns).toUpperCase(), x + 12, top + fs * 0.6, COLORS.muted, fs - 2, 0, "700", 2);
    const clockW = w - 24;
    const clockY = top + fs * 1.5;
    g.roundRect(x + 12, clockY, clockW, 5, 2.5).fill({ color: COLORS.ink, alpha: 0.95 });
    if (this.turnLeftMs !== null && live) {
      const k = Math.max(0, Math.min(1, this.turnLeftMs / this.turnMs));
      g.roundRect(x + 12, clockY, Math.max(5, clockW * k), 5, 2.5).fill(k < 0.25 ? COLORS.danger : COLORS.brass);
    }
    // Slots. On a tall board each is a card: the move on top, its two guns side by side beneath,
    // each half the card wide. On a wide board each is a row with a gun at either end.
    const slotTop = clockY + 14;
    const gap = 6;
    const tall = this.vertical;
    // What the strip has left for slots, tokens and the bottom row, shared out between them.
    const spare = Math.max(96, y + h - slotTop - 20 - fs * 1.6);
    const trayH = tall ? Math.max(30, Math.min(50, spare * 0.25)) : 38;
    const rowH = tall ? Math.max(32, Math.min(54, spare * 0.28)) : 42;
    let slotW: number;
    let slotH: number;
    let slotX = (i: number): number => x + 12 + i * ((w - 24) / n);
    let slotY = (_i: number): number => slotTop;
    if (tall) {
      slotW = (w - 24) / n - gap;
      slotH = Math.max(52, Math.min(112, spare - trayH - rowH));
    } else {
      slotW = w - 24;
      slotH = Math.max(32, Math.min(52, (h - slotTop + y - 216) / n - gap));
      slotX = () => x + 12;
      slotY = (i) => slotTop + i * (slotH + gap);
    }
    const gunW = tall ? (slotW - 9) / 2 : Math.max(28, Math.min(48, slotW * 0.22));
    const gunH = tall ? Math.max(24, Math.min(46, slotH * 0.42)) : slotH - 6;
    const turretTex = (lit: boolean): Texture => this.textures.get(lit ? "turret1" : "turret0") ?? Texture.WHITE;
    for (let i = 0; i < n; i++) {
      const seg = this.segments[i] ?? { move: null, port: false, starboard: false };
      const sx = slotX(i);
      const sy = slotY(i);
      const sel = this.selected === i && live;
      g.roundRect(sx, sy, slotW, slotH, 9).fill({ color: COLORS.ink, alpha: 0.9 });
      g.roundRect(sx + 1, sy + 1, slotW - 2, slotH - 2, 8).stroke({ width: 1, color: 0xffffff, alpha: 0.05 });
      if (sel) {
        g.roundRect(sx - 1, sy - 1, slotW + 2, slotH + 2, 10).stroke({ width: 2, color: COLORS.brassLight, alpha: 0.95 });
        g.roundRect(sx - 3, sy - 3, slotW + 6, slotH + 6, 12).stroke({ width: 3, color: COLORS.brass, alpha: 0.25 });
      } else g.roundRect(sx, sy, slotW, slotH, 9).stroke({ width: 1, color: COLORS.brass, alpha: 0.25 });
      // The move's own area: the card above the guns, or the row between them. Nothing overlaps.
      const move = tall ? { x: sx, y: sy, w: slotW, h: slotH - gunH - 3 } : { x: sx + gunW + 3, y: sy, w: slotW - gunW * 2 - 6, h: slotH };
      if (live) this.buttons.push({ id: `slot:${i}`, ...move });
      const midX = move.x + move.w / 2;
      const midY = move.y + move.h / 2;
      // The move glyph, lit brass when plotted.
      this.paintToken(g, seg.move, midX, midY, Math.min(move.h * 0.62, move.w * 0.5, 34), seg.move === null ? COLORS.muted : COLORS.brassLight, seg.move !== null);
      label(String(i + 1), move.x + 7, sy + fs * 0.75, COLORS.muted, fs - 2, 0, "400");
      // Port and starboard guns: a turret each, its lamp lit when armed.
      for (const side of ["port", "starboard"] as const) {
        const bx = side === "port" ? sx + 3 : sx + slotW - gunW - 3;
        const by = tall ? sy + slotH - gunH - 3 : sy + 3;
        const on = seg[side];
        const can = live && (on || me.loaded > this.shotsPlanned());
        g.roundRect(bx, by, gunW, gunH, 7).fill({ color: on ? COLORS.danger : COLORS.inkDeep, alpha: on ? 0.75 : can ? 0.95 : 0.4 });
        if (on) g.roundRect(bx, by, gunW, gunH, 7).stroke({ width: 1, color: COLORS.flash, alpha: 0.6 });
        else if (can) g.roundRect(bx, by, gunW, gunH, 7).stroke({ width: 1, color: COLORS.brass, alpha: 0.3 });
        const icon = new Sprite(turretTex(on));
        icon.anchor.set(0.5);
        const ip = Math.min(gunW, gunH, 30) * 0.95;
        icon.width = ip;
        icon.height = ip;
        icon.position.set(bx + gunW / 2, by + gunH / 2);
        icon.rotation = side === "port" ? -Math.PI / 2 : Math.PI / 2;
        icon.alpha = can || on ? 1 : 0.45;
        this.stripIcons.addChild(icon);
        // The whole of the gun's end of the slot takes the tap, out to the slot's edge.
        if (can) this.buttons.push(tall ? { id: `fire:${i}:${side}`, x: side === "port" ? sx : sx + slotW / 2, y: by - 1, w: slotW / 2, h: gunH + 4 } : { id: `fire:${i}:${side}`, x: side === "port" ? sx : bx - 1, y: sy, w: gunW + 4, h: slotH });
      }
    }
    // Tokens tray.
    const trayY = tall ? slotTop + slotH + 10 : slotY(n - 1) + slotH + 12;
    const trayItems: Array<MoveToken | null> = ["left", "forward", "right", null];
    const trayW = (w - 24 - gap * 3) / 4;
    const placing = this.selected >= 0;
    trayItems.forEach((t, i) => {
      const bx = x + 12 + i * (trayW + gap);
      const count = t === null ? null : me.tokens[t];
      const enabled = live && placing && (t === null || (count ?? 0) > this.tokensPlanned(t) - (this.segments[this.selected]?.move === t ? 1 : 0));
      button(`token:${t ?? "hold"}`, bx, trayY, trayW, trayH, "ink", enabled);
      this.paintToken(g, t, bx + trayW * 0.34, trayY + trayH / 2, Math.min(trayH * 0.52, 26), enabled ? COLORS.brassLight : COLORS.muted, enabled);
      if (t !== null && count !== null) label(`×${count - this.tokensPlanned(t)}`, bx + trayW * 0.72, trayY + trayH / 2, enabled ? COLORS.text : COLORS.muted, fs);
      else label(this.opts.labels.hold, bx + trayW * 0.7, trayY + trayH / 2, enabled ? COLORS.text : COLORS.muted, fs - 2);
    });
    // Grapple, clear, fly.
    const rowY = trayY + trayH + 10;
    const ready = s.ships[1].damage >= s.config.grappleDamage;
    const plotted = this.segments.some((seg) => seg.move !== null || seg.port || seg.starboard);
    // On a wide board the strip is narrow and tall: fly gets a row of its own under the others.
    const inner = w - 24 - gap * (tall ? 3 : 2);
    const gw = inner * (tall ? 0.3 : 0.46);
    button("grapple", x + 12, rowY, gw, rowH, this.grapple ? "brass" : "ink", live);
    if (ready && live && !this.grapple) g.roundRect(x + 12, rowY, gw, rowH, 8).stroke({ width: 2, color: COLORS.brassLight, alpha: 0.5 + Math.sin(this.time / 220) * 0.4 });
    this.paintHook(g, x + 12 + fs * 1.3, rowY + rowH / 2, fs * 0.9, this.grapple ? COLORS.ink : COLORS.brassLight);
    label(this.opts.labels.grapple, x + 12 + fs * 2.3, rowY + rowH / 2, this.grapple ? COLORS.ink : COLORS.text, fs - 1, 0);
    // Take back the last move, or the whole plot.
    const uw = tall ? Math.max(rowH, inner * 0.13) : inner * 0.24;
    const ux = x + 12 + gw + gap;
    button("undo", ux, rowY, uw, rowH, "ghost", live && plotted);
    this.paintBackspace(g, ux + uw / 2, rowY + rowH / 2, fs * 1.1, live && plotted ? COLORS.text : COLORS.muted);
    const cx = ux + uw + gap;
    const cw = tall ? inner * 0.17 : x + w - 12 - cx;
    button("clear", cx, rowY, cw, rowH, "ghost", live && plotted);
    label(this.opts.labels.clear, cx + cw / 2, rowY + rowH / 2, live && plotted ? COLORS.text : COLORS.muted, fs - 2);
    const sx = tall ? cx + cw + gap : x + 12;
    const sy = tall ? rowY : rowY + rowH + 10;
    const sw = x + w - 12 - sx;
    const sh = tall ? rowH : Math.max(rowH, Math.min(52, y + h - sy - 12 - fs * 2));
    button("fly", sx, sy, sw, sh, "brass", live);
    label(this.opts.labels.fly, sx + sw / 2, sy + sh / 2, 0x1b150c, fs + (tall ? 0 : 1));
    if (ready && live) label(this.opts.labels.grappleReady, x + w / 2, sy + sh + fs, COLORS.brassLight, fs - 2);
    // Where the strip's buttons are, for the smoke test's taps.
    this.app.canvas.setAttribute("data-buttons", this.buttons.map((b) => `${b.id}=${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(";"));
  }

  /**
   * A move token: forward is a straight arrow; a turn runs up a short shaft, sweeps through a
   * quarter circle and ends in a head pointing the new way. One stroke weight and one head shape
   * for all three, so they read as a set.
   */
  private paintToken(g: Graphics, t: MoveToken | null, x: number, y: number, size: number, color: number, lit: boolean): void {
    const r = size * 0.5;
    const width = Math.max(2, size * 0.16);
    const head = r * 0.42;
    if (lit) g.circle(x, y, r * 1.1).fill({ color, alpha: 0.12 });
    const arrowhead = (tipX: number, tipY: number, dx: number, dy: number): void => {
      // A filled triangle with its tip at (tipX, tipY), pointing along (dx, dy).
      const bx = tipX - dx * head;
      const by = tipY - dy * head;
      g.poly([tipX, tipY, bx + dy * head * 0.75, by - dx * head * 0.75, bx - dy * head * 0.75, by + dx * head * 0.75]).fill(color);
    };
    if (t === null) {
      g.circle(x, y, r * 0.42).stroke({ width, color });
      g.circle(x, y, r * 0.1).fill(color);
      return;
    }
    if (t === "forward") {
      g.moveTo(x, y + r * 0.85).lineTo(x, y - r * 0.5).stroke({ width, color, cap: "round" });
      arrowhead(x, y - r * 0.9, 0, -1);
      return;
    }
    const dir = t === "left" ? -1 : 1;
    const R = r * 0.8;
    const sx = x - dir * r * 0.4;
    // The shaft, then the sweep: a quarter circle whose centre sits beside the shaft's top.
    g.moveTo(sx, y + r * 0.85).lineTo(sx, y + r * 0.1).stroke({ width, color, cap: "round" });
    const cx = sx + dir * R;
    const cy = y + r * 0.1;
    if (dir === 1) g.arc(cx, cy, R, Math.PI, Math.PI * 1.5);
    else g.arc(cx, cy, R, 0, -Math.PI * 0.5, true);
    g.stroke({ width, color, cap: "round" });
    // The head sits at the top of the sweep, pointing the new way, a touch past the arc's end.
    arrowhead(cx + dir * head * 0.6, cy - R, dir, 0);
  }

  /** A backspace key: a pointed cap with a cross in it. */
  private paintBackspace(g: Graphics, x: number, y: number, size: number, color: number): void {
    const w = Math.max(1.5, size * 0.14);
    const h = size * 0.36;
    g.moveTo(x - size * 0.6, y).lineTo(x - size * 0.25, y - h).lineTo(x + size * 0.55, y - h).lineTo(x + size * 0.55, y + h).lineTo(x - size * 0.25, y + h).closePath().stroke({ width: w, color, join: "round" });
    const k = size * 0.14;
    g.moveTo(x - k * 0.3, y - k).lineTo(x + k * 1.7, y + k).moveTo(x + k * 1.7, y - k).lineTo(x - k * 0.3, y + k).stroke({ width: w, color, cap: "round" });
  }

  /** A grappling hook. */
  private paintHook(g: Graphics, x: number, y: number, size: number, color: number): void {
    const w = Math.max(1.5, size * 0.16);
    g.moveTo(x, y - size * 0.5).lineTo(x, y + size * 0.15).stroke({ width: w, color, cap: "round" });
    g.arc(x, y + size * 0.15, size * 0.38, Math.PI * 0.1, Math.PI * 0.9).stroke({ width: w, color, cap: "round" });
    g.arc(x, y + size * 0.15, size * 0.38, Math.PI * 1.1, Math.PI * 1.9).stroke({ width: w, color, cap: "round" });
    g.circle(x, y - size * 0.5, w * 0.9).fill(color);
  }

  private tokensPlanned(t: MoveToken): number {
    return this.segments.filter((s) => s.move === t).length;
  }

  private shotsPlanned(): number {
    return this.segments.reduce((n, s) => n + (s.port ? 1 : 0) + (s.starboard ? 1 : 0), 0);
  }

  // ---- input

  private pointerDown(e: FederatedPointerEvent): void {
    const px = e.global.x;
    const py = e.global.y;
    for (const b of this.buttons) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        this.press(b.id);
        return;
      }
    }
  }

  private press(id: string): void {
    if (!this.interactive || !this.state || this.state.finished) return;
    this.pressed = { id, t: 0 };
    const [kind, a, b] = id.split(":");
    if (kind === "slot") {
      // A tap picks the slot; a tap on the slot already picked takes its move back.
      const i = Number(a);
      const seg = this.segments[i]!;
      if (this.selected === i && seg.move !== null) this.setSegment(i, { ...seg, move: null });
      this.selected = i;
      this.focus = i;
      this.cb.onNudge();
    } else if (kind === "undo") {
      this.undo();
    } else if (kind === "fire") {
      const i = Number(a);
      const side = b as Side;
      const seg = this.segments[i]!;
      this.setSegment(i, { ...seg, [side]: !seg[side] });
      this.focus = i;
      this.cb.onNudge();
    } else if (kind === "token") {
      const t: MoveToken | null = a === "hold" ? null : (a as MoveToken);
      this.queueToken(t);
    } else if (kind === "grapple") {
      this.grapple = !this.grapple;
      this.cb.onNudge();
      this.cb.onPlanChange(this.plan());
    } else if (kind === "clear") {
      this.resetPlan(this.state);
      this.cb.onNudge();
    } else if (kind === "fly") {
      this.commit(true);
    }
    this.stripDirty = true;
  }

  /**
   * Put a token in the selected slot and move the selection to the next slot with no move in it.
   * With every slot plotted nothing is selected, so a stray token never overwrites a move: the
   * captain picks the slot to change.
   */
  private queueToken(t: MoveToken | null): void {
    const s = this.state;
    if (!s || s.finished || !this.interactive) return;
    const i = this.selected;
    const seg = this.segments[i];
    this.cb.onNudge();
    if (!seg) return;
    if (t !== null && s.ships[0].tokens[t] <= this.tokensPlanned(t) - (seg.move === t ? 1 : 0)) return;
    this.setSegment(i, { ...seg, move: t });
    this.focus = i;
    // A hold steps on to the next slot; a move looks for the next slot still open, later ones first.
    if (t === null) this.selected = Math.min(this.segments.length - 1, i + 1);
    else this.selected = this.firstOpen(i);
  }

  /** The first slot with no move in it, looking after `from` before wrapping round; -1 when all are plotted. */
  private firstOpen(from = -1): number {
    const n = this.segments.length;
    for (let k = 1; k <= n; k++) {
      const j = (from + k + n) % n;
      if (j !== from && this.segments[j]!.move === null) return j;
    }
    return -1;
  }

  private setSegment(i: number, seg: BattleSegment): void {
    this.segments[i] = seg;
    this.stripDirty = true;
    this.drawPreview();
    this.cb.onPlanChange(this.plan());
  }

  /** Returns true when the key was taken. */
  keyboard(key: string): boolean {
    if (!this.interactive || !this.state || this.state.finished) return false;
    switch (key) {
      case "a":
      case "A":
      case "ArrowLeft":
        this.queueToken("left");
        return true;
      case "w":
      case "W":
      case "ArrowUp":
        this.queueToken("forward");
        return true;
      case "d":
      case "D":
      case "ArrowRight":
        this.queueToken("right");
        return true;
      case "s":
      case "S":
      case "ArrowDown":
        this.queueToken(null);
        return true;
      case "q":
      case "Q":
      case "e":
      case "E": {
        const i = this.focus;
        const seg = this.segments[i];
        const side: Side = key === "q" || key === "Q" ? "port" : "starboard";
        this.cb.onNudge();
        if (!seg || (!seg[side] && this.state.ships[0].loaded <= this.shotsPlanned())) return true;
        this.setSegment(i, { ...seg, [side]: !seg[side] });
        return true;
      }
      case "Backspace":
        this.undo();
        return true;
      case "g":
      case "G":
        this.grapple = !this.grapple;
        this.stripDirty = true;
        this.cb.onNudge();
        this.cb.onPlanChange(this.plan());
        return true;
      case "Escape":
        this.resetPlan(this.state);
        return true;
      case "Enter":
      case " ":
        this.commit(true);
        return true;
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8": {
        const i = Number(key) - 1;
        if (i < this.segments.length) {
          this.selected = i;
          this.focus = i;
          this.stripDirty = true;
        }
        return true;
      }
      default:
        return false;
    }
  }

  /** The slot undo takes back: the last one with anything in it, else the selected one. */
  private lastPlotted(): number {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i]!;
      if (s.move !== null || s.port || s.starboard) return i;
    }
    return Math.max(0, Math.min(this.selected, this.segments.length - 1));
  }

  // ---- animation

  private tick(dt: number): void {
    this.time += dt;
    if (this.flyGuard > 0) this.flyGuard -= dt;
    if (this.pressed) {
      this.pressed.t += dt;
      if (this.pressed.t > 160) this.pressed = null;
      this.stripDirty = true;
    }
    if (!this.step && this.queue.length) {
      this.step = this.queue.shift()!;
      this.stepT = 0;
      this.step.begin();
    }
    // The space moves: light drifts over it, wells turn.
    if (this.caustic && !this.reduced) {
      this.caustic.tilePosition.x += dt * 0.006;
      this.caustic.tilePosition.y += dt * 0.004;
    }
    if (!this.reduced) for (const e of this.wellLayer.children) e.rotation += dt * 0.0012;
    for (const v of this.ships) v.moving = false;
    if (this.step) {
      this.stepT += dt;
      const k = Math.min(1, this.stepT / this.step.ms);
      const ease = 1 - (1 - k) ** 2;
      for (const tw of this.step.tweens) {
        const v = this.ships[tw.ship];
        v.x = tw.from.x + (tw.to.x - tw.from.x) * ease;
        v.y = tw.from.y + (tw.to.y - tw.from.y) * ease;
        v.rot = tw.from.rot + (tw.to.rot - tw.from.rot) * ease;
        v.moving = tw.from.x !== tw.to.x || tw.from.y !== tw.to.y;
        if (v.moving && !this.reduced && Math.random() < 0.6) this.wake(v);
      }
      // Slugs in flight, trailing smoke.
      for (const sh of this.step.shots) {
        const x = sh.from.x + (sh.to.x - sh.from.x) * k;
        const y = sh.from.y + (sh.to.y - sh.from.y) * k - Math.sin(k * Math.PI) * this.cell * 0.55;
        sh.ball.position.set(x, y);
        sh.ball.scale.set(1 + Math.sin(k * Math.PI) * 0.35);
        if (!this.reduced && Math.random() < 0.5) this.particles.push({ x, y, vx: 0, vy: -0.004, r: this.cell * 0.06, grow: 0.01, color: COLORS.smoke, alpha: 0.35, life: 0, max: 400 });
      }
      if (k >= 1) {
        for (const tw of this.step.tweens) {
          const v = this.ships[tw.ship];
          v.x = tw.to.x;
          v.y = tw.to.y;
          v.rot = tw.to.rot;
        }
        // Shots land as the step ends.
        for (const sh of this.step.shots) {
          sh.ball.destroy();
          if (sh.hit) {
            this.hurt(sh.ship === 0 ? 1 : 0, this.state?.config.shotDamage ?? 0);
            this.popup(sh.to.x, sh.to.y - this.cell * 0.9, sh.ship === 0 ? this.opts.labels.hit : this.opts.labels.hitTaken, sh.ship === 0 ? COLORS.brassLight : COLORS.danger, 0.6);
            this.particles.push({ x: sh.to.x, y: sh.to.y, vx: 0, vy: 0, r: this.cell * 0.3, grow: 0.06, color: COLORS.flash, alpha: 0.95, life: 0, max: 200 });
            this.burst(sh.to.x, sh.to.y, COLORS.sparks, 12, 1);
            this.burst(sh.to.x, sh.to.y, COLORS.smoke, 8, 0.8);
            this.shake = Math.max(this.shake, 300);
          } else {
            this.popup(sh.to.x, sh.to.y - this.cell * 0.7, this.opts.labels.miss, COLORS.splash, 0.35);
            this.rings.push({ x: sh.to.x, y: sh.to.y, life: 0, max: 600, r: this.cell * 0.5, color: COLORS.foam });
            this.burst(sh.to.x, sh.to.y, COLORS.splash, 9, 0.7, true);
          }
        }
        this.step = null;
        if (this.queue.length === 0 && this.state) {
          this.snap(this.state);
          this.drawPreview();
        }
      }
    }
    for (const v of this.ships) if (v.flash > 0) v.flash -= dt;
    this.drawShips();
    // Camera shake.
    if (this.shake > 0) {
      this.shake -= dt;
      const a = this.reduced ? 0 : (this.shake / 400) * 4;
      this.world.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    } else this.world.position.set(0, 0);
    // Wakes, splashes and smoke.
    const fx = this.fxG;
    const wk = this.wakeG;
    fx.clear();
    wk.clear();
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      if (p.life >= p.max) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.grow * dt;
      const a = p.alpha * (1 - p.life / p.max);
      const layer = p.flat ? wk : fx;
      if (p.flat) layer.ellipse(p.x, p.y, Math.max(0.5, p.r) * 1.4, Math.max(0.5, p.r) * 0.7).fill({ color: p.color, alpha: a });
      else layer.circle(p.x, p.y, Math.max(0.5, p.r)).fill({ color: p.color, alpha: a });
      return true;
    });
    this.rings = this.rings.filter((r) => {
      r.life += dt;
      const k = r.life / r.max;
      if (k >= 1) return false;
      const rad = r.r * (0.3 + k * 1.2);
      wk.ellipse(r.x, r.y, rad, rad * 0.55).stroke({ width: Math.max(1, this.cell * 0.06 * (1 - k)), color: r.color, alpha: 0.7 * (1 - k) });
      return true;
    });
    // Popups.
    this.popups = this.popups.filter((p) => {
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        p.t.destroy();
        return false;
      }
      p.t.y = p.y0 - k * this.cell * 1.2;
      p.t.alpha = k < 0.15 ? k / 0.15 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      p.t.scale.set(k < 0.15 ? 0.6 + (k / 0.15) * 0.4 : 1);
      return true;
    });
    if (this.endFlash > 0) {
      this.endFlash -= dt;
      fx.rect(this.gx, this.gy, this.cols * this.cell, this.rows * this.cell).fill({ color: COLORS.flash, alpha: Math.max(0, this.endFlash / 1600) * 0.18 });
    }
    if (this.stripDirty) this.drawStrip();
    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
    }
  }

  /** Foam off the stern of a ship under way. */
  private wake(v: ShipView): void {
    const back = v.rot + Math.PI / 2;
    const sx = v.x + Math.cos(back) * this.cell * 0.38 + (Math.random() - 0.5) * this.cell * 0.25;
    const sy = v.y + Math.sin(back) * this.cell * 0.38 + (Math.random() - 0.5) * this.cell * 0.25;
    this.particles.push({ x: sx, y: sy, vx: Math.cos(back) * 0.01, vy: Math.sin(back) * 0.01, r: this.cell * 0.07, grow: 0.012, color: COLORS.foam, alpha: 0.5, life: 0, max: 520 + Math.random() * 300, flat: true });
  }

  private popup(x: number, y: number, text: string, color: number, scale: number, max = 1100): void {
    const t = new Text({ text, style: { fontFamily: DISPLAY, fontSize: Math.max(11, this.cell * 0.9 * scale), fontWeight: "700", fontStyle: "italic", fill: color, stroke: { color: COLORS.ink, width: 3 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max, y0: y });
  }

  private burst(x: number, y: number, color: number, n: number, power: number, flat = false): void {
    if (this.reduced) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.03 + Math.random() * 0.07) * power;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * (flat ? 0.5 : 1), r: this.cell * 0.06, grow: flat ? 0.006 : 0.003 * power, color, alpha: 0.9, life: 0, max: 360 + Math.random() * 260, flat });
    }
  }
}
