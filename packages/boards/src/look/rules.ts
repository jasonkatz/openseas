import type { CueData, Drawing, Layer } from "@openseas/protocol";
import { CUE_PARAMS, LIMITS, PROBES, cueFrom, cueLength, type CueName, type CueParam } from "../cues.js";

/**
 * The brand book's rules as checks a page can show while a piece or a cue is being edited (ADR
 * 0065). Each problem is a key of the message table, under `studio.check.`, and what fills it in.
 *
 * A cue's checks are the ones `studio/test/sound.test.ts` holds every shipped cue to (docs/BRAND.md
 * section 8): they are hard. The studio plays a cue that breaks one as shipped instead, and Save
 * waits until it is mended. A drawing's are notes (section 3): what can be said of its layers
 * alone. Whether it fits the square and stands apart from its neighbours is seen on the raster, in
 * the studio's editor.
 */
export interface LookProblem {
  readonly key: string;
  readonly vars?: Readonly<Record<string, string | number>>;
}

/** The thinnest part a piece may have, in units of the 24 unit square. */
export const THINNEST = 3;
/** The least a piece's corner is rounded by, in units. */
export const ROUNDEST = 2;

/** How thin a layer's thinnest part is, in units. */
function thickness(layer: Layer): number {
  switch (layer.kind) {
    case "rect":
      return Math.min(layer.w, layer.h);
    case "disc":
      return layer.r * 2;
    case "poly":
      return Infinity;
    case "bar":
    case "arc":
      return layer.width;
    case "path":
      return layer.fill ? Infinity : layer.width;
  }
}

/** Notes on a drawing, by the rules of docs/BRAND.md section 3 that its layers show. */
export function drawingProblems(drawing: Drawing): LookProblem[] {
  const out: LookProblem[] = [];
  const solid = drawing.layers.filter((l) => !l.cut);
  if (solid.length === 0) out.push({ key: "studio.check.empty" });
  drawing.layers.forEach((layer, i) => {
    const name = layer.name ?? `${i + 1}`;
    if (!layer.cut && thickness(layer) < THINNEST) out.push({ key: "studio.check.thin", vars: { layer: name, least: THINNEST } });
    if (!layer.cut && layer.kind === "rect" && layer.r < ROUNDEST && Math.min(layer.w, layer.h) >= THINNEST) out.push({ key: "studio.check.sharp", vars: { layer: name, least: ROUNDEST } });
  });
  // One inner detail: the cut layers may be several shapes, but of one kind.
  const cuts = new Set(drawing.layers.filter((l) => l.cut).map((l) => l.kind));
  if (cuts.size > 1) out.push({ key: "studio.check.details" });
  return out;
}

/** Problems with a cue, over every row its board may ask it with: each is a rule of docs/BRAND.md section 8. */
export function cueProblems(name: CueName, data: CueData): LookProblem[] {
  const out: LookProblem[] = [];
  const params: readonly CueParam[] = CUE_PARAMS[name];
  const known = new Set(params.map((p) => p.name));
  const named = [data.shift?.param, data.swell?.param, data.alt?.when.param, ...data.voices.flatMap((v) => [v.when?.param, v.repeat?.param])];
  for (const p of new Set(named)) if (p !== undefined && !known.has(p)) out.push({ key: "studio.check.param", vars: { param: p } });
  const limit = name === "beat" ? LIMITS.beat : LIMITS.cue;
  let longest = 0;
  for (const args of PROBES[name] as readonly (readonly unknown[])[]) longest = Math.max(longest, cueLength(cueFrom(data, params, args)));
  if (longest > limit + 1e-9) out.push({ key: "studio.check.long", vars: { seconds: longest.toFixed(2), limit } });
  if (data.cutoff > LIMITS.cutoff || data.alt && data.alt.cutoff > LIMITS.cutoff) out.push({ key: "studio.check.bright", vars: { hz: LIMITS.cutoff } });
  data.voices.forEach((v, i) => {
    if (v.attack < LIMITS.attack) out.push({ key: "studio.check.attack", vars: { voice: i + 1, least: LIMITS.attack * 1000 } });
    if (v.kind === "air" && Math.max(v.from, v.to) > LIMITS.cutoff) out.push({ key: "studio.check.air", vars: { voice: i + 1, hz: LIMITS.cutoff } });
  });
  return out;
}
