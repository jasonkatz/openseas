import { Application, Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import {
  BATTLE_PERMILLE,
  battleArcCells,
  battleCellAt,
  battlePlanIllegalReason,
  previewBattlePlan,
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

export interface BattleCallbacks {
  /** The captain sailed the plot: by the button, the key, or the host's turn clock. */
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
    brigand: string;
    hull: string;
    loaded: string;
    turn(turn: number, max: number): string;
    slot(n: number): string;
    hold: string;
    token(t: MoveToken): string;
    port: string;
    starboard: string;
    grapple: string;
    sail: string;
    clear: string;
    hit: string;
    hitTaken: string;
    miss: string;
    rocks: string;
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
}

interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLORS = {
  sea: 0x0d2b45,
  seaLight: 0x154266,
  grid: 0x1f4f78,
  rock: 0x3d3a44,
  rockLight: 0x5a5663,
  wind: 0x7fd7ff,
  eddy: 0x9ad7c6,
  you: 0xefe3c6,
  youTrim: 0xd4a548,
  brigand: 0x1b1a22,
  brigandTrim: 0xf0604d,
  arc: 0xf5d58a,
  arcEnemy: 0xf0604d,
  ghost: 0xefe3c6,
  good: 0x6fdc8c,
  danger: 0xf0604d,
  brass: 0xd4a548,
  brassLight: 0xf5d58a,
  ink: 0x070e1a,
  inkGlass: 0x121a2b,
  text: 0xefe3c6,
  muted: 0x9aa7bd,
  flash: 0xfff3c4,
  smoke: 0x8a93a3,
  splash: 0x9fd8ff,
};
const MOVE_MS = 420;
const PUSH_MS = 300;
const SPIN_MS = 260;
const SHOT_MS = 360;
const END_MS = 900;
const FONT = "Atkinson Hyperlegible, sans-serif";
const DISPLAY = "Fraunces, Georgia, serif";

const TOKENS: readonly MoveToken[] = ["left", "forward", "right"];

/** What the board shows, for the smoke test: both ships, the turn and the outcome. */
export function battleViewString(state: BattleState): string {
  const ships = state.ships.map((s) => `${s.x}.${s.y}.${s.heading}.${s.damage}.${s.loaded}`).join("|");
  return `${state.turn}:${ships}:${state.outcome ?? "-"}`;
}

export class BattleRenderer {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly staticLayer = new Container();
  private readonly seaG = new Graphics();
  private readonly arcG = new Graphics();
  private readonly ghostG = new Graphics();
  private readonly shipG = new Graphics();
  private readonly fxG = new Graphics();
  private readonly hudG = new Graphics();
  private readonly stripG = new Graphics();
  private readonly textLayer = new Container();
  private readonly stripTexts = new Container();
  private readonly hudTexts = new Container();
  private readonly fxLayer = new Container();
  private state: BattleState | null = null;
  private ships: [ShipView, ShipView] = [
    { x: 0, y: 0, rot: 0, damage: 0, flash: 0 },
    { x: 0, y: 0, rot: Math.PI, damage: 0, flash: 0 },
  ];
  private shownTurn = -1;
  private shownOutcome: BattleOutcome | null = null;
  private queue: Step[] = [];
  private step: Step | null = null;
  private stepT = 0;
  private popups: Popup[] = [];
  private particles: Particle[] = [];
  private segments: BattleSegment[] = [];
  private grapple = false;
  private selected = 0;
  private buttons: Button[] = [];
  private pressed: { id: string; t: number } | null = null;
  private interactive = false;
  private framePending = false;
  private destroyed = false;
  private shake = 0;
  private endFlash = 0;
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

  constructor(
    private readonly host: HTMLElement,
    private readonly cb: BattleCallbacks,
    private readonly opts: BattleRendererOptions,
  ) {}

  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "battle-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    this.staticLayer.addChild(this.seaG);
    this.world.addChild(this.staticLayer, this.arcG, this.ghostG, this.shipG, this.fxG, this.fxLayer, this.textLayer);
    this.app.stage.addChild(this.world, this.hudG, this.hudTexts, this.stripG, this.stripTexts);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((ticker) => this.tick(Math.min(50, ticker.deltaMS)));
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app.renderer) this.app.destroy(true, { children: true });
  }

  setInteractive(on: boolean): void {
    if (this.interactive === on) return;
    this.interactive = on;
    this.stripDirty = true;
  }

  setShowMarks(on: boolean): void {
    if (this.opts.showMarks === on) return;
    this.opts.showMarks = on;
    this.drawShips();
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
    const segs = this.segments.slice();
    while (segs.length && segs[segs.length - 1]!.move === null && !segs[segs.length - 1]!.port && !segs[segs.length - 1]!.starboard) segs.pop();
    return { segments: segs, grapple: this.grapple };
  }

  /** Sail the plot now, as the turn clock does. Refused while the engine would refuse it (then holds are sailed instead). */
  commit(): void {
    const s = this.state;
    if (!s || s.finished) return;
    let plan = this.plan();
    if (battlePlanIllegalReason(s, plan) !== null) plan = { segments: [], grapple: this.grapple };
    this.cb.onCommit(plan);
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
      this.step = null;
      this.popups.forEach((p) => p.t.destroy());
      this.popups = [];
      this.particles = [];
      this.snap(state);
      this.shownTurn = state.turn;
      this.shownOutcome = state.outcome;
      this.resetPlan(state);
    } else if (state.turn > this.shownTurn && state.lastTurn) {
      this.enqueueTurn(state, state.lastTurn.events);
      this.shownTurn = state.turn;
      this.shownOutcome = state.outcome;
      this.resetPlan(state);
    } else if (state.finished && this.shownOutcome !== state.outcome && state.lastTurn) {
      // Ended without a turn: a disengage, or the ship's hull gave out.
      this.enqueueTurn(state, state.lastTurn.events);
      this.shownOutcome = state.outcome;
    } else {
      // Supply arrived, or the same turn re-rendered: keep the plot, refresh what it can afford.
      if (this.queue.length === 0 && !this.step) this.snap(state);
      this.stripDirty = true;
    }
    this.drawPreview();
    this.drawHud();
    this.app.canvas.setAttribute("data-view", battleViewString(state));
  }

  private resetPlan(state: BattleState): void {
    this.segments = Array.from({ length: state.config.segments }, () => ({ move: null, port: false, starboard: false }));
    this.selected = 0;
    this.stripDirty = true;
    this.cb.onPlanChange(this.plan());
  }

  private snap(state: BattleState): void {
    for (const i of [0, 1] as const) {
      const s = state.ships[i];
      this.ships[i] = { x: this.cx(s.x), y: this.cy(s.y), rot: (s.heading * Math.PI) / 2, damage: s.damage, flash: 0 };
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
            this.popup(this.cx(e.to.x), this.cy(e.to.y) - this.cell * 0.9, this.opts.labels.spun, COLORS.eddy, 0.4);
            continue;
          }
          if (e.type !== "move" && e.type !== "push") continue;
          if (e.type === "push" && !e.blocked) this.popup(this.cx(e.to.x), this.cy(e.to.y) - this.cell * 0.9, this.opts.labels.blown, COLORS.wind, 0.4);
          if (e.damage > 0) {
            this.hurt(e.ship, e.damage);
            const t = e.blocked === "ship" ? this.opts.labels.rammed : this.opts.labels.rocks;
            this.popup(this.cx(e.to.x), this.cy(e.to.y) - this.cell * 1.2, t, COLORS.danger, 0.55);
            this.shake = Math.max(this.shake, 260);
            this.burst(this.cx(e.to.x), this.cy(e.to.y), COLORS.smoke, 8, 0.7);
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
          step.shots.push({ from: { x: v.x, y: v.y }, to, hit: e.hit, ship: e.ship });
          this.burst(v.x, v.y, COLORS.flash, 5, 0.5);
          this.burst(v.x, v.y, COLORS.smoke, 6, 0.6);
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

  // ---- geometry

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
    const hudH = Math.max(34, Math.min(48, H * 0.08));
    this.vertical = H > W * 1.05;
    const pad = 6;
    if (this.vertical) {
      const stripH = Math.max(150, Math.min(210, H * 0.3));
      const availW = W - pad * 2;
      const availH = H - hudH - stripH - pad * 3;
      this.cell = Math.max(8, Math.floor(Math.min(availW / this.cols, availH / this.rows)));
      this.gx = Math.floor((W - this.cols * this.cell) / 2);
      this.gy = hudH + pad + Math.floor((availH - this.rows * this.cell) / 2);
      this.hud = { x: pad, y: 0, w: W - pad * 2, h: hudH };
      this.strip = { x: pad, y: H - stripH - pad, w: W - pad * 2, h: stripH };
    } else {
      const stripW = Math.max(190, Math.min(260, W * 0.3));
      const availW = W - stripW - pad * 3;
      const availH = H - hudH - pad * 2;
      this.cell = Math.max(8, Math.floor(Math.min(availW / this.cols, availH / this.rows)));
      this.gx = pad + Math.floor((availW - this.cols * this.cell) / 2);
      this.gy = hudH + pad + Math.floor((availH - this.rows * this.cell) / 2);
      this.hud = { x: pad, y: 0, w: availW, h: hudH };
      this.strip = { x: W - stripW - pad, y: pad, w: stripW, h: H - pad * 2 };
    }
    this.app.canvas.setAttribute("data-geom", `${this.gx},${this.gy},${this.cell}`);
    this.drawSea();
    if (this.state) this.snap(this.state);
    this.drawPreview();
    this.drawHud();
    this.stripDirty = true;
  }

  // ---- static board

  private drawSea(): void {
    const g = this.seaG;
    g.clear();
    const w = this.cols * this.cell;
    const h = this.rows * this.cell;
    g.roundRect(this.gx - 3, this.gy - 3, w + 6, h + 6, 8).fill(COLORS.ink);
    g.rect(this.gx, this.gy, w, h).fill(COLORS.sea);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if ((x + y) % 2 === 0) g.rect(this.gx + x * this.cell, this.gy + y * this.cell, this.cell, this.cell).fill({ color: COLORS.seaLight, alpha: 0.35 });
      }
    }
    for (let x = 0; x <= this.cols; x++) g.moveTo(this.gx + x * this.cell, this.gy).lineTo(this.gx + x * this.cell, this.gy + h).stroke({ width: 1, color: COLORS.grid, alpha: 0.5 });
    for (let y = 0; y <= this.rows; y++) g.moveTo(this.gx, this.gy + y * this.cell).lineTo(this.gx + w, this.gy + y * this.cell).stroke({ width: 1, color: COLORS.grid, alpha: 0.5 });
    const board = this.state?.board;
    if (!board) return;
    const c = this.cell;
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        const cell = battleCellAt(board, x, y);
        if (!cell) continue;
        const px = this.cx(x);
        const py = this.cy(y);
        if (cell.kind === "rock") {
          const r = c * 0.46;
          g.poly([px - r, py + r * 0.6, px - r * 0.6, py - r * 0.5, px - r * 0.1, py - r, px + r * 0.5, py - r * 0.7, px + r, py + r * 0.2, px + r * 0.6, py + r, px - r * 0.5, py + r]).fill(COLORS.rock);
          g.poly([px - r * 0.6, py - r * 0.5, px - r * 0.1, py - r, px + r * 0.5, py - r * 0.7, px + r * 0.2, py - r * 0.1, px - r * 0.3, py]).fill({ color: COLORS.rockLight, alpha: 0.7 });
        } else if (cell.kind === "wind") {
          const ang = (cell.heading * Math.PI) / 2;
          const len = c * 0.36;
          for (const k of [-1, 1]) {
            const ox = Math.cos(ang + Math.PI / 2) * c * 0.16 * k;
            const oy = Math.sin(ang + Math.PI / 2) * c * 0.16 * k;
            const tx = px + ox + Math.cos(ang - Math.PI / 2) * len;
            const ty = py + oy + Math.sin(ang - Math.PI / 2) * len;
            const bx = px + ox - Math.cos(ang - Math.PI / 2) * len * 0.5;
            const by = py + oy - Math.sin(ang - Math.PI / 2) * len * 0.5;
            g.moveTo(bx, by).lineTo(tx, ty).stroke({ width: Math.max(1.5, c * 0.07), color: COLORS.wind, alpha: 0.75 });
            const hx = Math.cos(ang - Math.PI / 2);
            const hy = Math.sin(ang - Math.PI / 2);
            g.moveTo(tx - hx * c * 0.14 + hy * c * 0.12, ty - hy * c * 0.14 - hx * c * 0.12)
              .lineTo(tx, ty)
              .lineTo(tx - hx * c * 0.14 - hy * c * 0.12, ty - hy * c * 0.14 + hx * c * 0.12)
              .stroke({ width: Math.max(1.5, c * 0.07), color: COLORS.wind, alpha: 0.75 });
          }
        } else if (cell.kind === "eddy") {
          let r = c * 0.42;
          let a = 0;
          g.moveTo(px + r, py);
          for (let i = 1; i <= 28; i++) {
            a = (i / 28) * Math.PI * 3;
            r = c * 0.42 * (1 - i / 32);
            g.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
          }
          g.stroke({ width: Math.max(1.5, c * 0.07), color: COLORS.eddy, alpha: 0.8 });
        }
      }
    }
  }

  // ---- ships, preview, arcs

  private drawShips(): void {
    const g = this.shipG;
    g.clear();
    for (const i of [1, 0] as const) {
      const v = this.ships[i];
      this.paintShip(g, v.x, v.y, v.rot, i, 1, v.flash > 0 ? 1 : 0.0);
      // Hull bar under the ship.
      const w = this.cell * 0.9;
      const hull = 1 - v.damage / BATTLE_PERMILLE;
      g.rect(v.x - w / 2, v.y + this.cell * 0.46, w, Math.max(2, this.cell * 0.09)).fill({ color: COLORS.ink, alpha: 0.8 });
      g.rect(v.x - w / 2, v.y + this.cell * 0.46, w * hull, Math.max(2, this.cell * 0.09)).fill(hull > 0.5 ? COLORS.good : COLORS.danger);
    }
  }

  private paintShip(g: Graphics, x: number, y: number, rot: number, who: ShipIndex, alpha: number, flash: number): void {
    const c = this.cell;
    const L = c * 0.42;
    const Wd = c * 0.26;
    const cos = Math.cos(rot - Math.PI / 2);
    const sin = Math.sin(rot - Math.PI / 2);
    const P = (fx: number, fy: number): [number, number] => [x + fx * cos - fy * sin, y + fx * sin + fy * cos];
    const pts = [P(L, 0), P(L * 0.35, Wd), P(-L, Wd * 0.85), P(-L, -Wd * 0.85), P(L * 0.35, -Wd)].flat();
    const fill = flash > 0 ? COLORS.flash : who === 0 ? COLORS.you : COLORS.brigand;
    const trim = who === 0 ? COLORS.youTrim : COLORS.brigandTrim;
    g.poly(pts).fill({ color: fill, alpha }).stroke({ width: Math.max(1.5, c * 0.08), color: trim, alpha });
    // The deck line and a mark at the bow, so the two ships read apart without color (rule 6).
    const [mx, my] = P(-L * 0.2, 0);
    if (who === 0) g.circle(mx, my, c * 0.09).fill({ color: trim, alpha });
    else {
      const [ax, ay] = P(-L * 0.45, -Wd * 0.45);
      const [bx, by] = P(L * 0.05, Wd * 0.45);
      const [cx2, cy2] = P(-L * 0.45, Wd * 0.45);
      const [dx, dy] = P(L * 0.05, -Wd * 0.45);
      g.moveTo(ax, ay).lineTo(bx, by).moveTo(cx2, cy2).lineTo(dx, dy).stroke({ width: Math.max(1.5, c * 0.07), color: trim, alpha });
    }
    if (this.opts.showMarks) {
      const [tx, ty] = P(L * 0.75, 0);
      g.circle(tx, ty, c * 0.07).fill({ color: who === 0 ? COLORS.ink : COLORS.text, alpha });
    }
  }

  /** The plotted path as ghost ships, and the arcs of the broadsides plotted along it. */
  private drawPreview(): void {
    const g = this.ghostG;
    const a = this.arcG;
    g.clear();
    a.clear();
    const s = this.state;
    if (!s || s.finished) return;
    const plan = this.plan();
    const poses = previewBattlePlan(s, plan.segments);
    const c = this.cell;
    let prev: Pose = { x: s.ships[0].x, y: s.ships[0].y, heading: s.ships[0].heading };
    plan.segments.forEach((seg, i) => {
      const p = poses[i];
      if (!p) return;
      if (this.opts.showArcs) {
        for (const side of ["port", "starboard"] as const) {
          if (!seg[side]) continue;
          for (const cell of battleArcCells(s.board, p, side, s.config.cannonRange)) {
            a.rect(this.gx + cell.x * c + 2, this.gy + cell.y * c + 2, c - 4, c - 4).fill({ color: COLORS.arc, alpha: 0.28 });
          }
        }
      }
      if (seg.move !== null) {
        g.moveTo(this.cx(prev.x), this.cy(prev.y)).lineTo(this.cx(p.x), this.cy(p.y)).stroke({ width: Math.max(1.5, c * 0.06), color: COLORS.ghost, alpha: 0.45 });
        this.paintShip(g, this.cx(p.x), this.cy(p.y), (p.heading * Math.PI) / 2, 0, 0.35, 0);
      }
      prev = p;
    });
    // Where the brigand's guns reach from where it stands, so the captain sees the danger.
    if (this.opts.showArcs) {
      const them: Pose = { x: s.ships[1].x, y: s.ships[1].y, heading: s.ships[1].heading };
      if (s.ships[1].loaded > 0) {
        for (const side of ["port", "starboard"] as const) {
          for (const cell of battleArcCells(s.board, them, side, s.config.cannonRange)) {
            a.rect(this.gx + cell.x * c + 5, this.gy + cell.y * c + 5, c - 10, c - 10).stroke({ width: 1.5, color: COLORS.arcEnemy, alpha: 0.5 });
          }
        }
      }
    }
    this.drawGhostNumbers(plan, poses);
  }

  private ghostTexts: Text[] = [];

  private drawGhostNumbers(plan: BattlePlan, poses: Pose[]): void {
    for (const t of this.ghostTexts) t.destroy();
    this.ghostTexts = [];
    plan.segments.forEach((seg, i) => {
      const p = poses[i];
      if (!p || seg.move === null) return;
      const t = new Text({ text: String(i + 1), style: { fontFamily: FONT, fontSize: Math.max(9, this.cell * 0.42), fontWeight: "700", fill: COLORS.ink } });
      t.anchor.set(0.5);
      t.position.set(this.cx(p.x), this.cy(p.y));
      t.alpha = 0.8;
      this.textLayer.addChild(t);
      this.ghostTexts.push(t);
    });
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
    const barH = Math.max(5, h * 0.18);
    const panels: Array<{ px: number; who: ShipIndex; label: string }> = [
      { px: x, who: 0, label: this.opts.labels.you },
      { px: x + half + 8, who: 1, label: this.opts.labels.brigand },
    ];
    for (const p of panels) {
      const ship = s.ships[p.who];
      const hull = 1 - ship.damage / BATTLE_PERMILLE;
      g.roundRect(p.px, y + 2, half, h - 4, 6).fill({ color: COLORS.inkGlass, alpha: 0.9 });
      const name = new Text({ text: p.label, style: { fontFamily: FONT, fontSize: fs, fontWeight: "700", fill: p.who === 0 ? COLORS.you : COLORS.brigandTrim, letterSpacing: 1 } });
      name.position.set(p.px + 8, y + 5);
      this.hudTexts.addChild(name);
      const hullText = new Text({ text: `${this.opts.labels.hull} ${Math.round(hull * 100)}%`, style: { fontFamily: FONT, fontSize: fs - 1, fill: COLORS.muted } });
      hullText.anchor.set(1, 0);
      hullText.position.set(p.px + half - 8, y + 5);
      this.hudTexts.addChild(hullText);
      const bx = p.px + 8;
      const by = y + h - barH - 6;
      const bw = half - 16 - (ship.cannons > 0 ? ship.cannons * (barH + 3) + 10 : 0);
      g.rect(bx, by, bw, barH).fill({ color: COLORS.ink, alpha: 0.9 });
      g.rect(bx, by, bw * hull, barH).fill(hull > 0.5 ? COLORS.good : COLORS.danger);
      if (ship.damage >= s.config.grappleDamage) g.rect(bx, by, bw, barH).stroke({ width: 1.5, color: COLORS.brassLight, alpha: 0.9 });
      for (let i = 0; i < ship.cannons; i++) {
        const lx = bx + bw + 10 + i * (barH + 3);
        g.circle(lx + barH / 2, by + barH / 2, barH / 2).fill(i < ship.loaded ? COLORS.brassLight : COLORS.ink).stroke({ width: 1, color: COLORS.brass, alpha: 0.8 });
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
    this.buttons = [];
    const s = this.state;
    if (!s) return;
    const { x, y, w, h } = this.strip;
    g.roundRect(x, y, w, h, 10).fill({ color: COLORS.inkGlass, alpha: 0.92 });
    const me = s.ships[0];
    const n = s.config.segments;
    const live = this.interactive && !s.finished;
    const fs = Math.max(10, Math.min(13, this.vertical ? h * 0.075 : w * 0.055));
    const label = (text: string, tx: number, ty: number, color = COLORS.text, size = fs, anchorX = 0.5, weight: "400" | "700" = "700"): Text => {
      const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color } });
      t.anchor.set(anchorX, 0.5);
      t.position.set(tx, ty);
      this.stripTexts.addChild(t);
      return t;
    };
    const button = (id: string, bx: number, by: number, bw: number, bh: number, on: boolean, enabled: boolean, color = COLORS.brass): void => {
      const press = this.pressed?.id === id ? 1 - Math.min(1, this.pressed.t / 160) : 0;
      g.roundRect(bx, by, bw, bh, 7).fill({ color: on ? color : COLORS.ink, alpha: enabled ? 0.95 : 0.4 });
      g.roundRect(bx, by, bw, bh, 7).stroke({ width: 1.5 + press * 2, color: on ? COLORS.brassLight : color, alpha: enabled ? 0.9 : 0.35 });
      if (enabled) this.buttons.push({ id, x: bx, y: by, w: bw, h: bh });
    };
    // Turn clock.
    const top = y + 8;
    const turnText = label(this.opts.labels.turn(s.turn + 1, s.config.maxTurns), x + 10, top + fs * 0.6, COLORS.muted, fs, 0, "400");
    void turnText;
    const clockW = w - 20;
    const clockY = top + fs * 1.4;
    g.rect(x + 10, clockY, clockW, 4).fill({ color: COLORS.ink, alpha: 0.9 });
    if (this.turnLeftMs !== null && live) {
      const k = Math.max(0, Math.min(1, this.turnLeftMs / this.turnMs));
      g.rect(x + 10, clockY, clockW * k, 4).fill(k < 0.25 ? COLORS.danger : COLORS.brass);
    }
    // Slots.
    const slotTop = clockY + 12;
    const gap = 6;
    const canW = Math.max(16, Math.min(26, this.vertical ? (w - 20) / n / 4 : w * 0.11));
    let slotW: number;
    let slotH: number;
    let slotX = (i: number): number => x + 10 + i * ((w - 20) / n);
    let slotY = (_i: number): number => slotTop;
    if (this.vertical) {
      slotW = (w - 20) / n - gap;
      slotH = Math.max(34, h * 0.26);
    } else {
      slotW = w - 20;
      slotH = Math.max(30, Math.min(44, (h - slotTop + y - 150) / n - gap));
      slotX = () => x + 10;
      slotY = (i) => slotTop + i * (slotH + gap);
    }
    for (let i = 0; i < n; i++) {
      const seg = this.segments[i] ?? { move: null, port: false, starboard: false };
      const sx = slotX(i);
      const sy = slotY(i);
      const sel = this.selected === i && live;
      g.roundRect(sx, sy, slotW, slotH, 8).fill({ color: COLORS.ink, alpha: 0.9 });
      g.roundRect(sx, sy, slotW, slotH, 8).stroke({ width: sel ? 2.5 : 1, color: sel ? COLORS.brassLight : COLORS.grid, alpha: sel ? 1 : 0.7 });
      if (live) this.buttons.push({ id: `slot:${i}`, x: sx + canW, y: sy, w: slotW - canW * 2, h: slotH });
      const midX = sx + slotW / 2;
      const midY = sy + slotH / 2;
      // The move icon.
      this.paintToken(g, seg.move, midX, midY, Math.min(slotH * 0.6, slotW * 0.3), seg.move === null ? COLORS.muted : COLORS.brassLight);
      label(String(i + 1), sx + canW + 4, sy + fs * 0.7, COLORS.muted, fs - 2, 0, "400");
      // Port and starboard guns on the slot's sides.
      for (const side of ["port", "starboard"] as const) {
        const bx = side === "port" ? sx + 3 : sx + slotW - canW - 3;
        const on = seg[side];
        const can = live && (on || me.loaded > this.shotsPlanned());
        g.roundRect(bx, sy + 3, canW, slotH - 6, 6).fill({ color: on ? COLORS.danger : COLORS.inkGlass, alpha: can || on ? 0.95 : 0.35 });
        g.circle(bx + canW / 2, midY, Math.min(canW, slotH) * 0.22).fill(on ? COLORS.flash : COLORS.muted).stroke({ width: 1, color: COLORS.ink });
        if (can) this.buttons.push({ id: `fire:${i}:${side}`, x: bx, y: sy, w: canW + 3, h: slotH });
      }
    }
    // Tokens tray.
    const trayY = this.vertical ? slotTop + slotH + 8 : slotY(n - 1) + slotH + 10;
    const trayH = Math.max(28, Math.min(40, this.vertical ? h * 0.2 : 36));
    const trayItems: Array<MoveToken | null> = ["left", "forward", "right", null];
    const trayW = (w - 20 - gap * 3) / 4;
    trayItems.forEach((t, i) => {
      const bx = x + 10 + i * (trayW + gap);
      const count = t === null ? null : me.tokens[t];
      const enabled = live && (t === null || (count ?? 0) > this.tokensPlanned(t));
      button(`token:${t ?? "hold"}`, bx, trayY, trayW, trayH, false, enabled, COLORS.brass);
      this.paintToken(g, t, bx + trayW * 0.35, trayY + trayH / 2, trayH * 0.5, enabled ? COLORS.brassLight : COLORS.muted);
      if (t !== null && count !== null) label(`×${count - this.tokensPlanned(t)}`, bx + trayW * 0.72, trayY + trayH / 2, enabled ? COLORS.text : COLORS.muted, fs);
      else label(this.opts.labels.hold, bx + trayW * 0.7, trayY + trayH / 2, enabled ? COLORS.text : COLORS.muted, fs - 2);
    });
    // Grapple, clear, sail.
    const rowY = trayY + trayH + 8;
    const rowH = Math.max(30, Math.min(42, this.vertical ? h * 0.2 : 40));
    const ready = s.ships[1].damage >= s.config.grappleDamage;
    const gw = (w - 20 - gap * 2) * 0.3;
    button("grapple", x + 10, rowY, gw, rowH, this.grapple, live, ready ? COLORS.brassLight : COLORS.brass);
    label(this.opts.labels.grapple, x + 10 + gw / 2, rowY + rowH / 2, this.grapple ? COLORS.ink : COLORS.text, fs - 1);
    const cw = (w - 20 - gap * 2) * 0.2;
    button("clear", x + 10 + gw + gap, rowY, cw, rowH, false, live, COLORS.muted);
    label(this.opts.labels.clear, x + 10 + gw + gap + cw / 2, rowY + rowH / 2, COLORS.muted, fs - 2);
    const sw = w - 20 - gw - cw - gap * 2;
    button("sail", x + 10 + gw + cw + gap * 2, rowY, sw, rowH, true, live, COLORS.brass);
    label(this.opts.labels.sail, x + 10 + gw + cw + gap * 2 + sw / 2, rowY + rowH / 2, COLORS.ink, fs);
    if (ready && live) label(this.opts.labels.grappleReady, x + w / 2, rowY + rowH + fs, COLORS.brassLight, fs - 2);
    // Where the strip's buttons are, for the smoke test's taps.
    this.app.canvas.setAttribute("data-buttons", this.buttons.map((b) => `${b.id}=${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(";"));
  }

  private paintToken(g: Graphics, t: MoveToken | null, x: number, y: number, size: number, color: number): void {
    const r = size * 0.5;
    if (t === null) {
      g.circle(x, y, r * 0.35).stroke({ width: 2, color });
      return;
    }
    if (t === "forward") {
      g.poly([x, y - r, x + r * 0.7, y + r * 0.6, x, y + r * 0.2, x - r * 0.7, y + r * 0.6]).fill(color);
      return;
    }
    // A curved turn: an arc with an arrowhead, bending left or right.
    const dir = t === "left" ? -1 : 1;
    g.moveTo(x - dir * r * 0.1, y + r * 0.9);
    g.quadraticCurveTo(x - dir * r * 0.1, y - r * 0.5, x + dir * r * 0.7, y - r * 0.5);
    g.stroke({ width: Math.max(2, size * 0.16), color });
    g.poly([x + dir * r * 1.05, y - r * 0.5, x + dir * r * 0.45, y - r * 1.0, x + dir * r * 0.45, y]).fill(color);
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
      const i = Number(a);
      if (this.selected === i) this.setSegment(i, { ...this.segments[i]!, move: null });
      else this.selected = i;
      this.cb.onNudge();
    } else if (kind === "fire") {
      const i = Number(a);
      const side = b as Side;
      const seg = this.segments[i]!;
      this.setSegment(i, { ...seg, [side]: !seg[side] });
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
    } else if (kind === "sail") {
      this.commit();
    }
    this.stripDirty = true;
  }

  /** Put a token in the selected slot and move the selection on. */
  private queueToken(t: MoveToken | null): boolean {
    const s = this.state;
    if (!s || s.finished || !this.interactive) return false;
    const i = this.selected;
    if (i >= this.segments.length) return false;
    const seg = this.segments[i]!;
    if (t !== null && s.ships[0].tokens[t] <= this.tokensPlanned(t) - (seg.move === t ? 1 : 0)) {
      this.cb.onNudge();
      return false;
    }
    this.setSegment(i, { ...seg, move: t });
    this.selected = Math.min(this.segments.length - 1, i + 1);
    this.cb.onNudge();
    return true;
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
        return this.queueToken("left");
      case "w":
      case "W":
      case "ArrowUp":
        return this.queueToken("forward");
      case "d":
      case "D":
      case "ArrowRight":
        return this.queueToken("right");
      case "s":
      case "S":
      case "ArrowDown":
        return this.queueToken(null);
      case "q":
      case "Q":
      case "e":
      case "E": {
        const i = this.lastPlotted();
        const seg = this.segments[i]!;
        const side: Side = key === "q" || key === "Q" ? "port" : "starboard";
        if (!seg[side] && this.state.ships[0].loaded <= this.shotsPlanned()) return true;
        this.setSegment(i, { ...seg, [side]: !seg[side] });
        this.stripDirty = true;
        return true;
      }
      case "Backspace": {
        const i = this.lastPlotted();
        this.setSegment(i, { move: null, port: false, starboard: false });
        this.selected = i;
        this.stripDirty = true;
        return true;
      }
      case "g":
      case "G":
        this.grapple = !this.grapple;
        this.stripDirty = true;
        this.cb.onPlanChange(this.plan());
        return true;
      case "Escape":
        this.resetPlan(this.state);
        return true;
      case "Enter":
      case " ":
        this.commit();
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
          this.stripDirty = true;
        }
        return true;
      }
      default:
        return false;
    }
  }

  /** The slot a side key acts on: the last one with anything in it, else the selected one. */
  private lastPlotted(): number {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i]!;
      if (s.move !== null || s.port || s.starboard) return i;
    }
    return Math.min(this.selected, this.segments.length - 1);
  }

  // ---- animation

  private tick(dt: number): void {
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
    let shipsDirty = false;
    if (this.step) {
      this.stepT += dt;
      const k = Math.min(1, this.stepT / this.step.ms);
      const ease = 1 - (1 - k) ** 2;
      for (const tw of this.step.tweens) {
        const v = this.ships[tw.ship];
        v.x = tw.from.x + (tw.to.x - tw.from.x) * ease;
        v.y = tw.from.y + (tw.to.y - tw.from.y) * ease;
        v.rot = tw.from.rot + (tw.to.rot - tw.from.rot) * ease;
        shipsDirty = true;
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
          if (sh.hit) {
            this.hurt(sh.ship === 0 ? 1 : 0, this.state?.config.shotDamage ?? 0);
            this.popup(sh.to.x, sh.to.y - this.cell * 0.9, sh.ship === 0 ? this.opts.labels.hit : this.opts.labels.hitTaken, sh.ship === 0 ? COLORS.brassLight : COLORS.danger, 0.6);
            this.burst(sh.to.x, sh.to.y, COLORS.flash, 10, 0.9);
            this.burst(sh.to.x, sh.to.y, COLORS.smoke, 8, 0.8);
            this.shake = Math.max(this.shake, 300);
          } else {
            this.popup(sh.to.x, sh.to.y - this.cell * 0.7, this.opts.labels.miss, COLORS.splash, 0.35);
            this.burst(sh.to.x, sh.to.y, COLORS.splash, 7, 0.6);
          }
        }
        this.step = null;
        if (this.queue.length === 0 && this.state) {
          this.snap(this.state);
          this.drawPreview();
        }
        shipsDirty = true;
      }
    }
    for (const v of this.ships) {
      if (v.flash > 0) {
        v.flash -= dt;
        shipsDirty = true;
      }
    }
    if (shipsDirty) this.drawShips();
    // Camera shake.
    if (this.shake > 0) {
      this.shake -= dt;
      const a = this.reduced ? 0 : (this.shake / 400) * 4;
      this.world.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    } else this.world.position.set(0, 0);
    // Shots in flight.
    const fx = this.fxG;
    fx.clear();
    if (this.step && this.step.shots.length) {
      const k = Math.min(1, this.stepT / this.step.ms);
      for (const sh of this.step.shots) {
        const x = sh.from.x + (sh.to.x - sh.from.x) * k;
        const y = sh.from.y + (sh.to.y - sh.from.y) * k - Math.sin(k * Math.PI) * this.cell * 0.5;
        fx.circle(x, y, Math.max(2, this.cell * 0.12)).fill(COLORS.ink).stroke({ width: 1, color: COLORS.text, alpha: 0.6 });
      }
    }
    // Particles.
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      if (p.life >= p.max) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.grow * dt;
      const a = p.alpha * (1 - p.life / p.max);
      fx.circle(p.x, p.y, Math.max(0.5, p.r)).fill({ color: p.color, alpha: a });
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

  private popup(x: number, y: number, text: string, color: number, scale: number, max = 1100): void {
    const t = new Text({ text, style: { fontFamily: DISPLAY, fontSize: Math.max(11, this.cell * 0.9 * scale), fontWeight: "700", fill: color, stroke: { color: COLORS.ink, width: 3 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max, y0: y });
  }

  private burst(x: number, y: number, color: number, n: number, power: number): void {
    if (this.reduced) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.03 + Math.random() * 0.07) * power;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: this.cell * 0.07, grow: 0.004 * power, color, alpha: 0.9, life: 0, max: 360 + Math.random() * 260 });
    }
  }
}
