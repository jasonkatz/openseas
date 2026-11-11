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
import { FONT, FONT_DISPLAY, INK, drawMark, drawPanel, drawPiece, kindStyle, mix, spriteName } from "../kit/art.js";
import { KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";

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
  showMarks: boolean;
  /** Pulse an action worth taking after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: RacksLabels;
}

interface CellView {
  s: Sprite;
  kind: number;
}

const HINT_AFTER_MS = 6000;
const CRATE = 0xc98a4b;
const LIFT = 0x7fd7ff;
/** A hanging crate's cells are drawn a little smaller than a racked one's. */
const CRATE_SCALE = 0.8;

/** Draws the racks and the crate, and turns taps, drags and keys into moves. Scores nothing: every number it shows is the engine's. */
export class RacksRenderer extends KitBoard<RacksState> {
  private readonly bg = new Graphics();
  private readonly under = new Graphics();
  private readonly crateBack = new Graphics();
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
  private geo = { cols: 5, rows: 5, crateMax: 3, pitch: 60, cell: 48, wellW: 54, left: 0, panelTop: 0, panelBottom: 0, railY: 0, topY: 0, baseY: 0, r: 18 };
  /** The crate as drawn: the rack it hangs over, how many cells its frame holds and the count on its badge. Null while it is coming down. */
  private hung: { rack: number; size: number; lands: number } | null = null;
  /** The rack whose top group is lifted, the cells in it, and the rack heights it was lifted at. */
  private lifted: { rack: number; ids: number[] } | null = null;
  private drag: { rack: number; fresh: boolean; moved: boolean; x: number; y: number } | null = null;
  /** The keyboard's rack. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private idle = 0;
  private hint: Extract<RacksMove, { type: "move" | "call" }> | null = null;
  private hintFor: RacksState | null = null;
  private hints: boolean;
  /** A wash over a rack that fades: its color and how much is left, 1 to 0. */
  private readonly glow: Array<{ color: number; k: number }> = [];

  constructor(
    host: HTMLElement,
    private readonly cb: RacksCallbacks,
    private readonly opts: RacksRendererOptions,
  ) {
    super(host, "racks", cb.onFrame, opts.showMarks);
    this.hints = opts.hints;
  }

  override setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT, fontSize: 16, fontWeight: "700", fill: INK.text, letterSpacing: 0.4 } });
    this.label.anchor.set(0.5);
    this.badgeText = new Text({ text: "", style: { fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: "900", fill: INK.black } });
    this.badgeText.anchor.set(0.5);
    this.crateBadge.addChild(this.badgeBox, this.badgeText);
    this.pieceLayer.sortableChildren = true;
    this.textLayer.addChild(this.label);
    this.world.addChild(this.bg, this.under, this.crateBack, this.pieceLayer, this.over, this.crateBadge, this.textLayer);
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
    g.r = Math.min(g.cell * 0.4, g.wellW * 0.42);
    const blockW = g.pitch * g.cols;
    const blockH = labelH + (g.rows + gantry + footer) * g.cell;
    g.left = Math.floor((width - blockW) / 2);
    g.panelTop = Math.floor((height - blockH) / 2) - pad;
    g.panelBottom = g.panelTop + blockH + pad * 2;
    g.railY = g.panelTop + pad + labelH + g.cell * 0.31;
    g.topY = g.panelTop + pad + labelH + gantry * g.cell;
    g.baseY = g.topY + g.rows * g.cell;

    this.bg.clear();
    drawPanel(this.bg, g.left - pad, g.panelTop, blockW + pad * 2, blockH + pad * 2, Math.max(10, g.cell * 0.3));
    // The rail the crate's trolley hangs from.
    const railH = Math.max(4, g.cell * 0.1);
    this.bg.roundRect(g.left + 2, g.railY - railH / 2, blockW - 4, railH, railH / 2).fill({ color: mix(INK.brass, INK.black, 0.35) });
    this.bg.roundRect(g.left + 2, g.railY - railH / 2, blockW - 4, railH * 0.4, railH / 2).fill({ color: INK.brass, alpha: 0.7 });
    for (let r = 0; r < g.cols; r++) {
      const x = this.colX(r) - g.wellW / 2;
      // A rack: an open-topped well, a tick for each slot, a brass foot.
      this.bg.roundRect(x, g.topY - 3, g.wellW, g.rows * g.cell + 6, g.cell * 0.2).fill({ color: INK.well });
      this.bg.roundRect(x, g.topY - 3, g.wellW, g.rows * g.cell + 6, g.cell * 0.2).stroke({ width: 1.5, color: INK.line });
      for (let i = 1; i < g.rows; i++) this.bg.rect(x + g.wellW * 0.12, g.baseY - i * g.cell - 0.5, g.wellW * 0.76, 1).fill({ color: INK.line, alpha: 0.7 });
      this.bg.roundRect(x - 2, g.baseY + 2, g.wellW + 4, Math.max(3, g.cell * 0.08), 2).fill({ color: INK.brass, alpha: 0.6 });
    }
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.min(19, Math.round(g.cell * 0.34)));
      this.label.position.set(width / 2, g.panelTop + pad + labelH * 0.46);
      this.label.style.wordWrap = false;
    }
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
      const d = new Text({ text: String(this.digits.length + 1), style: { fontFamily: FONT, fontSize: 12, fontWeight: "700", fill: INK.dim } });
      d.anchor.set(0.5);
      this.digits.push(d);
      this.textLayer.addChild(d);
      const p = new Text({ text: "", style: { fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: "900", fill: INK.gold, stroke: { color: 0x000000, width: 3 } } });
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

  private texture(kind: number): Texture {
    const g = this.geo;
    return this.bake(`${kind}:${this.showMarks ? 1 : 0}`, g.cell, (gr) => {
      if (this.sprite(gr, spriteName("cell", kind), 0, 0, g.r * 2.2)) {
        if (this.showMarks) drawMark(gr, kind, 0, 0, g.r);
      } else drawPiece(gr, kind, 0, 0, g.r, { marks: this.showMarks });
    });
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
    // Two cables from the trolley to the frame, then the frame: an open cage, so the cells in it read.
    for (const side of [-1, 1]) b.rect(side * w * 0.32 - 1, trolleyBottom - 2, 2, top - trolleyBottom + 4).fill({ color: mix(CRATE, INK.black, 0.3) });
    b.roundRect(-w / 2, top, w, h, g.cell * 0.14).fill({ color: mix(CRATE, INK.black, 0.72), alpha: 0.85 });
    b.roundRect(-w / 2, top, w, h, g.cell * 0.14).stroke({ width: Math.max(2, g.cell * 0.06), color: CRATE });
    for (let j = 1; j < n; j++) b.rect(-w / 2 + 2, bottom - Math.max(2, g.cell * 0.05) - j * g.cell * CRATE_SCALE - 0.5, w - 4, 1).fill({ color: CRATE, alpha: 0.45 });
    b.position.set(this.colX(crate.rack), dy);
    b.alpha = alpha;
    this.crateBadge.position.set(this.colX(crate.rack), g.railY + dy);
    this.crateBadge.alpha = alpha;
    this.crateBadge.scale.set(1);
    this.drawBadge();
  }

  /** The trolley on the rail, with the moves left on it: brass, red when the crate has no room, gold when it will ship its rack. */
  private drawBadge(): void {
    const g = this.geo;
    const state = this.state;
    const w = g.cell * 0.86;
    const h = g.cell * 0.56;
    const tight = state !== null && !racksCrateFits(state);
    const ships = state !== null && racksCrateWouldShip(state);
    const color = tight ? INK.danger : ships ? INK.gold : INK.brass;
    this.badgeBox.clear();
    this.badgeBox.roundRect(-w / 2, -h / 2 + 1.5, w, h, h * 0.3).fill({ color: INK.black, alpha: 0.35 });
    this.badgeBox.roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill({ color });
    this.badgeBox.roundRect(-w / 2, -h / 2, w, h, h * 0.3).stroke({ width: Math.max(1.5, g.cell * 0.05), color: mix(color, INK.black, 0.5) });
    if (this.badgeText) {
      this.badgeText.text = this.hung ? String(this.hung.lands) : "";
      this.badgeText.style.fill = tight ? INK.white : INK.black;
    }
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
      this.label.style.fill = INK.gold;
    } else if (!racksCrateFits(state)) {
      this.label.text = l.noRoom(n);
      this.label.style.fill = INK.danger;
    } else if (racksCrateWouldShip(state)) {
      this.label.text = l.willShip(n);
      this.label.style.fill = INK.gold;
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
          const arc = g.cell * (0.7 + 0.12 * Math.abs(e.to - e.from));
          e.ids.forEach((id, i) => {
            const v = this.pieces.get(id);
            if (!v) return;
            v.s.zIndex = 3;
            const x0 = v.s.x;
            const y0 = v.s.y;
            const x1 = this.colX(e.to);
            const y1 = this.slotY(base + i);
            this.tweens.run(
              170,
              (k) => {
                v.s.position.set(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - Math.sin(Math.PI * k) * arc);
                v.s.scale.set(1 + 0.1 * Math.sin(Math.PI * k));
              },
              { delay: t + i * 22, ease: ease.inOutCubic, done: () => (v.s.zIndex = 0) },
            );
          });
          at(t, () => (ships ? sfx.swap() : sfx.swapQuiet()));
          t += 170 + (e.ids.length - 1) * 22 + 10;
          break;
        }
        case "ship": {
          const ids = model[e.rack]!.slice().reverse();
          model[e.rack] = [];
          const x = this.colX(e.rack);
          const color = kindStyle(e.kind).color;
          at(t, () => this.flashRack(e.rack, INK.gold));
          // The cells slide out of the top, top first, on a rising run of notes.
          ids.forEach((id, i) => {
            const v = this.pieces.get(id);
            if (!v) return;
            this.pieces.delete(id);
            v.s.zIndex = 2;
            const start = t + 70 + i * 55;
            this.tweens.after(start, () => sfx.pop(Math.min(9, (e.chain - 1) * 2 + i)));
            this.tweens.to(v.s, { y: g.panelTop - g.cell, alpha: 0.1 }, 250, { delay: start, ease: ease.inBack, done: () => v.s.destroy() });
          });
          const done = t + 70 + (ids.length - 1) * 55 + 130;
          this.tweens.after(done, () => {
            sfx.clear(e.chain, ids.length);
            this.fx.popup(x, g.topY + g.cell * 0.4, `+${e.points}`, INK.gold, Math.max(16, g.cell * (e.chain >= 2 ? 0.62 : 0.46)));
            this.fx.burst(x, g.topY, color, 8 + e.chain * 3, 0.22, 4);
            this.fx.ring(x, g.topY + g.cell * 0.2, color, g.cell * 0.3, g.cell * (1 + e.chain * 0.3), 420, 3);
            if (e.chain >= 2) {
              this.fx.say(l.chain(e.chain), INK.gold);
              sfx.multi(e.chain);
            } else if (e.byCrate) this.fx.say(l.delivered, CRATE);
            if (e.chain >= 3) {
              this.fx.shake(Math.min(12, 3 + e.chain * 2), 260);
              this.fx.flash(INK.gold, 0.14, 260);
              sfx.streak(e.chain * 2);
            }
          });
          t = done + 130;
          break;
        }
        case "spill": {
          // The crate is already on its way down (the land that follows starts now); the rack bursts as it hits.
          const ids = model[e.rack]!.slice();
          model[e.rack] = [];
          const x = this.colX(e.rack);
          const hit = t + 160;
          ids.forEach((id, i) => {
            const v = this.pieces.get(id);
            if (!v) return;
            this.pieces.delete(id);
            v.s.zIndex = 2;
            const dir = (((id * 7 + i * 3) % 5) - 2) / 2 || 0.5;
            this.tweens.to(v.s, { x: v.s.x + dir * g.cell * 1.8, y: g.panelBottom + g.cell, rotation: dir * 2.6, alpha: 0 }, 430, { delay: hit + i * 16, ease: ease.inCubic, done: () => v.s.destroy() });
          });
          this.tweens.after(hit, () => {
            sfx.crack(true);
            this.flashRack(e.rack, INK.danger);
            this.fx.flash(INK.danger, 0.2, 320);
            this.fx.shake(9, 320);
            this.fx.say(l.smashed, INK.danger);
            this.fx.burst(x, g.baseY - g.cell, INK.danger, 14, 0.3, 4);
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
            this.tweens.to(v.s, { x, y: this.slotY(base + j), scale: 1 }, 190, { delay: start, ease: ease.inCubic, done: () => (v.s.zIndex = 0) });
          });
          // The empty frame is hauled back up the cables.
          at(start, () => (this.hung = null));
          this.tweens.to(this.crateBack, { alpha: 0, y: -g.cell * 0.4 }, 150, { delay: start });
          this.tweens.to(this.crateBadge, { alpha: 0 }, 150, { delay: start });
          this.tweens.after(start + 190, () => {
            sfx.thud();
            this.fx.burst(x, this.slotY(base) + g.cell * 0.4, INK.dim, 6, 0.14, 3);
            if (e.called) this.fx.shake(3, 140);
          });
          landed = true;
          t = start + 210;
          break;
        }
        case "deal": {
          // The next crate runs out along the rail and drops to the end of its cables.
          const crate = e.crate;
          const rise = g.cell * 0.9;
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
          views.forEach((v, j) => this.tweens.to(v.s, { y: this.hangY(j), alpha: 1 }, 210, { delay: t + 1, ease: ease.outBack }));
          this.tweens.to(this.crateBack, { y: 0, alpha: 1 }, 210, { delay: t + 1, ease: ease.outBack });
          this.tweens.to(this.crateBadge, { y: g.railY, alpha: 1 }, 210, { delay: t + 1, ease: ease.outBack });
          t += 215;
          break;
        }
      }
    }
    if (!landed) {
      // The crate only came a step nearer: its count ticks down.
      const lands = state.crate.lands;
      if (this.hung) this.hung = { ...this.hung, lands };
      this.drawBadge();
      this.crateBadge.scale.set(1.35);
      this.tweens.to(this.crateBadge, { scale: 1 }, 220, { ease: ease.outBack });
      sfx.tick(lands <= 1);
    }
    if (prev.combo >= 2 && state.combo === 0 && !report.events.some((e) => e.type === "spill")) at(t, () => sfx.streakLost());
    // Whatever the tweens did, the racks end as the engine holds them.
    this.tweens.after(Math.max(t, 1), () => {
      this.snap(state);
      this.drawOverlays();
    });
  }

  private flashRack(rack: number, color: number): void {
    this.glow[rack] = { color, k: 1 };
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
    if (!state) return;
    const well = (rack: number): [number, number, number, number, number] => [this.colX(rack) - g.wellW / 2, g.topY - 3, g.wellW, g.rows * g.cell + 6, g.cell * 0.2];
    const settled = !this.busy;
    const pulse = 0.5 + 0.5 * Math.sin(this.time / 170);

    this.glow.forEach((f, rack) => {
      if (!f || f.k <= 0 || rack >= g.cols) return;
      u.roundRect(...well(rack)).fill({ color: f.color, alpha: 0.45 * f.k });
    });

    // The marked rack: where the crate's cells will sit, or a warning that they will not.
    if (settled && !state.finished && this.hung) {
      const rack = state.crate.rack;
      const fits = racksCrateFits(state);
      const ships = racksCrateWouldShip(state);
      const color = fits ? (ships ? INK.gold : CRATE) : INK.danger;
      const x = this.colX(rack);
      if (!fits) u.roundRect(...well(rack)).fill({ color: INK.danger, alpha: 0.1 + 0.12 * pulse });
      u.roundRect(...well(rack)).stroke({ width: fits ? 2 : 3, color, alpha: fits ? 0.75 : 0.6 + 0.4 * pulse });
      // A chevron under the crate: this is where it comes down.
      const cy = g.topY - g.cell * 0.3 + (fits ? 0 : pulse * g.cell * 0.06);
      const cw = g.cell * 0.2;
      o.poly([x - cw, cy - cw * 0.5, x + cw, cy - cw * 0.5, x, cy + cw * 0.6]).fill({ color, alpha: 0.9 });
      const lift = this.lifted;
      if (fits && (!lift || lift.rack !== rack)) {
        const base = state.racks[rack]!.length;
        state.crate.cells.forEach((c, j) => {
          const y = this.slotY(base + j);
          if (!this.sprite(u, spriteName("target", c.kind), x, y, g.r * 2, 0.7)) drawPiece(u, c.kind, x, y, g.r * 0.9, { hollow: true, alpha: 0.5 });
        });
      }
    }

    // The lifted group's rack, and every rack that can take it.
    const lift = this.lifted;
    if (lift) {
      u.roundRect(...well(lift.rack)).stroke({ width: 2.5, color: LIFT, alpha: 0.9 });
      const next = racksNextShipment(state);
      for (let to = 0; to < g.cols; to++) {
        if (to === lift.rack) continue;
        const n = racksMovable(state, lift.rack, to);
        if (n === 0) {
          u.roundRect(...well(to)).fill({ color: INK.black, alpha: 0.28 });
          continue;
        }
        const ships = racksWouldShip(state, lift.rack, to);
        const color = ships ? INK.gold : LIFT;
        u.roundRect(...well(to)).fill({ color, alpha: ships ? 0.16 + 0.1 * pulse : 0.1 });
        u.roundRect(...well(to)).stroke({ width: ships ? 3 : 2, color, alpha: ships ? 0.7 + 0.3 * pulse : 0.55 });
        if (ships) {
          const p = this.previews[to];
          if (p) {
            p.text = `+${next.points}`;
            p.visible = true;
          }
        }
      }
    }

    if (this.cursorShown && this.interactive) {
      const x = this.colX(this.cursor);
      const y = g.baseY + g.cell * 0.3;
      o.roundRect(x - g.cell * 0.3, y - g.cell * 0.2, g.cell * 0.6, g.cell * 0.4, g.cell * 0.12).stroke({ width: 2, color: INK.white, alpha: 0.9 });
    }

    const hint = this.hint;
    if (hint && settled) {
      const a = 0.35 + 0.35 * pulse;
      if (hint.type === "call" && this.hung) {
        const x = this.colX(this.hung.rack);
        const top = this.hangY(this.hung.size - 1) - g.cell * 0.5;
        o.roundRect(x - g.cell * 0.56, top, g.cell * 1.12, g.topY - g.cell * 0.4 - top, g.cell * 0.2).stroke({ width: 3, color: INK.gold, alpha: a });
        o.circle(x, g.railY, g.cell * 0.56).stroke({ width: 3, color: INK.gold, alpha: a });
      } else if (hint.type === "move") {
        const group = racksTopGroup(state.racks[hint.from]!);
        const n = racksMovable(state, hint.from, hint.to);
        if (group && n > 0) {
          const len = state.racks[hint.from]!.length;
          const x0 = this.colX(hint.from);
          const yTop = this.slotY(len - 1) - g.cell * 0.5;
          o.roundRect(x0 - g.wellW / 2 + 2, yTop, g.wellW - 4, n * g.cell, g.cell * 0.2).stroke({ width: 3, color: LIFT, alpha: a });
          const x1 = this.colX(hint.to);
          const y1 = this.slotY(state.racks[hint.to]!.length);
          o.circle(x1, y1, g.r).stroke({ width: 3, color: LIFT, alpha: a });
          // A line over the tops from the group to where it goes.
          const peak = g.topY - g.cell * 0.12;
          o.moveTo(x0, yTop - 2).lineTo(x0, peak).lineTo(x1, peak).lineTo(x1, y1 - g.r - 2).stroke({ width: 2.5, color: LIFT, alpha: a * 0.8, cap: "round", join: "round" });
        }
      }
    }
  }

  protected override update(dt: number): void {
    for (const f of this.glow) if (f && f.k > 0) f.k = Math.max(0, f.k - dt / 420);
    // The lifted group floats: a slow bob over its rack, or under the finger while it is dragged.
    const lift = this.lifted;
    if (lift && this.state) {
      const g = this.geo;
      const len = this.state.racks[lift.rack]!.length;
      const n = lift.ids.length;
      const bob = Math.sin(this.time / 210) * g.cell * 0.035;
      const drag = this.drag && this.drag.moved ? this.drag : null;
      lift.ids.forEach((id, i) => {
        const v = this.pieces.get(id);
        if (!v) return;
        if (drag) {
          const half = g.cell * 0.5;
          const x = Math.max(g.left + half, Math.min(g.left + g.pitch * g.cols - half, drag.x));
          const y = Math.max(g.railY + g.cell * n, Math.min(g.baseY - half, drag.y - g.cell * 0.9));
          v.s.position.set(x, y - i * g.cell);
        } else v.s.position.set(this.colX(lift.rack), this.slotY(len - n + i) - g.cell * 0.4 + bob);
      });
    }
    this.drawBadgePulse();
    this.drawOverlays();
    // An action worth taking pulses after a pause, in rounds that allow hints.
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

  /** The trolley throbs when the crate has no room, faster on its last move. */
  private drawBadgePulse(): void {
    const state = this.state;
    if (!state || this.busy || !this.hung || state.finished) return;
    if (racksCrateFits(state)) return;
    const rate = state.crate.lands <= 1 ? 90 : 170;
    this.crateBadge.scale.set(1 + 0.08 * (0.5 + 0.5 * Math.sin(this.time / rate)));
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
    this.lifted = { rack, ids };
    for (const id of ids) {
      const v = this.pieces.get(id);
      if (!v) continue;
      v.s.zIndex = 3;
      v.s.scale.set(1.1);
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
      this.flashRack(to, INK.danger);
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
