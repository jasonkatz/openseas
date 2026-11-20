import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PuzzleId } from "@openseas/engine";
import { SHIPPED_PIECES, drawingProblems, t } from "@openseas/boards";
import { PALETTE, type Token } from "@openseas/boards/look";
import { DrawingSchema, type Drawing, type Layer, type LayerKind } from "@openseas/protocol";
import { useFrame } from "../frame/RoundFrame.jsx";
import { useBodyHeight, useBox } from "../studio/useBox.js";
import { useWidePanel } from "../studio/wide.js";
import { ALIKE, NUMBER_FIELDS, dragged, extent, fresh, handles, mask, overlap, paintPreview, snap } from "./sprite.js";

/**
 * The Sprites mode (ADR 0065): every piece the puzzle's board draws, as the layers on the 24 unit
 * square that `boards/data/pieces/<puzzle>.json` holds, and an editor for one of them. A change is
 * part of the draft, as a number is: the board draws it at once, a link carries it, and Save writes
 * it into the pieces file. The checks beside it are the brand book's (docs/BRAND.md section 3), as
 * notes: the owner decides.
 */

const KINDS: readonly LayerKind[] = ["rect", "disc", "poly", "bar", "arc", "path"];
const STAGE = 288;
/** The stage in a panel opened wide (ADR 0068): a piece large enough to place a handle by eye, as large as the room allows up to this. */
const WIDE_STAGE = 560;
const isToken = (v: unknown): v is Token => typeof v === "string" && v in PALETTE;
const tintOf = (d: Drawing): Token => (isToken(d.tint) ? d.tint : "cream");

/** A drawing painted into a canvas of its own, redrawn whenever it changes. */
function Picture({ drawing, px, color, fit = 1, testId }: { drawing: Drawing; px: number; color: Token; fit?: number; testId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(px * dpr);
    canvas.height = Math.round(px * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, px, px);
    paintPreview(ctx, drawing, px, color, fit);
  }, [drawing, px, color, fit]);
  return <canvas ref={ref} style={{ width: px, height: px }} aria-hidden="true" data-testid={testId} />;
}

/** Two names for one kind's variants (`sign-disc`, `sign-disc-hollow`): not held to looking unlike each other. */
const variants = (a: string, b: string): boolean => a.startsWith(`${b}-`) || b.startsWith(`${a}-`);

export function SpritePanel({ puzzle, focus, onFocus }: { puzzle: PuzzleId; focus: string | null; onFocus(name: string): void }) {
  const { look, setPiece } = useFrame();
  const shipped = SHIPPED_PIECES[puzzle];
  const names = Object.keys(shipped);
  const [mono, setMono] = useState(false);
  const name = focus && focus in shipped ? focus : (names[0] ?? null);
  const current = (n: string): Drawing => look.pieces[n] ?? shipped[n]!;

  if (!name) return <p className="panel-empty">{t("studio.sprites.none")}</p>;
  return (
    <div className="sprites" data-testid="sprites">
      <section className="panel-sec sprite-pieces">
        <div className="sprite-head">
          <h3 className="panel-cap">{t("studio.sprites.pieces", { count: names.length })}</h3>
          <label className="switch-label" title={t("studio.sprites.mono_hint")}>
            {t("studio.sprites.mono")}
            <input type="checkbox" role="switch" className="switch" checked={mono} onChange={(e) => setMono(e.target.checked)} data-testid="sprites-mono" />
          </label>
        </div>
        <div className="sprite-grid" role="listbox" aria-label={t("studio.sprites.pieces", { count: names.length })}>
          {names.map((n) => {
            const d = current(n);
            return (
              <button key={n} type="button" role="option" aria-selected={n === name} className="sprite-tile" title={n} onClick={() => onFocus(n)} data-testid={`piece-${n}`}>
                <Picture drawing={d} px={40} color={mono ? "cream" : tintOf(d)} fit={20 / 24} />
                <span className="sprite-tile-name mono">{n}</span>
                {n in look.pieces && <i className="rail-dot" data-testid={`piece-dot-${n}`} />}
              </button>
            );
          })}
        </div>
      </section>
      <SpriteEditor key={name} puzzle={puzzle} name={name} drawing={current(name)} shipped={shipped[name]!} others={names.filter((n) => n !== name).map((n) => [n, current(n)] as const)} onChange={(d) => setPiece(name, d)} />
    </div>
  );
}

function SpriteEditor({ puzzle, name, drawing, shipped, others, onChange }: { puzzle: PuzzleId; name: string; drawing: Drawing; shipped: Drawing; others: ReadonlyArray<readonly [string, Drawing]>; onChange(d: Drawing | null): void }) {
  const wide = useWidePanel();
  const room = useRef<HTMLElement>(null);
  const box = useBox(room, wide);
  // Wide, the editor is pinned in the panel's view, as tall as it, while the column beside it scrolls;
  // the stage takes the editor's width and leaves its height for the tools over and under it.
  const bodyH = useBodyHeight(room, wide);
  const fit = Math.floor(Math.min(WIDE_STAGE, box.width - 32, bodyH - 150));
  const stage = wide && box.width > 0 && bodyH > 0 ? Math.max(STAGE, fit) : STAGE;
  const [sel, setSel] = useState(0);
  // What the stage shows while a handle is held: the draft is written when it is let go.
  const [held, setHeld] = useState<Drawing | null>(null);
  const [past, setPast] = useState<Drawing[]>([]);
  const [fine, setFine] = useState(false);
  const shown = held ?? drawing;
  const layer = shown.layers[Math.min(sel, shown.layers.length - 1)];
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; start: Layer; ox: number; oy: number } | null>(null);
  const changed = JSON.stringify(drawing) !== JSON.stringify(shipped);
  const color = tintOf(drawing);

  const commit = (next: Drawing): void => {
    const ok = DrawingSchema.safeParse(next);
    if (!ok.success) return;
    setPast((p) => [...p.slice(-49), drawing]);
    onChange(ok.data);
  };
  const setLayer = (i: number, next: Layer): void => commit({ ...drawing, layers: drawing.layers.map((l, k) => (k === i ? next : l)) });
  const undo = (): void => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast(past.slice(0, -1));
    onChange(last);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = svg.current!.getBoundingClientRect();
    return [((e.clientX - box.left) / box.width) * 24, ((e.clientY - box.top) / box.height) * 24];
  };
  const step = (e: { altKey: boolean }): number => (e.altKey || fine ? 0.1 : 0.5);
  const down = (e: ReactPointerEvent, id: string): void => {
    if (!layer) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    drag.current = { id, start: layer, ox: snap(x, step(e)), oy: snap(y, step(e)) };
  };
  const move = (e: ReactPointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = at(e);
    const next = dragged(d.start, d.id, snap(x, step(e)), snap(y, step(e)), d.ox, d.oy);
    setHeld({ ...drawing, layers: drawing.layers.map((l, k) => (k === sel ? next : l)) });
  };
  const up = (): void => {
    if (!drag.current) return;
    drag.current = null;
    if (held) commit(held);
    setHeld(null);
  };

  // The checks: the layers' own, and what the raster shows.
  const notes = useMemo(() => {
    const out = drawingProblems(shown).map((p) => t(p.key, p.vars));
    if (!shown.detail) {
      const m = mask(shown);
      const box = extent(m);
      if (box && (box.x0 < 1.9 || box.y0 < 1.9 || box.x1 > 22.1 || box.y1 > 22.1)) out.push(t("studio.check.bounds"));
      let alike: [string, number] | null = null;
      for (const [other, d] of others) {
        if (d.detail || variants(name, other)) continue;
        const o = overlap(m, mask(d));
        if (o >= ALIKE && (!alike || o > alike[1])) alike = [other, o];
      }
      if (alike) out.push(t("studio.check.alike", { other: alike[0], percent: Math.round(alike[1] * 100) }));
    }
    return out;
  }, [shown, others, name]);

  return (
    <>
      <section ref={room} className="panel-sec sprite-edit" style={wide && bodyH > 0 ? { height: bodyH } : undefined} data-testid="sprite-editor">
        <div className="sprite-head">
          <h3 className="panel-cap">
            <code className="mono">{name}</code>
          </h3>
          <div className="sprite-tools">
            <button type="button" className="btn btn-mini" disabled={past.length === 0} onClick={undo} title={t("studio.sprites.undo")} data-testid="sprite-undo">
              {t("studio.sprites.undo")}
            </button>
            <button type="button" className="btn btn-mini" disabled={!changed} onClick={() => onChange(null)} data-testid="sprite-reset">
              {t("studio.put_back")}
            </button>
          </div>
        </div>
        {shown.detail && <p className="panel-note small">{t("studio.sprites.detail")}</p>}
        <div className="sprite-stage" style={{ width: stage, height: stage }}>
          {/* The grid lies under the piece, the handles over it. */}
          <svg viewBox="0 0 24 24" width={stage} height={stage} className="sprite-over sprite-under" aria-hidden="true">
            {Array.from({ length: 23 }, (_, i) => (
              <g key={i} className={i % 6 === 5 ? "grid-major" : "grid-minor"}>
                <line x1={i + 1} y1={0} x2={i + 1} y2={24} />
                <line x1={0} y1={i + 1} x2={24} y2={i + 1} />
              </g>
            ))}
            {/* The 20 units a piece fills. */}
            <rect x={2} y={2} width={20} height={20} className="grid-frame" />
          </svg>
          <Picture drawing={shown} px={stage} color={color} />
          <svg ref={svg} viewBox="0 0 24 24" width={stage} height={stage} className="sprite-over" onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="sprite-stage" aria-label={t("studio.sprites.stage", { piece: name })}>
            {layer &&
              handles(layer).map((h) => (
                <circle key={h.id} cx={h.x} cy={h.y} r={h.body ? 0.85 : 0.65} className={h.body ? "handle handle-body" : "handle"} onPointerDown={(e) => down(e, h.id)} data-testid={`handle-${h.id}`} />
              ))}
          </svg>
        </div>
        <div className="sprite-previews">
          <Picture drawing={shown} px={24} color={color} fit={20 / 24} />
          <Picture drawing={shown} px={48} color={color} fit={20 / 24} />
          <Picture drawing={shown} px={48} color="cream" fit={20 / 24} />
          <label className="switch-label small" title={t("studio.sprites.fine_hint")}>
            {t("studio.sprites.fine")}
            <input type="checkbox" role="switch" className="switch" checked={fine} onChange={(e) => setFine(e.target.checked)} />
          </label>
        </div>
        {notes.length > 0 && (
          <ul className="sprite-notes" data-testid="sprite-notes">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-sec sprite-layers">
        <h3 className="panel-cap">{t("studio.sprites.layers", { count: shown.layers.length })}</h3>
        <ol className="layers" data-testid="layers">
          {shown.layers.map((l, i) => (
            <li key={i} className={i === sel ? "is-selected" : ""} data-testid={`layer-${i}`}>
              <button type="button" className="layer-pick" onClick={() => setSel(i)} aria-pressed={i === sel}>
                <span className="mono layer-kind">{t(`studio.sprites.kind.${l.kind}`)}</span>
                <span className="layer-name">{l.name ?? ""}</span>
                {l.cut && <span className="cue-voice">{t("studio.sprites.cut")}</span>}
              </button>
              <button type="button" className="btn btn-mini btn-sq" disabled={i === 0} aria-label={t("studio.sprites.up")} title={t("studio.sprites.up")} onClick={() => { const ls = drawing.layers.slice(); [ls[i - 1], ls[i]] = [ls[i]!, ls[i - 1]!]; commit({ ...drawing, layers: ls }); setSel(i - 1); }}>
                ↑
              </button>
              <button type="button" className="btn btn-mini btn-sq" disabled={drawing.layers.length === 1} aria-label={t("studio.sprites.remove")} title={t("studio.sprites.remove")} onClick={() => { commit({ ...drawing, layers: drawing.layers.filter((_, k) => k !== i) }); setSel(Math.max(0, i - 1)); }} data-testid={`layer-remove-${i}`}>
                ×
              </button>
            </li>
          ))}
        </ol>
        <div className="layer-add">
          {KINDS.map((k) => (
            <button key={k} type="button" className="btn btn-mini" onClick={() => { commit({ ...drawing, layers: [...drawing.layers, fresh(k)] }); setSel(drawing.layers.length); }} data-testid={`layer-add-${k}`}>
              + {t(`studio.sprites.kind.${k}`)}
            </button>
          ))}
        </div>
      </section>

      {layer && <Inspector key={`${puzzle}.${name}.${sel}`} layer={layer} onChange={(l) => setLayer(sel, l)} />}
    </>
  );
}

/** A number typed in: set when it parses, left as typed until then. */
function NumberField({ label, value, onSet, step = 0.1, testId }: { label: string; value: number; onSet(v: number): void; step?: number; testId?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="insp-field">
      <span className="mono">{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(v)) onSet(v);
        }}
        data-testid={testId}
      />
    </label>
  );
}

/** Every number of the selected layer, its name, whether it is cut out, and how it is turned and repeated. */
function Inspector({ layer, onChange }: { layer: Layer; onChange(l: Layer): void }) {
  const fields = NUMBER_FIELDS[layer.kind];
  const record = layer as unknown as Record<string, number>;
  const [pointsText, setPointsText] = useState("");
  const listed = layer.kind === "poly" ? pairsText(layer.points) : layer.kind === "path" ? JSON.stringify(layer.steps) : "";
  useEffect(() => setPointsText(listed), [listed]);
  return (
    <section className="panel-sec sprite-insp" data-testid="inspector">
      <h3 className="panel-cap">{t("studio.sprites.layer", { kind: t(`studio.sprites.kind.${layer.kind}`) })}</h3>
      <label className="insp-field insp-wide">
        <span>{t("studio.sprites.name")}</span>
        <input type="text" value={layer.name ?? ""} maxLength={32} onChange={(e) => onChange({ ...layer, name: e.target.value || undefined })} />
      </label>
      <div className="insp-grid">
        {fields.map((f) => (
          <NumberField key={f} label={f} value={record[f] ?? 0} onSet={(v) => onChange({ ...layer, [f]: v } as Layer)} testId={`field-${f}`} />
        ))}
        <NumberField label="turn" value={layer.turn ?? 0} step={5} onSet={(v) => onChange({ ...layer, turn: v || undefined })} testId="field-turn" />
        <NumberField label="copies" value={layer.copies ?? 1} step={1} onSet={(v) => onChange({ ...layer, copies: Math.max(1, Math.round(v)) === 1 ? undefined : Math.max(1, Math.min(12, Math.round(v))) })} testId="field-copies" />
        <NumberField label="spread" value={layer.spread ?? 0} step={5} onSet={(v) => onChange({ ...layer, spread: v || undefined })} testId="field-spread" />
      </div>
      <div className="insp-flags">
        <label className="switch-label">
          {t("studio.sprites.cut")}
          <input type="checkbox" role="switch" className="switch" checked={layer.cut ?? false} onChange={(e) => onChange({ ...layer, cut: e.target.checked || undefined })} data-testid="field-cut" />
        </label>
        {(layer.kind === "arc" || layer.kind === "path") && (
          <label className="switch-label">
            {t("studio.sprites.round_ends")}
            <input type="checkbox" role="switch" className="switch" checked={layer.cap ?? false} onChange={(e) => onChange({ ...layer, cap: e.target.checked || undefined })} />
          </label>
        )}
        {layer.kind === "path" && (
          <label className="switch-label">
            {t("studio.sprites.filled")}
            <input type="checkbox" role="switch" className="switch" checked={layer.fill ?? false} onChange={(e) => onChange({ ...layer, fill: e.target.checked || undefined })} />
          </label>
        )}
      </div>
      {(layer.kind === "poly" || layer.kind === "path") && (
        <label className="insp-field insp-wide">
          <span>{t(layer.kind === "poly" ? "studio.sprites.points" : "studio.sprites.steps")}</span>
          <textarea
            rows={3}
            className="mono"
            value={pointsText}
            onChange={(e) => {
              setPointsText(e.target.value);
              if (layer.kind === "poly") {
                const nums = e.target.value.split(/[\s,;]+/).filter(Boolean).map(Number);
                if (nums.length >= 6 && nums.length % 2 === 0 && nums.every(Number.isFinite)) onChange({ ...layer, points: nums });
              } else {
                try {
                  const steps = JSON.parse(e.target.value) as unknown;
                  if (Array.isArray(steps)) onChange({ ...layer, steps } as Layer);
                } catch {
                  /* still being typed */
                }
              }
            }}
            data-testid="field-points"
          />
        </label>
      )}
    </section>
  );
}

const pairsText = (p: readonly number[]): string => {
  const out: string[] = [];
  for (let i = 0; i + 1 < p.length; i += 2) out.push(`${p[i]} ${p[i + 1]}`);
  return out.join(", ");
};
