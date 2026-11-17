import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  racksCrateFits,
  racksCrateWouldShip,
  racksHint,
  racksMovable,
  racksNextShipment,
  racksTopGroup,
  racksViewString,
  racksWouldShip,
  type RacksCell,
  type RacksCrate,
  type RacksMove,
  type RacksMoveReport,
  type RacksState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION, ink } from "../look/tokens.js";
import { FONT, FONT_MONO, INK, drawDot } from "../kit/art.js";
import { KitBoard } from "../kit/board.js";
import { racksKind, trolleyColor } from "./pieces.js";

export interface RacksCallbacks {
  /** The player set the top of one rack on another, and the engine would take it. */
  onMove(from: number, to: number): void;
  /** The player called the crate down. */
  onCall(): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface RacksLabels {
  /** The strip over the racks while nothing presses: how long the crate hangs. */
  lands(moves: number): string;
  /** The crate has no room on its rack. */
  noRoom(moves: number): string;
  /** The crate will complete its rack when it lands. */
  willShip(moves: number): string;
  /** A chain is running: what the next shipment is, and what it scores. */
  chainLive(count: number, points: number): string;
  /** The callout for a shipment in a chain. */
  chain(count: number): string;
  /** A crate landed and completed its rack. */
  delivered: string;
  smashed: string;
}

export interface RacksRendererOptions {
  /** Mark an action worth taking after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: RacksLabels;
}

interface CellView {
  s: Sprite;
  kind: number;
}

const HINT_AFTER_MS = 6000;
/** A hanging crate's cells are drawn a little smaller than a racked one's, and so are the places they will take. */
const CRATE_SCALE = 0.8;
/** How far a lifted group floats over its rack, in cells. */
const LIFT_RISE = 0.4;
/** A rack that refused a group, or was smashed, is ringed in danger this long. */
const REFUSED_MS = 360;
/** A chain this long is the beat. */
const BEAT_CHAIN = 3;

/** Draws the racks and the crate, and turns taps, drags and keys into moves. Scores nothing: every number it shows is the engine's. */
export class RacksRenderer extends KitBoard<RacksState> {
  private readonly bg = new Graphics();
  private readonly under = new Graphics();
  private readonly crateBack = new Graphics();
  /** Where the crate's cells will sit: each kind's own outline, in the hairline's colour. */
  private readonly ghostLayer = new Container();
  private readonly ghosts: Sprite[] = [];
  private readonly pieceLayer = new Container();
  private readonly over = new Graphics();
  private readonly crateBadge = new Container();
  private readonly badgeBox = new Graphics();
  private readonly textLayer = new Container();
  private label: Text | null = null;
  private badgeText: Text | null = null;
  private digits: Text[] = [];
  private previews: Text[] = [];
  private readonly pieces = new Map<number, CellView>();
  /** The layout: how many racks, how tall, and where everything sits, in CSS pixels. */
  private geo = { cols: 5, rows: 5, crateMax: 3, pitch: 60, cell: 48, wellW: 54, left: 0, panelTop: 0, panelBottom: 0, railY: 0, topY: 0, baseY: 0 };
  /** The crate as drawn: the rack it hangs over, how many cells its frame holds and the count on its badge. Null while it is coming down. */
  private hung: { rack: number; size: number; lands: number } | null = null;
  /** The rack whose top group is lifted, the cells in it, and the rack heights it was lifted at. */
  private lifted: { rack: number; ids: number[]; age: number } | null = null;
  private drag: { rack: number; fresh: boolean; moved: boolean; x: number; y: number } | null = null;
  /** The keyboard's rack. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private idle = 0;
  private hint: Extract<RacksMove, { type: "move" | "call" }> | null = null;
  private hintFor: RacksState | null = null;
  private hints: boolean;
  /** The rack ringed in danger for a moment: one that refused a group, or was smashed. */
  private refused: { rack: number; until: number } | null = null;
  /** While a move plays: the most cells each rack holds on the way, so no dot shows through a cell still in its slot. */
  private playing: number[] | null = null;

  constructor(
    host: HTMLElement,
    private readonly cb: RacksCallbacks,
    private readonly opts: RacksRendererOptions,
  ) {
    super(host, "racks", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(0.5);
    this.badgeText = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 18, fontWeight: "700", fill: INK.ground }, resolution: 2 });
    this.badgeText.anchor.set(0.5);
    this.crateBadge.addChild(this.badgeBox, this.badgeText);
    this.pieceLayer.sortableChildren = true;
    this.textLayer.addChild(this.label);
    this.world.addChild(this.bg, this.under, this.crateBack, this.ghostLayer, this.pieceLayer, this.over, this.crateBadge, this.textLayer);
  }

  // ---- geometry

  private colX(rack: number): number {
    return this.geo.left + (rack + 0.5) * this.geo.pitch;
  }

  /** The centre of slot `i` of a rack, counted from the bottom. */
  private slotY(i: number): number {
    return this.geo.baseY - (i + 0.5) * this.geo.cell;
  }

  /** The centre of cell `j` of a hanging crate, counted from its bottom. */
  private hangY(j: number): number {
    const g = this.geo;
    return g.topY - g.cell * 0.5 - (j + 0.5) * g.cell * CRATE_SCALE;
  }

  private rackAtX(x: number): number | null {
    const g = this.geo;
    const col = Math.floor((x - g.left) / g.pitch);
    return col >= 0 && col < g.cols ? col : null;
  }

  protected layout(width: number, height: number): void {
    const g = this.geo;
    if (this.state) {
      g.cols = this.state.config.racks;
      g.rows = this.state.config.height;
      g.crateMax = this.state.config.crateMax;
    }
    const margin = 6;
    const pad = 8;
    const labelH = Math.max(22, Math.min(36, height * 0.06));
    // Above the racks: the trolley on its rail, the cables, the crate and a gap; below them: the rack numbers.
    const gantry = 0.62 + 0.14 + g.crateMax * CRATE_SCALE + 0.5;
    const footer = 0.46;
    const innerW = width - (margin + pad) * 2;
    const innerH = height - (margin + pad) * 2 - labelH;
    g.cell = Math.max(14, Math.min(96, Math.floor(Math.min(innerW / g.cols / 1.04, innerH / (g.rows + gantry + footer)))));
    g.pitch = Math.min(innerW / g.cols, g.cell * 1.6);
    g.wellW = Math.min(g.pitch - 6, g.cell * 1.14);
    const blockW = g.pitch * g.cols;
    const blockH = labelH + (g.rows + gantry + footer) * g.cell;
    g.left = Math.floor((width - blockW) / 2);
    g.panelTop = Math.floor((height - blockH) / 2) - pad;
    g.panelBottom = g.panelTop + blockH + pad * 2;
    g.railY = g.panelTop + pad + labelH + g.cell * 0.31;
    g.topY = g.panelTop + pad + labelH + gantry * g.cell;
    g.baseY = g.topY + g.rows * g.cell;

    // Bare ground under the strip, the rail and the racks, with one hairline round it.
    this.bg.clear();
    this.paintGround(this.bg, g.left - pad, g.panelTop, blockW + pad * 2, blockH + pad * 2);
    // The rail the crate's trolley hangs from.
    const railH = Math.max(3, g.cell * 0.07);
    this.bg.roundRect(g.left + 2, g.railY - railH / 2, blockW - 4, railH, railH / 2).fill({ color: INK.line });
    // A rack is the foot its cells stand on; its empty slots are dots, drawn with the overlays.
    const footH = Math.max(3, g.cell * 0.08);
    for (let r = 0; r < g.cols; r++) this.bg.roundRect(this.colX(r) - g.wellW / 2, g.baseY + 2, g.wellW, footH, footH / 2).fill({ color: INK.line });
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.min(19, Math.round(g.cell * 0.34)));
      this.label.position.set(width / 2, g.panelTop + pad + labelH * 0.46);
      this.label.style.wordWrap = false;
    }
    this.refused = null;
    if (this.badgeText) this.badgeText.style.fontSize = Math.max(11, Math.round(g.cell * 0.4));
    this.syncTexts();
    this.cursor = Math.min(this.cursor, g.cols - 1);
    this.publishGeom(g.left, g.topY, g.pitch);
    this.dropLift();
    if (this.state) this.snap(this.state);
    this.drawOverlays();
  }

  /** One number under each rack and one preview over it, as many as there are racks. */
  private syncTexts(): void {
    const g = this.geo;
    while (this.digits.length < g.cols) {
      const d = new Text({ text: String(this.digits.length + 1), style: { fontFamily: FONT_MONO, fontSize: 12, fontWeight: "700", fill: INK.dim }, resolution: 2 });
      d.anchor.set(0.5);
      this.digits.push(d);
      this.textLayer.addChild(d);
      const p = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 14, fontWeight: "700", fill: INK.cream, stroke: { color: INK.ground, width: 3, join: "round" } }, resolution: 2 });
      p.anchor.set(0.5);
      p.visible = false;
      this.previews.push(p);
      this.textLayer.addChild(p);
    }
    this.digits.forEach((d, r) => {
      d.visible = r < g.cols;
      d.style.fontSize = Math.max(10, Math.round(g.cell * 0.28));
      d.position.set(this.colX(r), g.baseY + g.cell * 0.3);
    });
    this.previews.forEach((p, r) => {
      p.visible = false;
      p.style.fontSize = Math.max(12, Math.round(g.cell * 0.36));
      p.position.set(this.colX(r), g.topY - g.cell * 0.24);
    });
  }

  /** A fuel cell's picture: its outline says its kind. `ghost` is the same outline in the hairline's colour, for a place a cell will take. */
  private texture(kind: number, ghost = false): Texture {
    const k = racksKind(kind);
    return this.piece(`${ghost ? "ghost" : "cell"}:${k.id}`, this.geo.cell, ghost ? "line" : k.color, k.paint);
  }

  // ---- drawing a state

  private ensure(c: RacksCell): CellView {
    let v = this.pieces.get(c.id);
    if (!v) {
      const s = new Sprite(this.texture(c.kind));
      s.anchor.set(0.5);
      this.pieceLayer.addChild(s);
      v = { s, kind: c.kind };
      this.pieces.set(c.id, v);
    }
    v.kind = c.kind;
    v.s.texture = this.texture(c.kind);
    return v;
  }

  private place(v: CellView, x: number, y: number, scale: number): void {
    v.s.position.set(x, y);
    v.s.scale.set(scale);
    v.s.alpha = 1;
    v.s.rotation = 0;
    v.s.zIndex = 0;
  }

  /** Put exactly this state's cells on the racks and in the crate, with nothing in motion. */
  private snap(state: RacksState): void {
    const seen = new Set<number>();
    state.racks.forEach((rack, r) =>
      rack.forEach((c, i) => {
        seen.add(c.id);
        this.place(this.ensure(c), this.colX(r), this.slotY(i), 1);
      }),
    );
    state.crate.cells.forEach((c, j) => {
      seen.add(c.id);
      this.place(this.ensure(c), this.colX(state.crate.rack), this.hangY(j), CRATE_SCALE);
    });
    for (const [id, v] of this.pieces) {
      if (seen.has(id)) continue;
      v.s.destroy();
      this.pieces.delete(id);
    }
    this.lifted = null;
    this.playing = null;
    this.hang(state.crate, 0, 1);
    this.refreshLabel();
    this.touchView();
  }

  /** Draw the crate's frame, cables and trolley over a rack, `dy` above where it hangs. */
  private hang(crate: RacksCrate, dy: number, alpha: number): void {
    const g = this.geo;
    this.hung = { rack: crate.rack, size: crate.cells.length, lands: crate.lands };
    const n = crate.cells.length;
    const w = g.cell * CRATE_SCALE + Math.max(4, g.cell * 0.12);
    const h = n * g.cell * CRATE_SCALE + Math.max(4, g.cell * 0.1);
    const bottom = g.topY - g.cell * 0.5 + Math.max(2, g.cell * 0.05);
    const top = bottom - h;
    const trolleyH = g.cell * 0.5;
    const trolleyBottom = g.railY + trolleyH * 0.62;
    const b = this.crateBack;
    b.clear();
    // Two cables from the trolley to the box, then the box: a flat raised panel the cells sit on.
    const cable = Math.max(2, g.cell * 0.05);
    for (const side of [-1, 1]) b.rect(side * w * 0.3 - cable / 2, trolleyBottom - 2, cable, top - trolleyBottom + 4).fill({ color: INK.line });
    b.roundRect(-w / 2, top, w, h, g.cell * 0.18).fill({ color: INK.raised });
    b.position.set(this.colX(crate.rack), dy);
    b.alpha = alpha;
    this.crateBadge.position.set(this.colX(crate.rack), g.railY + dy);
    this.crateBadge.alpha = alpha;
    this.crateBadge.scale.set(1);
    this.drawBadge();
  }

  /** The trolley on the rail, with the moves left on it: dim, danger when the crate has no room, cream when it will ship its rack. */
  private drawBadge(): void {
    const g = this.geo;
    const state = this.state;
    const w = g.cell * 0.86;
    const h = g.cell * 0.56;
    const fits = state === null || racksCrateFits(state);
    const ships = state !== null && racksCrateWouldShip(state);
    this.badgeBox.clear();
    this.badgeBox.roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill({ color: ink(trolleyColor(fits, ships)) });
    if (this.badgeText) this.badgeText.text = this.hung ? String(this.hung.lands) : "";
    const at = this.hung ? `${Math.round(this.colX(this.hung.rack))},${Math.round(this.hangY(0))}` : "";
    this.app.canvas.setAttribute("data-crate", at);
  }

  private refreshLabel(): void {
    const state = this.state;
    if (!this.label) return;
    if (!state || state.finished) {
      this.label.text = "";
      return;
    }
    const l = this.opts.labels;
    const n = state.crate.lands;
    if (state.combo > 0) {
      const next = racksNextShipment(state);
      this.label.text = l.chainLive(next.chain, next.points);
      this.label.style.fill = INK.cream;
    } else if (!racksCrateFits(state)) {
      this.label.text = l.noRoom(n);
      this.label.style.fill = INK.danger;
    } else if (racksCrateWouldShip(state)) {
      this.label.text = l.willShip(n);
      this.label.style.fill = INK.cream;
    } else {
      this.label.text = l.lands(n);
      this.label.style.fill = INK.dim;
    }
    // A long line shrinks to fit the panel.
    const room = this.geo.pitch * this.geo.cols;
    this.label.scale.set(1);
    if (this.label.width > room) this.label.scale.set(room / this.label.width);
  }

  protected onState(state: RacksState, prev: RacksState | null): void {
    this.dropLift();
    this.hint = null;
    this.idle = 0;
    const g = this.geo;
    const c = state.config;
    if (g.cols !== c.racks || g.rows !== c.height || g.crateMax !== c.crateMax) {
      // Different racks (a lab config): lay them out afresh.
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const report = state.lastMove;
    if (!report || !prev || state.moveCount !== prev.moveCount + 1 || !this.follows(prev)) {
      this.snap(state);
      this.drawOverlays();
      return;
    }
    this.play(state, prev, report);
  }

  /** True when what is drawn is `prev`: the move in the next state can be played from here. */
  private follows(prev: RacksState): boolean {
    let n = 0;
    for (const rack of prev.racks)
      for (const c of rack) {
        if (this.pieces.get(c.id)?.kind !== c.kind) return false;
        n++;
      }
    for (const c of prev.crate.cells) {
      if (this.pieces.get(c.id)?.kind !== c.kind) return false;
      n++;
    }
    return n === this.pieces.size;
  }

  /** Play one action out, event by event, and end on the engine's state. */
  private play(state: RacksState, prev: RacksState, report: RacksMoveReport): void {
    const g = this.geo;
    const l = this.opts.labels;
    const model = prev.racks.map((r) => r.map((c) => c.id));
    this.playing = prev.racks.map((r, i) => Math.max(r.length, state.racks[i]!.length));
    const at = (ms: number, fn: () => void): void => {
      if (ms <= 0) fn();
      else this.tweens.after(ms, fn);
    };
    let t = 0;
    let landed = false;
    for (const e of report.events) {
      switch (e.type) {
        case "move": {
          const ships = report.events.some((x) => x.type === "ship" && x.rack === e.to && !x.byCrate);
          const src = model[e.from]!;
          src.splice(src.length - e.ids.length, e.ids.length);
          const base = model[e.to]!.length;
          model[e.to]!.push(...e.ids);
          // The group goes across as one, straight to its slots.
          e.ids.forEach((id, i) => {
            const v = this.pieces.get(id);
            if (!v) return;
            v.s.zIndex = 3;
            this.tweens.move(v.s, { x: this.colX(e.to), y: this.slotY(base + i), scale: 1 }, { delay: t, done: () => (v.s.zIndex = 0) });
          });
          at(t, () => (ships ? sfx.swap() : sfx.swapQuiet()));
          t += MOTION.move + 10;
          break;
        }
        case "ship": {
          const ids = model[e.rack]!.slice().reverse();
          model[e.rack] = [];
          const x = this.colX(e.rack);
          // The cells shrink to nothing, top first, on a rising run of notes.
          ids.forEach((id, i) => {
            const v = this.pieces.get(id);
            if (!v) return;
            this.pieces.delete(id);
            v.s.zIndex = 2;
            const start = t + 70 + i * 55;
            this.tweens.after(start, () => sfx.pop(Math.min(9, (e.chain - 1) * 2 + i)));
            this.tweens.remove(v.s, { delay: start, done: () => v.s.destroy() });
          });
          const done = t + 70 + (ids.length - 1) * 55 + 130;
          this.tweens.after(done, () => {
            this.fx.popup(x, g.topY + g.cell * 0.4, `+${e.points}`, INK.cream, Math.max(16, g.cell * (e.chain >= 2 ? 0.62 : 0.46)));
            if (e.chain >= 2) this.fx.say(l.chain(e.chain));
            else if (e.byCrate) this.fx.say(l.delivered);
            if (e.chain >= BEAT_CHAIN) {
              // The beat is the chain's: three shipments in a row, and stronger for each one after.
              // It has one sound of its own, so the shipment's own cues give way to it.
              this.beat(0.5 + Math.min(0.5, (e.chain - BEAT_CHAIN) * 0.25));
            } else {
              sfx.clear(e.chain, ids.length);
              if (e.chain >= 2) sfx.multi(e.chain);
            }
          });
          t = done + 130;
          break;
        }
        case "spill": {
          // The crate is already on its way down (the land that follows starts now); the rack's cells go as it hits.
          const ids = model[e.rack]!.slice();
          model[e.rack] = [];
          const x = this.colX(e.rack);
          const hit = t + MOTION.move;
          ids.forEach((id) => {
            const v = this.pieces.get(id);
            if (!v) return;
            this.pieces.delete(id);
            v.s.zIndex = 2;
            this.tweens.remove(v.s, { delay: hit, done: () => v.s.destroy() });
          });
          this.tweens.after(hit, () => {
            sfx.crack(true);
            this.refuse(e.rack);
            this.fx.say(l.smashed, INK.danger);
            if (e.penalty > 0) this.fx.popup(x, g.topY + g.cell * 0.6, `-${e.penalty}`, INK.danger, Math.max(16, g.cell * 0.5));
          });
          this.tweens.after(hit + 130, () => sfx.bad());
          break;
        }
        case "land": {
          const base = model[e.rack]!.length;
          model[e.rack]!.push(...e.ids);
          const x = this.colX(e.rack);
          const start = t;
          if (e.called) at(start, () => sfx.whoosh());
          e.ids.forEach((id, j) => {
            const v = this.pieces.get(id);
            if (!v) return;
            v.s.zIndex = 1;
            this.tweens.move(v.s, { x, y: this.slotY(base + j), scale: 1 }, { delay: start, done: () => (v.s.zIndex = 0) });
          });
          // The empty box and its trolley go.
          at(start, () => (this.hung = null));
          this.tweens.move(this.crateBack, { alpha: 0 }, { delay: start });
          this.tweens.move(this.crateBadge, { alpha: 0 }, { delay: start });
          this.tweens.after(start + MOTION.move, () => sfx.thud());
          landed = true;
          t = start + MOTION.move + 20;
          break;
        }
        case "deal": {
          // The next crate comes down to the end of its cables.
          const crate = e.crate;
          const rise = g.cell * 0.5;
          const views = crate.cells.map((c, j) => {
            const v = this.ensure(c);
            this.place(v, this.colX(crate.rack), this.hangY(j) - rise, CRATE_SCALE);
            v.s.alpha = 0;
            return v;
          });
          this.tweens.after(t, () => {
            this.hang(crate, -rise, 0);
            sfx.tick(false);
          });
          views.forEach((v, j) => this.tweens.move(v.s, { y: this.hangY(j), alpha: 1 }, { delay: t + 1 }));
          this.tweens.move(this.crateBack, { y: 0, alpha: 1 }, { delay: t + 1 });
          this.tweens.move(this.crateBadge, { y: g.railY, alpha: 1 }, { delay: t + 1 });
          t += MOTION.move + 5;
          break;
        }
      }
    }
    if (!landed) {
      // The crate only came a step nearer: its count ticks down.
      const lands = state.crate.lands;
      if (this.hung) this.hung = { ...this.hung, lands };
      this.drawBadge();
      sfx.tick(lands <= 1);
      this.refreshLabel();
    }
    if (prev.combo >= 2 && state.combo === 0 && !report.events.some((e) => e.type === "spill")) at(t, () => sfx.streakLost());
    // Whatever the tweens did, the racks end as the engine holds them.
    this.tweens.after(Math.max(t, 1), () => {
      this.snap(state);
      this.drawOverlays();
    });
  }

  /** Ring a rack in danger for a moment: it would not take the group, or a crate smashed it. */
  private refuse(rack: number): void {
    this.refused = { rack, until: this.time + REFUSED_MS };
  }

  /** What is drawn, read back off the sprites: the racks column by column, bottom first, then the crate and the count on its badge. */
  protected view(): string {
    const g = this.geo;
    const racks: Array<Array<{ y: number; kind: number }>> = Array.from({ length: g.cols }, () => []);
    const crate: Array<{ y: number; kind: number }> = [];
    let crateRack = -1;
    for (const v of this.pieces.values()) {
      const col = Math.max(0, Math.min(g.cols - 1, Math.floor((v.s.x - g.left) / g.pitch)));
      // A hanging cell sits clear above the rack's rim; a lifted one never rises that far.
      if (v.s.y < g.topY - g.cell * 0.2) {
        crate.push({ y: v.s.y, kind: v.kind });
        crateRack = col;
      } else racks[col]!.push({ y: v.s.y, kind: v.kind });
    }
    const bottomFirst = (a: { y: number }, b: { y: number }): number => b.y - a.y;
    return racksViewString(
      racks.map((r) => r.sort(bottomFirst)),
      { cells: crate.sort(bottomFirst), rack: crateRack, lands: Number(this.badgeText?.text ?? "") },
    );
  }

  // ---- overlays: the mark, the lifted group, the racks that can take it, the cursor, the hint

  private drawOverlays(): void {
    const g = this.geo;
    const state = this.state;
    const u = this.under;
    const o = this.over;
    u.clear();
    o.clear();
    for (const p of this.previews) p.visible = false;
    for (const s of this.ghosts) s.visible = false;
    if (!state) return;
    const well = (rack: number): [number, number, number, number, number] => [this.colX(rack) - g.wellW / 2, g.topY - 3, g.wellW, g.rows * g.cell + 6, g.cell * 0.2];
    const settled = !this.busy;
    const ringW = Math.max(2, g.cell * 0.07);
    const lift = this.lifted;

    // The marked rack: where the crate's cells will sit, or a warning that they will not.
    const marked = settled && !state.finished && this.hung ? state.crate.rack : -1;
    const fits = racksCrateFits(state);
    const ghosted = marked >= 0 && fits && (!lift || lift.rack !== marked) ? state.crate.cells.length : 0;

    // An empty slot is a dot, except where the crate's cells are shown on their way.
    state.racks.forEach((rack, r) => {
      for (let i = (this.playing?.[r] ?? rack.length) + (r === marked ? ghosted : 0); i < g.rows; i++) drawDot(u, this.colX(r), this.slotY(i), g.cell);
    });

    if (this.refused && this.time < this.refused.until && this.refused.rack < g.cols) u.roundRect(...well(this.refused.rack)).stroke({ width: ringW, color: INK.danger });

    if (marked >= 0) {
      const ships = racksCrateWouldShip(state);
      const x = this.colX(marked);
      // Danger round a rack the crate will smash; cream round one it will ship. A rack it only lands on has no ring.
      if (!fits) u.roundRect(...well(marked)).stroke({ width: ringW, color: INK.danger });
      else if (ships) u.roundRect(...well(marked)).stroke({ width: ringW, color: INK.cream });
      // A chevron under the crate: this is where it comes down.
      const cy = g.topY - g.cell * 0.3;
      const cw = g.cell * 0.2;
      o.poly([x - cw, cy - cw * 0.5, x + cw, cy - cw * 0.5, x, cy + cw * 0.6]).fill({ color: ink(trolleyColor(fits, ships)) });
      const base = state.racks[marked]!.length;
      for (let j = 0; j < ghosted; j++) {
        let s = this.ghosts[j];
        if (!s) {
          s = new Sprite();
          s.anchor.set(0.5);
          this.ghosts[j] = s;
          this.ghostLayer.addChild(s);
        }
        // Textures are dropped at a layout, so a ghost takes its own afresh each time it is shown.
        s.texture = this.texture(state.crate.cells[j]!.kind, true);
        s.scale.set(CRATE_SCALE);
        s.position.set(x, this.slotY(base + j));
        s.visible = true;
      }
    }

    // The lifted group is the player's own: an amber ring round it. Every rack that can take it shows where it would sit.
    if (lift) {
      const lowest = this.pieces.get(lift.ids[0]!);
      if (lowest) {
        const n = lift.ids.length;
        o.roundRect(lowest.s.x - g.cell * 0.5, lowest.s.y - (n - 0.5) * g.cell, g.cell, n * g.cell, g.cell * 0.22).stroke({ width: ringW, color: INK.amber });
      }
      const next = racksNextShipment(state);
      for (let to = 0; to < g.cols; to++) {
        if (to === lift.rack) continue;
        if (racksMovable(state, lift.rack, to) === 0) continue;
        drawDot(o, this.colX(to), this.slotY(state.racks[to]!.length), g.cell * 2, INK.cream);
        if (!racksWouldShip(state, lift.rack, to)) continue;
        // A rack the group would complete: ringed in cream, with what the shipment will score.
        u.roundRect(...well(to)).stroke({ width: ringW, color: INK.cream });
        const p = this.previews[to];
        if (p) {
          p.text = `+${next.points}`;
          p.visible = true;
        }
      }
    }

    // The keyboard's rack is the player's selection: an amber ring round its number.
    if (this.cursorShown && this.interactive) {
      const x = this.colX(this.cursor);
      const y = g.baseY + g.cell * 0.3;
      o.roundRect(x - g.cell * 0.3, y - g.cell * 0.2, g.cell * 0.6, g.cell * 0.4, g.cell * 0.12).stroke({ width: 2, color: INK.amber });
    }

    // A hint is cream, never amber: it is the board's advice, not the player's own mark.
    const hint = this.hint;
    if (hint && settled) {
      const a = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
      if (hint.type === "call" && this.hung) {
        const x = this.colX(this.hung.rack);
        const top = g.railY - g.cell * 0.4;
        o.roundRect(x - g.cell * 0.56, top, g.cell * 1.12, g.topY - g.cell * 0.42 - top, g.cell * 0.22).stroke({ width: ringW, color: INK.cream, alpha: a });
      } else if (hint.type === "move") {
        const group = racksTopGroup(state.racks[hint.from]!);
        const n = racksMovable(state, hint.from, hint.to);
        if (group && n > 0) {
          const len = state.racks[hint.from]!.length;
          const x0 = this.colX(hint.from);
          const yTop = this.slotY(len - 1) - g.cell * 0.5;
          o.roundRect(x0 - g.cell * 0.5, yTop, g.cell, n * g.cell, g.cell * 0.22).stroke({ width: ringW, color: INK.cream, alpha: a });
          o.circle(this.colX(hint.to), this.slotY(state.racks[hint.to]!.length), g.cell * 0.09).fill({ color: INK.cream, alpha: a });
        }
      }
    }
  }

  protected override update(dt: number): void {
    // The lifted group floats over its rack, or follows the finger while it is dragged.
    const lift = this.lifted;
    if (lift && this.state) {
      const g = this.geo;
      const len = this.state.racks[lift.rack]!.length;
      const n = lift.ids.length;
      lift.age += dt * this.tweens.rate;
      const k = 1 - (1 - Math.min(1, lift.age / MOTION.move)) ** 3;
      const drag = this.drag && this.drag.moved ? this.drag : null;
      lift.ids.forEach((id, i) => {
        const v = this.pieces.get(id);
        if (!v) return;
        if (drag) {
          const half = g.cell * 0.5;
          const x = Math.max(g.left + half, Math.min(g.left + g.pitch * g.cols - half, drag.x));
          const y = Math.max(g.railY + g.cell * n, Math.min(g.baseY - half, drag.y - g.cell * 0.9));
          v.s.position.set(x, y - i * g.cell);
        } else v.s.position.set(this.colX(lift.rack), this.slotY(len - n + i) - g.cell * LIFT_RISE * k);
      });
    }
    this.drawOverlays();
    // An action worth taking is marked after a pause, in rounds that allow hints.
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.lifted || this.busy) {
      this.idle = 0;
      this.hint = null;
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    if (this.hintFor !== this.state || !this.hint) {
      this.hintFor = this.state;
      this.hint = racksHint(this.state);
    }
  }

  // ---- lifting and setting down

  private dropLift(): void {
    const lift = this.lifted;
    this.lifted = null;
    this.drag = null;
    if (!lift || !this.state) return;
    const len = this.state.racks[lift.rack]!.length;
    lift.ids.forEach((id, i) => {
      const v = this.pieces.get(id);
      if (v) this.place(v, this.colX(lift.rack), this.slotY(len - lift.ids.length + i), 1);
    });
    this.touchView();
  }

  private lift(rack: number): boolean {
    const state = this.state;
    if (!state || state.finished) return false;
    const cells = state.racks[rack]!;
    const group = racksTopGroup(cells);
    if (!group) {
      sfx.bump();
      return false;
    }
    this.dropLift();
    const ids = cells.slice(cells.length - group.count).map((c) => c.id);
    this.lifted = { rack, ids, age: 0 };
    for (const id of ids) {
      const v = this.pieces.get(id);
      if (v) v.s.zIndex = 3;
    }
    this.idle = 0;
    this.hint = null;
    sfx.pop(Math.min(9, group.count - 1));
    return true;
  }

  /** Set the lifted group on `to`. Returns false, and puts it back, when the engine would refuse. */
  private setDown(to: number): boolean {
    const state = this.state;
    const lift = this.lifted;
    if (!state || !lift) return false;
    if (to === lift.rack) {
      this.dropLift();
      sfx.swapQuiet();
      return false;
    }
    if (racksMovable(state, lift.rack, to) === 0) {
      this.refuse(to);
      sfx.bump();
      return false;
    }
    const from = lift.rack;
    // The cells stay where they float: the move is played from there.
    this.lifted = null;
    this.drag = null;
    this.cb.onMove(from, to);
    return true;
  }

  private call(): void {
    const state = this.state;
    if (!state || state.finished) return;
    this.dropLift();
    this.cb.onCall();
  }

  /** A tap or a key on a rack: lift its top, put it back, or set the lifted group down there. */
  private pick(rack: number): void {
    if (this.busy) this.tweens.flush();
    this.idle = 0;
    this.hint = null;
    if (!this.lifted) this.lift(rack);
    else this.setDown(rack);
  }

  // ---- pointer

  /** What a point is on: the crate (the marked rack's column, above the racks) or a rack's column. */
  private target(x: number, y: number): { type: "crate" } | { type: "rack"; rack: number } | null {
    const g = this.geo;
    const rack = this.rackAtX(x);
    if (rack === null || y < g.panelTop || y > g.panelBottom) return null;
    if (this.state && rack === this.state.crate.rack && y < g.topY - g.cell * 0.25) return { type: "crate" };
    return { type: "rack", rack };
  }

  protected override pointerDown(x: number, y: number): void {
    const hit = this.target(x, y);
    if (!hit || !this.state || this.state.finished) return;
    this.cursorShown = false;
    if (hit.type === "crate") {
      if (this.busy) this.tweens.flush();
      this.call();
      return;
    }
    if (this.lifted && this.lifted.rack !== hit.rack) {
      // The second tap of tap, tap.
      this.pick(hit.rack);
      return;
    }
    const fresh = !this.lifted;
    if (fresh) {
      if (this.busy) this.tweens.flush();
      if (!this.lift(hit.rack)) return;
    }
    this.drag = { rack: hit.rack, fresh, moved: false, x, y };
  }

  protected override pointerMove(x: number, y: number): void {
    const d = this.drag;
    if (!d || !this.lifted) return;
    d.x = x;
    d.y = y;
    // The group follows the finger once it has left its own rack.
    if (!d.moved && this.rackAtX(x) !== d.rack) d.moved = true;
  }

  protected override pointerUp(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (!this.lifted) return;
    if (d.moved) {
      // A drag: set it down where it was let go, or put it back.
      const rack = this.rackAtX(x);
      if (rack === null || rack === d.rack || y < this.geo.panelTop || y > this.geo.panelBottom) {
        this.dropLift();
        sfx.swapQuiet();
      } else if (!this.setDown(rack)) this.dropLift();
      return;
    }
    // A tap on the rack that was already lifted puts the group back; a first tap leaves it floating.
    if (!d.fresh) {
      this.dropLift();
      sfx.swapQuiet();
    }
  }

  protected override pointerCancel(): void {
    this.dropLift();
  }

  // ---- keyboard

  /**
   * A digit lifts that rack's top or sets the lifted group down on it. Left and right move the
   * cursor; space, enter or up act on its rack; escape or down puts the group back. C calls the crate.
   */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state || this.state.finished) return false;
    const g = this.geo;
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (/^[1-9]$/.test(k)) {
      const rack = Number(k) - 1;
      if (rack >= g.cols) return false;
      this.cursor = rack;
      this.cursorShown = true;
      this.pick(rack);
      return true;
    }
    if (k === "ArrowLeft" || k === "a" || k === "ArrowRight" || k === "d") {
      const step = k === "ArrowLeft" || k === "a" ? -1 : 1;
      this.cursor = (this.cursor + step + g.cols) % g.cols;
      this.cursorShown = true;
      this.idle = 0;
      return true;
    }
    if (k === " " || k === "Enter" || k === "ArrowUp" || k === "w") {
      this.cursorShown = true;
      this.pick(this.cursor);
      return true;
    }
    if (k === "c") {
      if (this.busy) this.tweens.flush();
      this.call();
      return true;
    }
    if ((k === "Escape" || k === "ArrowDown" || k === "s") && this.lifted) {
      this.dropLift();
      sfx.swapQuiet();
      return true;
    }
    return false;
  }

  protected override onInteractive(on: boolean): void {
    if (!on) this.dropLift();
  }
}
