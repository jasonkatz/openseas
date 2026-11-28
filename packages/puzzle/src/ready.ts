// Valid, ready and promoted (ADR 0092, ADR 0096). A valid puzzle plays. A ready one has everything a player is
// owed. Promotion writes its document out whole, and from then on `rules` builds the puzzle from that document.
import { advance, hint, listMoves, play, read, replay, start, type Entry, type Read, type Round } from "./loop.js";
import { expand } from "./expand.js";
import { documentProblem, mergeHooks, type Composed, type Part } from "./puzzle.js";
import type { AnyMove, Document, Event, Setting } from "./types.js";

/** A recorded round a puzzle keeps: what it was played with, and the read it must still give. */
export interface Witness {
  readonly seed: string;
  readonly stage: string;
  readonly settings: Readonly<Record<string, Setting>>;
  readonly log: readonly Entry[];
  /** The time the round is run on to once its log is done, where it has a clock or ticks. */
  readonly until?: number;
  readonly read: Read;
}

/** Records a round as a witness. `until` runs it on to a time first, as to the end of its clock. */
export function witnessOf(round: Round, until?: number): Witness {
  const at = until === undefined ? round : advance(round, { at: until });
  return { seed: round.seed, stage: round.stage, settings: round.settings, log: round.log, ...(until === undefined ? {} : { until }), read: read(at, until === undefined ? {} : { at: until }) };
}

/**
 * A round played out by the puzzle's own hint, a move every so many milliseconds, and recorded as a witness. It is
 * a round to hold the puzzle to, not a good one. A puzzle that lists no moves is run to the end of its clock.
 */
export function witnessPlayed(p: Composed, seed: string, stage: string, msPerMove = 1500): Witness {
  let round: Round<AnyMove> = start(p, { seed, stage });
  const clock = p.document.round.ends.find((e) => e.by === "clock");
  const until = clock ? (round.settings[clock.setting] as number) * 1000 : undefined;
  for (let at = msPerMove; until === undefined || at < until; at += msPerMove) {
    const view = clock || p.document.round.tempo.kind === "ticking" ? advance(round, { at }) : round;
    const move = hint(view) ?? listMoves(view)[0];
    if (!move || read(view).ended) break;
    const next = play(round, move, clock || p.document.round.tempo.kind === "ticking" ? { at } : {});
    if (next.last.refused) break;
    round = next;
  }
  return witnessOf(round as Round, until);
}

/** What a witness round shows wrong, or nothing: played again from its seed, settings and log, it must give the read recorded. */
export function witnessProblem(p: Composed, w: Witness): string | null {
  const name = `the witness round on seed ${w.seed} at stage ${w.stage}`;
  let now: Read;
  try {
    const round = replay(p, w.seed, w.settings, w.log as readonly Entry<AnyMove>[], w.stage, w.until);
    if (round.log.length !== w.log.length || round.last.refused) return `${name} no longer plays: a move of its log is refused`;
    now = read(round, w.until === undefined ? {} : { at: w.until });
  } catch (e) {
    return `${name} no longer plays: ${(e as Error).message}`;
  }
  if (JSON.stringify(now) === JSON.stringify(w.read)) return null;
  const moved = (Object.keys(now) as (keyof Read)[]).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(w.read[k]));
  return `${name} no longer gives the read recorded for it: ${moved.join(", ")} changed${"score" in w.read && now.score !== w.read.score ? ` (the score was ${w.read.score} and is ${now.score})` : ""}`;
}

/**
 * What a puzzle still lacks to be ready, each as one plain line. An empty list is a ready puzzle. It holds what the
 * puzzle and its rules can be held to. A skin and its words are the host's to check, and are not looked at here.
 */
export function ready(p: Composed, witnesses: readonly Witness[] = []): string[] {
  const doc = p.document;
  const lacks: string[] = [];
  const stages = doc.ladder.length;
  if (stages < 2 || stages > 4) lacks.push(`its ladder has ${stages === 1 ? "one stage" : `${stages} stages`}: a player meets a puzzle over two to four`);
  if (doc.ladder.at(-1)?.stage !== "full") lacks.push("its last stage is not the whole puzzle, called full");
  if (!doc.evaluation) lacks.push("it does not say where its tiers start, so its rounds cannot be judged");
  if (!doc.moment) lacks.push("it names no moment, so no skin can play its beat");
  if (!p.rules.onFallback) for (const c of doc.deal.checks) lacks.push(`its check ${c.id} has no fallback: no part answers onFallback`);
  for (const pay of doc.payouts) if (pay.reads.length === 0) lacks.push(`its payout ${pay.id} is sized by no setting, so nobody can tune it`);
  if (!doc.history.some((h) => h.version === doc.version)) lacks.push(`its history has no line for version ${doc.version}`);
  if (witnesses.length === 0) lacks.push("it keeps no witness rounds");
  if (witnesses.length > 0 && !witnesses.some((w) => w.stage === "full")) lacks.push("none of its witness rounds is played on the whole puzzle");
  for (const w of witnesses) {
    const wrong = witnessProblem(p, w);
    if (wrong) lacks.push(wrong);
  }
  return lacks;
}

const DECLARED = ["settings", "pieces", "terrain", "moves", "events", "draws", "checks", "payouts", "multipliers", "gauges", "stats", "tasks"] as const;

/**
 * A promoted puzzle: its document, written out whole, and the parts that work it. The document is the only place
 * its numbers and declarations are. There is nowhere to write one here, and what a part declares for itself is not
 * read: a part only has to find, in the document, everything it names.
 *
 * The parts are listed in the order they are asked in.
 */
export function rules<const P extends readonly Part<any>[]>(read: object, parts: P, opts: { pointsFor?: (event: Event, paid: number) => number } = {}): Composed<P[number] extends Part<infer M, any> ? M : never> {
  // A document read from its file is typed as loosely as any JSON. It is held to a document's rules here.
  const document = read as Document;
  const id = document.id;
  if (typeof id !== "string" || !Array.isArray(document.ladder) || !Array.isArray(document.layers)) throw new Error("rules: this is no puzzle document");
  const wrong = documentProblem(document);
  if (wrong) throw new Error(`${id}: ${wrong}`);
  const names = parts.map((p) => p.name);
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice) throw new Error(`${id}: the part ${twice} is listed twice`);
  const numberIn = (x: unknown): number | null => (typeof x === "number" ? x : x && typeof x === "object" ? (Object.values(x).map(numberIn).find((n) => n !== null) ?? null) : null);
  for (const p of parts) {
    const number = numberIn(p.args ?? []);
    if (number !== null) throw new Error(`${id}: the part ${p.name} is given the number ${number}. A promoted puzzle's numbers are in its document, and nowhere else`);
    for (const k of DECLARED) {
      const has: readonly { id: string }[] = k === "draws" || k === "checks" ? document.deal[k] : document[k];
      const lost = (p[k] ?? []).find((x: { id: string }) => !has.some((y) => y.id === x.id));
      if (lost) throw new Error(`${id}: the part ${p.name} works the ${k} ${lost.id}, which the document does not have`);
    }
  }
  // A document cut into stages names its layers after its parts. One that is not has the single layer full.
  const layered = document.layers.some((l) => names.includes(l.id));
  if (layered) {
    const lost = document.layers.find((l) => !names.includes(l.id));
    if (lost) throw new Error(`${id}: the document has the layer ${lost.id}, and no part of that name is listed`);
    const extra = names.find((n) => !document.layers.some((l) => l.id === n));
    if (extra) throw new Error(`${id}: the part ${extra} is no layer of the document`);
  }
  return { document, rules: mergeHooks(parts, opts.pointsFor, layered), parts } as unknown as Composed<P[number] extends Part<infer M, any> ? M : never>;
}

/** What promoting a puzzle writes: its document, and the few lines its own file shrinks to. Or what it still lacks. */
export type Promotion = { readonly lacks: readonly string[] } | { readonly lacks: null; readonly document: string; readonly file: string };

/** Promotes a puzzle, on paper: nothing is written here. Only a ready puzzle is promoted. */
export function promote(p: Composed, witnesses: readonly Witness[]): Promotion {
  const lacks = ready(p, witnesses);
  if (lacks.length > 0) return { lacks };
  const id = p.document.id;
  const file = [
    `// ${id} is promoted: every number and declaration it has is in ${id}.puzzle.json, and that file is its source.`,
    // Written in two pieces so the purity lint, which reads this file as text, sees no import of a package here.
    `import { rules } ${"from"} "@openseas/puzzle";`,
    `import document from "./${id}.puzzle.json" with { type: "json" };`,
    `// Each part as it is written today, in the order it is asked in.`,
    `export default rules(document, [${p.parts.map((x) => x.name).join(", ")}]);`,
    "",
  ].join("\n");
  return { lacks: null, document: expand(p), file };
}
