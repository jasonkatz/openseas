import { soundsFor } from "../audio.js";
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
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
import { kindCanvas, type BattleKind, type Paint } from "./art.js";
import { boardSurface } from "../surface.js";
import { FONT, MOTION, RADIUS, blend, ink, type Token } from "../look/tokens.js";

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
  /** ms left of the ring that says she was just struck. */
  flash: number;
  /** ms since a wrecked ship began to shrink away, or -1 while she is whole. */
  sink: number;
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

/** One step of a resolved turn's playback. */
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

/** A slug that missed, shrinking to nothing where it stopped. */
interface Spent {
  s: Sprite;
  life: number;
}

interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Whose is whose, in palette colours (docs/BRAND.md section 2). Amber is the captain's own ship,
 * plot and selection; the raider is one piece colour and a silhouette of its own; danger is kept
 * for what is bad for the captain.
 */
const OWN: Token = "amber";
const RAIDER: Token = "lilac";
/** Rock is inert, so it is slate, and quietened toward the ground: a board has sixty of them round its edge. */
const ROCK = blend("ground", "slate", 0.5);
const WELL: Token = "teal";
const CURRENT: Token = "dim";

const COLORS = {
  ground: ink("ground"),
  raised: ink("raised"),
  line: ink("line"),
  cream: ink("cream"),
  dim: ink("dim"),
  amber: ink(OWN),
  danger: ink("danger"),
  raider: ink(RAIDER),
  // The cells a plotted broadside reaches: a flat tint of the ground.
  arc: blend("ground", OWN, 0.26),
};
// A turn's playback runs on the same clock the next plot is made against, so its steps are brisk.
const MOVE_MS = 360;
const PUSH_MS = 260;
const SPIN_MS = 220;
const SHOT_MS = 320;
const END_MS = 900;
/** After a turn resolves, a tap on fly with nothing plotted is a double tap, not a turn of holds. */
const FLY_GUARD_MS = 700;
/** How long the ring round a struck ship stays. */
const STRUCK_MS = 420;
/** A ship is drawn a little larger than her cell, so she reads over the chart at 24 pixels a cell. */
const SHIP_SCALE = 1.25;
/** Hits landed in one turn that earn the beat. */
const VOLLEY_HITS = 3;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

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

export class BattleRenderer {
  readonly app = new Application();
  private readonly world = new Container();
  /** The chart's ground, its one hairline and a dot in every open cell. */
  private readonly chartG = new Graphics();
  private readonly terrainLayer = new Container();
  private readonly arcG = new Graphics();
  private readonly ghostLayer = new Container();
  private readonly ghostG = new Graphics();
  private readonly shipLayer = new Container();
  private readonly hullG = new Graphics();
  private readonly ballLayer = new Container();
  private readonly beatLayer = new Graphics();
  private readonly fxLayer = new Container();
  private readonly hudG = new Graphics();
  private readonly hudTexts = new Container();
  private readonly stripG = new Graphics();
  private readonly stripIcons = new Container();
  private readonly stripTexts = new Container();
  private readonly textures = new Map<string, Texture>();
  private shipSprites: [Sprite, Sprite] | null = null;
  private ghostSprites: Array<Sprite | undefined> = [];
  private ghostTexts: Text[] = [];
  private state: BattleState | null = null;
  private ships: [ShipView, ShipView] = [
    { x: 0, y: 0, rot: 0, damage: 0, flash: 0, sink: -1 },
    { x: 0, y: 0, rot: Math.PI, damage: 0, flash: 0, sink: -1 },
  ];
  private shownTurn = -1;
  private shownOutcome: BattleOutcome | null = null;
  private queue: Step[] = [];
  private step: Step | null = null;
  private stepT = 0;
  private popups: Popup[] = [];
  private spent: Spent[] = [];
  /** The grapple thrown this turn: whose it is, and how long its line stays (for good once it holds). */
  private hook: { ship: ShipIndex; ms: number } | null = null;
  /** Hits the captain has landed in the turn being played back. */
  private turnHits = 0;
  /** The beat: one amber pulse of the whole chart for a big moment (docs/BRAND.md section 6). */
  private beatNow: { life: number; strength: number } | null = null;
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
  private turnLeftMs: number | null = null;
  private turnMs = 1;
  /** Geometry. */
  private cell = 24;
  private gx = 0;
  private gy = 0;
  private cols = 1;
  private rows = 1;
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
    // Every label is drawn as text, so wait (briefly) for the webfont. Before the app exists: the
    // board hands a state to any renderer that has one, and the layers come after.
    await Promise.race([document.fonts?.ready, new Promise((r) => window.setTimeout(r, 800))]).catch(() => undefined);
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
    // No atlas to wait for: everything is drawn in code (ADR 0062). The studio's thumbnails read this.
    this.app.canvas.dataset.pieces = "drawn";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "battle-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    this.ghostLayer.addChild(this.ghostG);
    this.world.addChild(this.chartG, this.terrainLayer, this.arcG, this.ghostLayer, this.shipLayer, this.hullG, this.ballLayer, this.beatLayer, this.fxLayer);
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
    }
  }

  setInteractive(on: boolean): void {
    if (this.interactive === on) return;
    this.interactive = on;
    this.stripDirty = true;
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
      this.spent.forEach((p) => p.s.destroy());
      this.spent = [];
      this.hook = null;
      this.beatNow = null;
      this.world.scale.set(1);
      for (const v of this.ships) v.sink = -1;
      this.snap(state);
      this.shownTurn = state.turn;
      this.shownOutcome = state.outcome;
      this.resetPlan(state);
    } else if (state.turn > this.shownTurn && state.lastTurn) {
      this.turnHits = 0;
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

  /** Stand both ships where the state has them. A wrecked ship is gone, or goes on shrinking if she is on her way. */
  private snap(state: BattleState): void {
    const wrecked = state.outcome === "crippled" ? 1 : state.outcome === "crippled_by" ? 0 : -1;
    for (const i of [0, 1] as const) {
      const s = state.ships[i];
      const sink = wrecked === i ? (this.ships[i].sink >= 0 ? this.ships[i].sink : MOTION.clear) : -1;
      this.ships[i] = { x: this.cx(s.x), y: this.cy(s.y), rot: (s.heading * Math.PI) / 2, damage: s.damage, flash: 0, sink };
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
            this.popup(this.cx(e.to.x), this.cy(e.to.y) - this.cell * 0.9, this.opts.labels.spun, COLORS.dim, 0.4);
            continue;
          }
          if (e.type !== "move" && e.type !== "push") continue;
          if (e.type === "push" && !e.blocked) this.popup(this.cx(e.to.x), this.cy(e.to.y) - this.cell * 0.9, this.opts.labels.blown, COLORS.dim, 0.4);
          if (e.damage > 0) {
            // A knock is bad news when it is the captain's hull, and good news when it is the raider's.
            this.hurt(e.ship, e.damage);
            const t = e.blocked === "ship" ? this.opts.labels.rammed : this.opts.labels.asteroids;
            this.popup(this.cx(e.to.x), this.cy(e.to.y) - this.cell * 1.2, t, e.ship === 0 ? COLORS.danger : COLORS.cream, 0.55);
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
          // The captain's slug is amber; the raider's is its own colour, and red when it is about to strike.
          const ball = new Sprite(this.textures.get(e.ship === 0 ? "slug0" : e.hit ? "slugHit" : "slug1") ?? Texture.WHITE);
          ball.anchor.set(0.5);
          ball.position.set(v.x, v.y);
          // The slug is drawn nose up; turn it along the line of flight.
          if (to.x !== v.x || to.y !== v.y) ball.rotation = Math.atan2(to.y - v.y, to.x - v.x) + Math.PI / 2;
          this.ballLayer.addChild(ball);
          step.shots.push({ from: { x: v.x, y: v.y }, to, hit: e.hit, ship: e.ship, ball });
        }
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
          // The line goes over; it stays if the boarding holds.
          this.hook = { ship: e.ship, ms: e.success ? Infinity : END_MS };
        } else if (e.type === "ended") {
          const mid = { x: this.gx + (this.cols * this.cell) / 2, y: this.gy + (this.rows * this.cell) / 2 };
          const win = e.outcome === "boarded" || e.outcome === "crippled";
          // Good news is cream, a fight lost is red, one that just stopped is quiet.
          this.popup(mid.x, mid.y, this.opts.labels.outcome(e.outcome), win ? COLORS.cream : e.outcome === "broke_off" || e.outcome === "disengaged" ? COLORS.dim : COLORS.danger, 1.1, 2600);
          if (win) {
            // The beat. The hit and the boarding flown in one plot is the bigger moment.
            const turn = state.lastTurn?.events ?? [];
            const together = e.outcome === "boarded" && turn.some((x) => x.type === "shot" && x.ship === 0 && x.hit);
            this.beat(together ? 1 : 0.6);
          }
          this.snap(state);
          // A wrecked ship shrinks to nothing.
          const wrecked = e.outcome === "crippled" ? this.ships[1] : e.outcome === "crippled_by" ? this.ships[0] : null;
          if (wrecked) wrecked.sink = this.reduced ? MOTION.clear : 0;
        }
        this.cb.onEvents([e]);
      },
    };
  }

  private hurt(ship: ShipIndex, damage: number): void {
    const v = this.ships[ship];
    v.damage = Math.min(BATTLE_PERMILLE, v.damage + damage);
    v.flash = STRUCK_MS;
  }

  /** Ask for the beat. A stronger moment while one is playing takes it over; it never stacks. */
  private beat(strength: number): void {
    this.beatNow = { life: 0, strength: Math.max(strength, this.beatNow?.strength ?? 0) };
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
    // Nothing frames the chart, so the cells get all of the room but the hairline.
    const sized = (availW: number, availH: number): void => {
      this.cell = Math.max(8, Math.floor(Math.min((availW - 2) / this.cols, (availH - 2) / this.rows)));
    };
    if (this.vertical) {
      // The grid takes what it needs under a strip of the smallest size; the strip then grows into
      // the height the grid left over, so its buttons are as big as a thumb wants.
      const minStrip = Math.max(156, Math.min(216, H * 0.3));
      const availW = W - gutter * 2;
      sized(availW, H - hudH - minStrip - gutter * 3);
      const gridH = this.rows * this.cell + 2;
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
    // The chart turns about its own middle, so the beat swells it in place.
    const midX = this.gx + (this.cols * this.cell) / 2;
    const midY = this.gy + (this.rows * this.cell) / 2;
    this.world.pivot.set(midX, midY);
    this.world.position.set(midX, midY);
    this.app.canvas.setAttribute("data-geom", `${this.gx},${this.gy},${this.cell}`);
    this.bake();
    this.drawChart();
    this.placeTerrain();
    if (this.state) this.snap(this.state);
    this.drawPreview();
    this.drawHud();
    this.stripDirty = true;
  }

  /** Paint every pictogram for this cell size, once (docs/BRAND.md section 3). */
  private bake(): void {
    const key = `${this.cell}`;
    if (key === this.bakedKey) return;
    this.bakedKey = key;
    const r = this.app.renderer.resolution;
    // Sprites go before their textures, so nothing is destroyed while still bound.
    if (this.shipSprites) for (const s of this.shipSprites) s.destroy();
    this.shipSprites = null;
    for (const s of this.ghostSprites) s?.destroy();
    this.ghostSprites = [];
    for (const e of this.terrainLayer.removeChildren()) e.destroy();
    for (const p of this.spent) p.s.destroy();
    this.spent = [];
    // Plot-strip gun icons and in-flight shots can still reference the old bake between ticks.
    for (const icon of this.stripIcons.removeChildren()) icon.destroy();
    const oldTextures = [...this.textures.values()];
    this.textures.clear();
    const paint = (name: string, px: number, kind: BattleKind, color: Paint): void => {
      this.textures.set(name, new Texture({ source: new CanvasSource({ resource: kindCanvas(px, kind, color, r), resolution: r }) }));
    };
    const shipPx = Math.ceil(this.cell * SHIP_SCALE);
    paint("ship0", shipPx, "ship", OWN);
    paint("ship1", shipPx, "raider", RAIDER);
    paint("ghost", shipPx, "ghost", OWN);
    paint("asteroid", this.cell, "asteroid", ROCK);
    paint("well", this.cell, "well", WELL);
    paint("current", this.cell, "current", CURRENT);
    const slugPx = Math.max(12, Math.ceil(this.cell * 0.75));
    paint("slug0", slugPx, "slug", OWN);
    paint("slug1", slugPx, "slug", RAIDER);
    paint("slugHit", slugPx, "slug", "danger");
    const iconPx = 28;
    paint("turret", iconPx, "turret", "cream");
    paint("turretOff", iconPx, "turret", "line");
    paint("turretArmed", iconPx, "turretArmed", OWN);
    if (this.step) for (const shot of this.step.shots) shot.ball.texture = this.textures.get(shot.ship === 0 ? "slug0" : shot.hit ? "slugHit" : "slug1")!;
    for (const t of oldTextures) t.destroy(true);
  }

  /**
   * The chart is bare ground inside one hairline: no frame, no grid, no nebula (docs/BRAND.md
   * section 3). A ship is flown by counting cells, so every open cell carries a small dot.
   */
  private drawChart(): void {
    const g = this.chartG;
    g.clear();
    const c = this.cell;
    const W = this.cols * c;
    const H = this.rows * c;
    // The ground is painted, not left clear, so the board is whole wherever it is shown (a thumbnail, a capture).
    g.rect(this.gx, this.gy, W, H).fill(COLORS.ground);
    g.rect(this.gx - 0.5, this.gy - 0.5, W + 1, H + 1).stroke({ width: 1, color: COLORS.line });
    const board = this.state?.board;
    if (!board) return;
    const dot = Math.max(1, c * 0.055);
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        if (battleCellAt(board, x, y)?.kind === "space") g.circle(this.cx(x), this.cy(y), dot).fill(COLORS.line);
      }
    }
  }

  /** Asteroids, gravity wells and solar currents: one pictogram a cell, none of them moving. */
  private placeTerrain(): void {
    for (const e of this.terrainLayer.removeChildren()) e.destroy();
    const board = this.state?.board;
    if (!board) return;
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        const cell = battleCellAt(board, x, y);
        if (!cell || cell.kind === "space") continue;
        const s = new Sprite(this.textures.get(cell.kind) ?? Texture.WHITE);
        s.anchor.set(0.5);
        s.position.set(this.cx(x), this.cy(y));
        // A current points the way it carries; a rock is turned by where it sits, so a field of them is not a stamp.
        if (cell.kind === "current") s.rotation = (cell.heading * Math.PI) / 2;
        else if (cell.kind === "asteroid") s.rotation = (((x * 7 + y * 13) % 4) * Math.PI) / 2;
        this.terrainLayer.addChild(s);
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

  /** A hull bar's colour: the ship's own, until she can be boarded. That is red for the captain and cream, good news, for the raider. */
  private hullColor(who: ShipIndex, damage: number): number {
    const boardable = damage >= (this.state?.config.grappleDamage ?? BATTLE_PERMILLE);
    if (who === 0) return boardable ? COLORS.danger : COLORS.amber;
    return boardable ? COLORS.cream : COLORS.raider;
  }

  private drawShips(): void {
    const g = this.hullG;
    g.clear();
    const c = this.cell;
    const stroke = Math.max(2, c / 12);
    for (const i of [1, 0] as const) {
      const v = this.ships[i];
      const s = this.shipSprite(i);
      s.position.set(v.x, v.y);
      s.rotation = v.rot;
      // A wrecked ship shrinks to nothing.
      const k = v.sink < 0 ? 1 : 1 - easeOutCubic(Math.min(1, v.sink / MOTION.clear));
      s.scale.set(k);
      s.visible = k > 0;
      if (k <= 0) continue;
      // The hull under the ship: a plain bar.
      const w = c * 0.9;
      const h = Math.max(3, Math.round(c * 0.1));
      const bx = v.x - w / 2;
      const by = v.y + c * 0.52;
      const hull = 1 - v.damage / BATTLE_PERMILLE;
      g.roundRect(bx, by, w, h, h / 2).fill(COLORS.line);
      if (hull > 0) g.roundRect(bx, by, Math.max(h, w * hull), h, h / 2).fill(this.hullColor(i, v.damage));
      // Just struck: one ring round her, red when it is the captain's hull.
      if (v.flash > 0) g.circle(v.x, v.y, c * 0.68).stroke({ width: stroke, color: i === 0 ? COLORS.danger : COLORS.cream, alpha: Math.min(1, v.flash / MOTION.move) });
    }
    // A grapple is a line between the two hulls.
    if (this.hook) {
      const a = this.ships[this.hook.ship];
      const b = this.ships[this.hook.ship === 0 ? 1 : 0];
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: stroke, color: this.hook.ship === 0 ? COLORS.amber : COLORS.danger, cap: "round" });
    }
  }

  /**
   * The plot, in amber because it is the captain's: the course as dots, the ship hollow where each
   * move leaves her, numbered, and the cells each plotted broadside reaches as a flat tint. A move
   * that would cost hull is ringed in red. The raider's reach is outlined in its own colour.
   */
  private drawPreview(): void {
    const g = this.ghostG;
    const a = this.arcG;
    g.clear();
    a.clear();
    for (const t of this.ghostTexts) t.destroy();
    this.ghostTexts = [];
    for (const s of this.ghostSprites) if (s) s.visible = false;
    const s = this.state;
    if (!s || s.finished) return;
    // Every segment is previewed, plotted or not: a current carries a ship that holds, too.
    const course = previewBattleCourse(s, this.segments);
    const c = this.cell;
    const stroke = Math.max(2, c / 12);
    let prev: Pose = { x: s.ships[0].x, y: s.ships[0].y, heading: s.ships[0].heading };
    this.segments.forEach((seg, i) => {
      const step = course[i];
      if (!step) return;
      const p = step.pose;
      if (this.opts.showArcs) {
        for (const side of ["port", "starboard"] as const) {
          if (!seg[side]) continue;
          for (const cell of battleArcCells(s.board, p, side, s.config.turretRange)) {
            a.roundRect(this.gx + cell.x * c + 2, this.gy + cell.y * c + 2, c - 4, c - 4, c * 0.18).fill(COLORS.arc);
          }
        }
      }
      const moved = p.x !== prev.x || p.y !== prev.y;
      if (seg.move !== null || moved) {
        const x0 = this.cx(prev.x);
        const y0 = this.cy(prev.y);
        const x1 = this.cx(p.x);
        const y1 = this.cy(p.y);
        if (moved) for (const t of [0.3, 0.5, 0.7]) g.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, Math.max(1.2, c * 0.06)).fill(COLORS.amber);
        // The ghosts along the way are small so the course reads; the last stands at nearly full size.
        const final = !course.slice(i + 1).some((later, k) => later.pose.x !== p.x || later.pose.y !== p.y || this.segments[i + 1 + k]?.move != null);
        let ghost = this.ghostSprites[i];
        if (!ghost) {
          ghost = new Sprite(this.textures.get("ghost") ?? Texture.WHITE);
          ghost.anchor.set(0.5);
          this.ghostLayer.addChild(ghost);
          this.ghostSprites[i] = ghost;
        }
        ghost.visible = true;
        ghost.scale.set(final ? 0.86 : 0.6);
        ghost.position.set(x1, y1);
        ghost.rotation = (p.heading * Math.PI) / 2;
        // The segment's number rides off the ship's quarter. A segment that costs hull (an
        // asteroid, a ram) or is stopped is ringed, and its number is red.
        const bad = step.damage > 0 || step.blocked !== null;
        if (bad) g.circle(x1, y1, c * 0.56).stroke({ width: stroke, color: COLORS.danger });
        const t = new Text({
          text: String(i + 1),
          style: { fontFamily: FONT.mono, fontSize: Math.max(10, c * 0.44), fontWeight: "700", fill: bad ? COLORS.danger : COLORS.amber, stroke: { color: COLORS.ground, width: 3, join: "round" } },
          resolution: 2,
        });
        t.anchor.set(0.5);
        t.position.set(x1 + c * 0.44, y1 - c * 0.44);
        this.ghostLayer.addChild(t);
        this.ghostTexts.push(t);
      }
      prev = p;
    });
    // Where the raider's guns reach from where it stands. A cell the captain's ship is standing in is red.
    if (this.opts.showArcs && s.ships[1].loaded > 0) {
      const them: Pose = { x: s.ships[1].x, y: s.ships[1].y, heading: s.ships[1].heading };
      for (const side of ["port", "starboard"] as const) {
        for (const cell of battleArcCells(s.board, them, side, s.config.turretRange)) {
          const mine = cell.x === s.ships[0].x && cell.y === s.ships[0].y;
          a.roundRect(this.gx + cell.x * c + 4, this.gy + cell.y * c + 4, c - 8, c - 8, c * 0.16).stroke({ width: mine ? 2 : 1.5, color: mine ? COLORS.danger : COLORS.raider });
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
    const fs = Math.max(11, Math.min(13, h * 0.3));
    const barH = Math.max(6, Math.round(h * 0.18));
    const panels: Array<{ px: number; who: ShipIndex; label: string }> = [
      { px: x, who: 0, label: this.opts.labels.you },
      { px: x + half + 8, who: 1, label: this.opts.labels.raider },
    ];
    for (const p of panels) {
      const ship = s.ships[p.who];
      const hull = 1 - ship.damage / BATTLE_PERMILLE;
      const own = p.who === 0 ? COLORS.amber : COLORS.raider;
      g.roundRect(p.px, y + 2, half, h - 4, RADIUS).fill(COLORS.raised);
      const name = new Text({ text: p.label, style: { fontFamily: FONT.body, fontSize: fs, fontWeight: "700", fill: own }, resolution: 2 });
      name.position.set(p.px + 10, y + 6);
      this.hudTexts.addChild(name);
      const percent = new Text({ text: `${Math.round(hull * 100)}%`, style: { fontFamily: FONT.mono, fontSize: fs, fontWeight: "700", fill: COLORS.cream }, resolution: 2 });
      percent.anchor.set(1, 0);
      percent.position.set(p.px + half - 10, y + 6);
      this.hudTexts.addChild(percent);
      const hullText = new Text({ text: this.opts.labels.hull, style: { fontFamily: FONT.body, fontSize: fs, fill: COLORS.dim }, resolution: 2 });
      hullText.anchor.set(1, 0);
      hullText.position.set(percent.x - percent.width - 5, y + 6);
      this.hudTexts.addChild(hullText);
      // A plain bar for the hull, and a dot for each turret, lit when it is loaded.
      const bx = p.px + 10;
      const by = y + h - barH - 7;
      const lampW = ship.turrets > 0 ? ship.turrets * (barH + 4) + 8 : 0;
      const bw = half - 20 - lampW;
      g.roundRect(bx, by, bw, barH, barH / 2).fill(COLORS.ground);
      if (hull > 0) g.roundRect(bx, by, Math.max(barH, bw * hull), barH, barH / 2).fill(this.hullColor(p.who, ship.damage));
      for (let i = 0; i < ship.turrets; i++) {
        g.circle(bx + bw + 8 + i * (barH + 4) + barH / 2, by + barH / 2, barH / 2).fill(i < ship.loaded ? own : COLORS.line);
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
    g.roundRect(x, y, w, h, RADIUS).fill(COLORS.raised);
    const me = s.ships[0];
    const n = s.config.segments;
    const live = this.interactive && !s.finished;
    const fs = Math.max(11, Math.min(13, this.vertical ? h * 0.075 : w * 0.055));
    const label = (text: string, tx: number, ty: number, color = COLORS.cream, size = fs, anchorX = 0.5, face: "body" | "mono" = "body", weight: "400" | "700" = "700"): Text => {
      const t = new Text({ text, style: { fontFamily: FONT[face], fontSize: size, fontWeight: weight, fill: color }, resolution: 2 });
      t.anchor.set(anchorX, 0.5);
      t.position.set(tx, ty);
      this.stripTexts.addChild(t);
      return t;
    };
    // A button on the panel is the panel's colour inside a hairline; the one that goes on is amber;
    // a toggle that is on is ground inside an amber ring. A press shows for a moment as a flat change.
    const button = (id: string, bx: number, by: number, bw: number, bh: number, kind: "go" | "plain" | "on", enabled: boolean): void => {
      const down = this.pressed?.id === id;
      const r = Math.min(RADIUS, bh / 2);
      if (kind === "go") g.roundRect(bx, by, bw, bh, r).fill(enabled ? (down ? COLORS.cream : COLORS.amber) : COLORS.line);
      else if (kind === "on") g.roundRect(bx + 1, by + 1, bw - 2, bh - 2, r).fill(COLORS.ground).stroke({ width: 2, color: COLORS.amber });
      else g.roundRect(bx, by, bw, bh, r).fill(down ? COLORS.line : COLORS.raised).stroke({ width: 1, color: COLORS.line });
      if (enabled) this.buttons.push({ id, x: bx, y: by, w: bw, h: bh });
    };
    // Turn clock: a plain bar, red in its last quarter.
    const top = y + 10;
    label(this.opts.labels.turn(s.turn + 1, s.config.maxTurns), x + 12, top + fs * 0.6, COLORS.dim, fs, 0, "body", "400");
    const clockW = w - 24;
    const clockY = top + fs * 1.5;
    g.roundRect(x + 12, clockY, clockW, 5, 2.5).fill(COLORS.ground);
    if (this.turnLeftMs !== null && live) {
      const k = Math.max(0, Math.min(1, this.turnLeftMs / this.turnMs));
      g.roundRect(x + 12, clockY, Math.max(5, clockW * k), 5, 2.5).fill(k < 0.25 ? COLORS.danger : COLORS.cream);
    }
    // Slots. On a tall board each is a card: the move on top, its two guns side by side beneath,
    // each half the card wide. On a wide board each is a row with a gun at either end.
    const slotTop = clockY + 14;
    const gap = 6;
    const tall = this.vertical;
    // What the strip has left for slots, tokens and the bottom row, shared out between them.
    const spare = Math.max(96, y + h - slotTop - 20 - fs * 1.6);
    let trayH = tall ? Math.max(30, Math.min(50, spare * 0.25)) : 38;
    let rowH = tall ? Math.max(32, Math.min(54, spare * 0.28)) : 42;
    /** On a wide board too short for the strip, everything in it is squeezed by this much so Fly stays on it. */
    let squeeze = 1;
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
      const natural = n * (slotH + gap) + 12 + trayH + 10 + rowH + 10 + rowH + 10;
      squeeze = Math.min(1, (y + h - slotTop) / natural);
      slotH *= squeeze;
      trayH *= squeeze;
      rowH *= squeeze;
      const pitch = slotH + gap * squeeze;
      slotX = () => x + 12;
      slotY = (i) => slotTop + i * pitch;
    }
    const gunW = tall ? (slotW - 9) / 2 : Math.max(28, Math.min(48, slotW * 0.22));
    const gunH = tall ? Math.max(24, Math.min(46, slotH * 0.42)) : slotH - 4;
    for (let i = 0; i < n; i++) {
      const seg = this.segments[i] ?? { move: null, port: false, starboard: false };
      const sx = slotX(i);
      const sy = slotY(i);
      const sel = this.selected === i && live;
      g.roundRect(sx, sy, slotW, slotH, 8).fill(COLORS.ground);
      // The slot the next token goes in wears the selection: an amber ring just off it.
      if (sel) g.roundRect(sx - 2, sy - 2, slotW + 4, slotH + 4, 10).stroke({ width: 2, color: COLORS.amber });
      // The move's own area: the card above the guns, or the row between them. Nothing overlaps.
      const move = tall ? { x: sx, y: sy, w: slotW, h: slotH - gunH - 3 } : { x: sx + gunW + 3, y: sy, w: slotW - gunW * 2 - 6, h: slotH };
      if (live) this.buttons.push({ id: `slot:${i}`, ...move });
      const midX = move.x + move.w / 2;
      const midY = move.y + move.h / 2;
      // The move's glyph, amber once it is plotted.
      this.paintToken(g, seg.move, midX, midY, Math.min(move.h * 0.62, move.w * 0.5, 34), seg.move === null ? COLORS.line : COLORS.amber);
      label(String(i + 1), move.x + 7, sy + fs * 0.75, COLORS.dim, fs - 1, 0, "mono");
      // Port and starboard guns: a turret each. An armed one is amber and has a slug leaving it.
      for (const side of ["port", "starboard"] as const) {
        const bx = side === "port" ? sx + 3 : sx + slotW - gunW - 3;
        const by = tall ? sy + slotH - gunH - 3 : sy + 2;
        const on = seg[side];
        const can = live && (on || me.loaded > this.shotsPlanned());
        if (on) g.roundRect(bx + 1, by + 1, gunW - 2, gunH - 2, 6).fill(COLORS.raised).stroke({ width: 1.5, color: COLORS.amber });
        else if (can) g.roundRect(bx, by, gunW, gunH, 7).fill(COLORS.raised);
        const icon = new Sprite(this.textures.get(on ? "turretArmed" : can ? "turret" : "turretOff") ?? Texture.WHITE);
        icon.anchor.set(0.5);
        const ip = Math.min(gunW, gunH, 30) * 0.9;
        icon.width = ip;
        icon.height = ip;
        icon.position.set(bx + gunW / 2, by + gunH / 2);
        icon.rotation = side === "port" ? -Math.PI / 2 : Math.PI / 2;
        this.stripIcons.addChild(icon);
        // The whole of the gun's end of the slot takes the tap, out to the slot's edge.
        if (can) this.buttons.push(tall ? { id: `fire:${i}:${side}`, x: side === "port" ? sx : sx + slotW / 2, y: by - 1, w: slotW / 2, h: gunH + 4 } : { id: `fire:${i}:${side}`, x: side === "port" ? sx : bx - 1, y: sy, w: gunW + 4, h: slotH });
      }
    }
    // Tokens tray.
    const trayY = tall ? slotTop + slotH + 10 : slotY(n - 1) + slotH + 12 * squeeze;
    const trayItems: Array<MoveToken | null> = ["left", "forward", "right", null];
    const trayW = (w - 24 - gap * 3) / 4;
    const placing = this.selected >= 0;
    trayItems.forEach((t, i) => {
      const bx = x + 12 + i * (trayW + gap);
      const count = t === null ? null : me.tokens[t];
      const enabled = live && placing && (t === null || (count ?? 0) > this.tokensPlanned(t) - (this.segments[this.selected]?.move === t ? 1 : 0));
      button(`token:${t ?? "hold"}`, bx, trayY, trayW, trayH, "plain", enabled);
      const ink = enabled ? COLORS.cream : COLORS.dim;
      this.paintToken(g, t, bx + trayW * 0.32, trayY + trayH / 2, Math.min(trayH * 0.52, 26), ink);
      if (t !== null && count !== null) label(`×${count - this.tokensPlanned(t)}`, bx + trayW * 0.72, trayY + trayH / 2, ink, fs, 0.5, "mono");
      else label(this.opts.labels.hold, bx + trayW * 0.7, trayY + trayH / 2, ink, fs - 1, 0.5, "body", "400");
    });
    // Grapple, clear, fly.
    const rowY = trayY + trayH + 10 * squeeze;
    const ready = s.ships[1].damage >= s.config.grappleDamage;
    const plotted = this.segments.some((seg) => seg.move !== null || seg.port || seg.starboard);
    // On a wide board the strip is narrow and tall: fly gets a row of its own under the others.
    const inner = w - 24 - gap * (tall ? 3 : 2);
    const gw = inner * (tall ? 0.3 : 0.46);
    button("grapple", x + 12, rowY, gw, rowH, this.grapple ? "on" : "plain", live);
    // She can be boarded: good news, so the button's hairline turns cream.
    if (ready && live && !this.grapple) g.roundRect(x + 12, rowY, gw, rowH, Math.min(RADIUS, rowH / 2)).stroke({ width: 1, color: COLORS.cream });
    const hookInk = this.grapple ? COLORS.amber : live ? COLORS.cream : COLORS.dim;
    this.paintHook(g, x + 12 + fs * 1.3, rowY + rowH / 2, fs * 0.9, hookInk);
    label(this.opts.labels.grapple, x + 12 + fs * 2.3, rowY + rowH / 2, hookInk, fs - 1, 0);
    // Take back the last move, or the whole plot.
    const uw = tall ? Math.max(rowH, inner * 0.13) : inner * 0.24;
    const ux = x + 12 + gw + gap;
    const backInk = live && plotted ? COLORS.cream : COLORS.dim;
    button("undo", ux, rowY, uw, rowH, "plain", live && plotted);
    this.paintBackspace(g, ux + uw / 2, rowY + rowH / 2, fs * 1.1, backInk);
    const cx = ux + uw + gap;
    const cw = tall ? inner * 0.17 : x + w - 12 - cx;
    button("clear", cx, rowY, cw, rowH, "plain", live && plotted);
    label(this.opts.labels.clear, cx + cw / 2, rowY + rowH / 2, backInk, fs - 1, 0.5, "body", "400");
    const sx = tall ? cx + cw + gap : x + 12;
    const sy = tall ? rowY : rowY + rowH + 10 * squeeze;
    const sw = x + w - 12 - sx;
    const sh = tall ? rowH : Math.max(rowH, Math.min(52, y + h - sy - 12 - fs * 2));
    const noteY = sy + sh + fs;
    button("fly", sx, sy, sw, sh, "go", live);
    label(this.opts.labels.fly, sx + sw / 2, sy + sh / 2, live ? COLORS.ground : COLORS.dim, fs + (tall ? 0 : 1));
    if (ready && live && noteY + fs * 0.6 < y + h) label(this.opts.labels.grappleReady, x + w / 2, noteY, COLORS.cream, fs - 1, 0.5, "body", "400");
    // Where the strip's buttons are, for the smoke test's taps.
    this.app.canvas.setAttribute("data-buttons", this.buttons.map((b) => `${b.id}=${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(";"));
  }

  /**
   * A move token: forward is a straight arrow; a turn runs up a short shaft, sweeps through a
   * quarter circle and ends in a head pointing the new way. One stroke weight and one head shape
   * for all three, so they read as a set. A hold is a ring with a dot in it.
   */
  private paintToken(g: Graphics, t: MoveToken | null, x: number, y: number, size: number, color: number): void {
    const r = size * 0.5;
    const width = Math.max(2, size * 0.16);
    const head = r * 0.42;
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
    if (this.flyGuard > 0) this.flyGuard -= dt;
    if (this.pressed) {
      this.pressed.t += dt;
      if (this.pressed.t > MOTION.move) this.pressed = null;
      this.stripDirty = true;
    }
    if (!this.step && this.queue.length) {
      this.step = this.queue.shift()!;
      this.stepT = 0;
      this.step.begin();
    }
    if (this.step) {
      this.stepT += dt;
      const k = Math.min(1, this.stepT / this.step.ms);
      // Eased out, never past the mark: nothing bounces (docs/BRAND.md section 6).
      const ease = 1 - (1 - k) ** 2;
      for (const tw of this.step.tweens) {
        const v = this.ships[tw.ship];
        v.x = tw.from.x + (tw.to.x - tw.from.x) * ease;
        v.y = tw.from.y + (tw.to.y - tw.from.y) * ease;
        v.rot = tw.from.rot + (tw.to.rot - tw.from.rot) * ease;
      }
      // Slugs fly straight down their line: the flight is the shot's path.
      for (const sh of this.step.shots) sh.ball.position.set(sh.from.x + (sh.to.x - sh.from.x) * k, sh.from.y + (sh.to.y - sh.from.y) * k);
      if (k >= 1) {
        for (const tw of this.step.tweens) {
          const v = this.ships[tw.ship];
          v.x = tw.to.x;
          v.y = tw.to.y;
          v.rot = tw.to.rot;
        }
        // Shots land as the step ends: a hit rings the ship it struck, a miss shrinks to nothing.
        for (const sh of this.step.shots) {
          if (sh.hit) {
            sh.ball.destroy();
            this.hurt(sh.ship === 0 ? 1 : 0, this.state?.config.shotDamage ?? 0);
            this.popup(sh.to.x, sh.to.y - this.cell * 0.9, sh.ship === 0 ? this.opts.labels.hit : this.opts.labels.hitTaken, sh.ship === 0 ? COLORS.cream : COLORS.danger, 0.6);
            // A whole volley landed in one turn is the beat.
            if (sh.ship === 0 && ++this.turnHits === VOLLEY_HITS) this.beat(0.4);
          } else {
            this.popup(sh.to.x, sh.to.y - this.cell * 0.7, this.opts.labels.miss, COLORS.dim, 0.35);
            if (this.reduced) sh.ball.destroy();
            else this.spent.push({ s: sh.ball, life: 0 });
          }
        }
        this.step = null;
        if (this.queue.length === 0 && this.state) {
          this.snap(this.state);
          this.drawPreview();
        }
      }
    }
    for (const v of this.ships) {
      if (v.flash > 0) v.flash -= dt;
      if (v.sink >= 0 && v.sink < MOTION.clear) v.sink = Math.min(MOTION.clear, v.sink + dt);
    }
    if (this.hook && Number.isFinite(this.hook.ms)) {
      this.hook.ms -= dt;
      if (this.hook.ms <= 0) this.hook = null;
    }
    this.drawShips();
    this.spent = this.spent.filter((p) => {
      p.life += dt;
      const k = p.life / MOTION.clear;
      if (k >= 1) {
        p.s.destroy();
        return false;
      }
      p.s.scale.set(1 - easeOutCubic(k));
      return true;
    });
    // Popups rise a little and fade.
    this.popups = this.popups.filter((p) => {
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        p.t.destroy();
        return false;
      }
      p.t.y = p.y0 - (this.reduced ? 0 : easeOutCubic(k) * this.cell * 0.8);
      p.t.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      return true;
    });
    this.drawBeat(dt);
    if (this.stripDirty) this.drawStrip();
    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
    }
  }

  /**
   * The beat: the whole chart pulses once in amber and swells a hair, in `MOTION.beat`. Reduced
   * motion keeps it as a still flash.
   */
  private drawBeat(dt: number): void {
    const g = this.beatLayer;
    g.clear();
    const b = this.beatNow;
    if (!b) return;
    b.life += dt;
    const t = b.life / MOTION.beat;
    if (t >= 1) {
      this.beatNow = null;
      this.world.scale.set(1);
      return;
    }
    // Up in the first quarter, down over the rest.
    const env = this.reduced ? 1 : t < 0.25 ? easeOutCubic(t / 0.25) : 1 - easeOutCubic((t - 0.25) / 0.75);
    g.rect(this.gx, this.gy, this.cols * this.cell, this.rows * this.cell).fill({ color: COLORS.amber, alpha: (0.14 + 0.16 * b.strength) * env });
    this.world.scale.set(this.reduced ? 1 : 1 + 0.012 * b.strength * env);
  }

  private popup(x: number, y: number, text: string, color: number, scale: number, max = 1100): void {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT.body,
        fontSize: Math.max(12, this.cell * 0.9 * scale),
        fontWeight: "700",
        fill: color,
        // A ground edge keeps the words readable over a ship or a rock.
        stroke: { color: COLORS.ground, width: 3, join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    const margin = t.width / 2 + 4;
    t.position.set(Math.min(Math.max(x, this.gx + margin), this.gx + this.cols * this.cell - margin), Math.max(y, this.gy + t.height / 2));
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max, y0: t.y });
  }
}
