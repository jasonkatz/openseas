/**
 * When a puzzle is ready (docs/puzzles/DOMAIN.md, "A puzzle is ready when"). `checkPuzzle` holds a
 * document to itself, `checkRules` holds the rules to the document both ways, and `unsupported`
 * names the parts of the guide this engine does not run yet. An engine is made only from a puzzle
 * that passes all three, so a host checks before it runs a round by making one.
 */
import { BROUGHT, versionOf, type PuzzleDoc, type Sized } from "./document.js";
import { valueProblem } from "./settings.js";

/** Everything the rules know, by id. */
export interface Knows {
  readonly layers: readonly string[];
  readonly settings: readonly string[];
  readonly terrain: readonly string[];
  readonly zones: readonly string[];
  readonly pieces: readonly string[];
  readonly moves: readonly string[];
  readonly controls: readonly string[];
  readonly events: readonly string[];
  readonly gauges: readonly string[];
  readonly payouts: readonly string[];
  readonly multipliers: readonly string[];
  readonly tasks: readonly string[];
  readonly draws: readonly string[];
  readonly checks: readonly string[];
  readonly secrets: readonly string[];
  readonly signals: readonly string[];
  readonly stats: readonly string[];
}

const WORD = /^[a-z][a-z0-9_]*$/;
const SETTING = /^[a-z][a-zA-Z0-9]*$/;
const GESTURES = ["tap", "long-press", "draw", "drag", "swipe", "slice", "turn", "hold"];
const MOVE_FIELDS = ["place", "places", "direction", "piece", "number", "flag"];
const EVENT_FIELDS = ["place", "places", "piece", "player", "number", "points"];
const CHANGES = ["arrive", "leave", "travel", "change"];

/** A moment's or a streak's condition: a number field, a comparison and a whole number. */
export function condition(text: string): { readonly field: string; readonly holds: (value: number) => boolean } | null {
  const m = /^\s*([a-zA-Z_]\w*)\s*(>=|<=|>|<|=)\s*(\d+)\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[3]);
  const op = m[2]!;
  return { field: m[1]!, holds: (v) => (op === ">" ? v > n : op === "<" ? v < n : op === ">=" ? v >= n : op === "<=" ? v <= n : v === n) };
}

/** What the puzzle's parts are called in the document, for every part a layer can bring and the rest the rules must know. */
function declared(doc: PuzzleDoc): Knows {
  const ids = (list: readonly { readonly id: string }[]): string[] => list.map((x) => x.id);
  return {
    layers: ids(doc.layers),
    settings: ids(doc.settings),
    terrain: ids(doc.terrain),
    zones: ids(doc.zones),
    pieces: ids(doc.pieces),
    moves: ids(doc.moves),
    controls: ids(doc.controls),
    events: ids(doc.events),
    gauges: ids(doc.gauges),
    payouts: ids(doc.payouts),
    multipliers: ids(doc.multipliers),
    tasks: ids(doc.tasks),
    draws: ids(doc.deal.draws),
    checks: ids(doc.deal.checks),
    secrets: ids(doc.deal.secrets),
    signals: ids(doc.signals.in),
    stats: ids(doc.stats),
  };
}

/** Every text key a puzzle must declare, from its own parts. */
export function requiredTexts(doc: PuzzleDoc): string[] {
  const keys = ["name", "how_to"];
  for (const s of doc.ladder) keys.push(`stage.${s.stage}`, `stage.${s.stage}_intro`);
  for (const p of doc.pieces) {
    const family = doc.settings.find((s) => s.id === p.family);
    if (family?.max !== undefined) for (let k = 1; k <= family.max; k++) keys.push(`piece.${p.id}_${k}`);
    else keys.push(`piece.${p.id}`);
  }
  for (const s of doc.stats) keys.push(`stat.${s.id}`);
  for (const g of doc.gauges) keys.push(`gauge.${g.id}`);
  for (const c of doc.controls) keys.push(`control.${c.id}`);
  return keys;
}

/** Every way the document falls short of ready. Empty when it is. */
export function checkPuzzle(doc: PuzzleDoc): string[] {
  try {
    return check(doc);
  } catch (e) {
    return [`the document is malformed: ${e instanceof Error ? e.message : String(e)}`];
  }
}

function check(doc: PuzzleDoc): string[] {
  const out: string[] = [];
  const bad = (text: string): void => void out.push(text);
  const d = declared(doc);
  const setting = new Map(doc.settings.map((s) => [s.id, s]));
  const event = new Map(doc.events.map((e) => [e.id, e]));
  const brought = (what: (typeof BROUGHT)[number], id: string): boolean => doc.layers.some((l) => l.brings[what]?.includes(id));
  const sized = (what: string, x: Sized | undefined): void => {
    if (x === undefined) return bad(`${what} is missing`);
    if (typeof x === "number") {
      if (!Number.isInteger(x) || x < 0) bad(`${what} must be a whole number or a setting`);
    } else if (setting.get(x)?.type !== "whole") bad(`${what} names ${x}, which is not a whole-number setting`);
  };

  if (!WORD.test(doc.id)) bad("the id must be a neutral lowercase word");
  if (!versionOf(doc.version)) bad("the version must be written major.minor");
  if (!doc.history.some((h) => h.version === doc.version && h.line.trim() !== "")) bad(`the history has no line for version ${doc.version}`);
  for (const h of doc.history) if (!versionOf(h.version)) bad(`the history's ${h.version} is not a version`);
  if (doc.mechanic.trim() === "") bad("the mechanic is empty");
  if (!d.moves.includes(doc.verb)) bad(`the verb ${doc.verb} is not a declared move`);

  for (const [name, list] of Object.entries(d)) {
    const seen = new Set<string>();
    for (const id of list) {
      if (seen.has(id)) bad(`${name} declares ${id} twice`);
      seen.add(id);
      if (!(name === "settings" ? SETTING : WORD).test(id)) bad(`${name}: ${id} is not a neutral word`);
    }
  }

  // The round.
  const tempo = doc.round.tempo;
  if (!["still", "ticking", "turns"].includes(tempo.kind)) bad("the tempo must be still, ticking or turns");
  if (tempo.kind === "ticking" && !(Number.isInteger(tempo.tickMs) && tempo.tickMs > 0)) bad("a ticking puzzle fixes its tick's length");
  if (tempo.kind === "turns" && !(tempo.turnSeconds > 0)) bad("a puzzle of turns fixes its turn's length");
  if (!(Number.isInteger(doc.round.logLimit) && doc.round.logLimit > 0)) bad("the log's cap must be a whole number above 0");
  for (const e of doc.round.ends) {
    if (e.by === "clock" || e.by === "budget" || e.by === "stock") {
      if (e.setting === undefined || setting.get(e.setting)?.type !== "whole") bad(`the ${e.by} ending must be sized by a whole-number setting`);
      else if (brought("settings", e.setting)) bad(`the ${e.by} ending's setting ${e.setting} must belong to the whole puzzle, not a layer`);
    } else if (e.by === "fail" || e.by === "outcome") {
      if (e.event === undefined || !event.has(e.event)) bad(`the ${e.by} ending must be named by a declared event`);
    } else bad(`no ending by ${String((e as { by: unknown }).by)}`);
  }

  // The board.
  if (doc.board.shape === "grid") {
    sized("the board's width", doc.board.width);
    sized("the board's height", doc.board.height);
    if (doc.board.touch !== 4 && doc.board.touch !== 8) bad("a grid's cells touch on 4 or 8");
  } else if (doc.board.shape === "rings") {
    sized("the board's rings", doc.board.rings);
    sized("the board's sectors", doc.board.sectors);
  } else bad("the board's shape must be grid or rings");
  for (const z of doc.zones) sized(`zone ${z.id}'s size`, z.holds);

  // Settings and their relations.
  const numberOf = (x: Sized): number | null => (typeof x === "number" ? x : typeof setting.get(x)?.default === "number" ? (setting.get(x)!.default as number) : null);
  for (const s of doc.settings) {
    if (!["whole", "percent", "permille", "list", "flag", "maps"].includes(s.type)) bad(`setting ${s.id} has no such type as ${s.type}`);
    if (!["board", "deal", "tempo", "scoring"].includes(s.group)) bad(`setting ${s.id} needs a group`);
    if (s.line.trim() === "") bad(`setting ${s.id} needs a line`);
    if (s.type !== "flag" && s.type !== "maps") {
      if (s.min === undefined || s.max === undefined || s.min > s.max) bad(`setting ${s.id} needs bounds`);
    }
    if (s.type === "list" && !s.entries) bad(`setting ${s.id} is a list and does not say how many entries it holds`);
    const p = valueProblem(s, s.default, numberOf);
    if (p) bad(`the default of ${p}`);
  }
  for (const r of doc.relations) {
    if (!setting.has(r.a)) bad(`a relation names ${r.a}, which is not a setting`);
    if (r.is === "ascending") {
      if (setting.get(r.a)?.type !== "list") bad(`only a list can be ascending, and ${r.a} is not one`);
    } else if (r.is === "fits") {
      if (r.b !== "board") bad(`${r.a} can only fit the board`);
    } else if (r.is === "at-most" || r.is === "below") {
      if (r.b === undefined || !setting.has(r.b)) bad(`a relation names ${String(r.b)}, which is not a setting`);
    } else bad(`no relation ${String((r as { is: unknown }).is)}`);
  }

  // The deal.
  for (const w of doc.deal.draws) {
    if (!["kind", "piece", "place", "map", "task", "number"].includes(w.gives)) bad(`draw ${w.id} gives nothing the guide names`);
    if (!["even", "weighted", "bag", "pick"].includes(w.by)) bad(`draw ${w.id} must be an even roll, a weighted roll, a bag or a pick`);
    for (const s of w.reads) if (!setting.has(s)) bad(`draw ${w.id} reads ${s}, which is not a setting`);
    if (typeof w.when === "object") {
      if (!setting.has(w.when.every)) bad(`draw ${w.id} is drawn every ${w.when.every}, which is not a setting`);
    } else if (!["start", "refill", "task", "tick"].includes(w.when)) bad(`draw ${w.id} does not say when it is drawn`);
  }
  for (const c of doc.deal.checks) {
    for (const w of c.draws) if (!d.draws.includes(w)) bad(`check ${c.id} covers ${w}, which is not a draw`);
    if (!(Number.isInteger(c.tries) && c.tries >= 1)) bad(`check ${c.id} must make a whole number of tries`);
    if (c.fallback.trim() === "") bad(`check ${c.id} needs a fallback that passes`);
    if (c.during !== undefined && !event.has(c.during)) bad(`check ${c.id} holds during play with ${c.during}, which is not an event`);
  }
  for (const b of doc.deal.bounds) {
    if (!setting.has(b.setting)) bad(`a bound names ${b.setting}, which is not a setting`);
    if (!d.draws.includes(b.caps)) bad(`a bound caps ${b.caps}, which is not a draw`);
  }
  for (const s of doc.deal.secrets) {
    if (s.revealedBy.length === 0) bad(`secret ${s.id} is never revealed`);
    for (const e of s.revealedBy) if (!event.has(e)) bad(`secret ${s.id} is revealed by ${e}, which is not an event`);
  }

  // Layers and the ladder.
  for (const what of BROUGHT) {
    const names = what === "draws" ? d.draws : d[what];
    const owner = new Map<string, string>();
    for (const l of doc.layers) {
      for (const id of l.brings[what] ?? []) {
        if (!names.includes(id)) bad(`layer ${l.id} brings ${id}, which is not among the puzzle's ${what}`);
        if (owner.has(id)) bad(`${id} is brought by ${owner.get(id)} and by ${l.id}`);
        owner.set(id, l.id);
      }
    }
  }
  for (const l of doc.layers) if (l.rule.trim() === "") bad(`layer ${l.id} needs its rule in one line`);
  if (doc.ladder.length < 2 || doc.ladder.length > 4) bad("the ladder has two to four stages");
  const last = doc.ladder[doc.ladder.length - 1];
  if (last?.stage !== "full") bad("the last stage is full");
  if (last?.advance) bad("the last stage has no threshold");
  const stages = new Set<string>();
  const added = new Map<string, number>();
  doc.ladder.forEach((s, i) => {
    if (stages.has(s.stage)) bad(`the ladder has stage ${s.stage} twice`);
    stages.add(s.stage);
    if (!WORD.test(s.stage)) bad(`stage ${s.stage} is not a neutral word`);
    for (const l of s.adds) {
      if (!d.layers.includes(l)) bad(`stage ${s.stage} adds ${l}, which is not a layer`);
      added.set(l, (added.get(l) ?? 0) + 1);
    }
    if (i < doc.ladder.length - 1) {
      const a = s.advance;
      if (!a || !["best-round", "average-of-last", "wins-over-stand-in", "rounds-played"].includes(a.measure) || !(a.threshold > 0)) bad(`stage ${s.stage} needs a threshold in one of the four measures`);
    }
  });
  for (const l of d.layers) if (added.get(l) !== 1) bad(`layer ${l} is added by ${added.get(l) ?? 0} stages, and must be added by exactly one`);

  // Judgement.
  const t = doc.evaluation.tierStarts;
  if (doc.opponents === undefined) {
    if (!t) bad("a solo puzzle declares its tier starts");
    else if (![t.steady, t.sharp, t.masterful, t.legendary].every((x, i, all) => Number.isInteger(x) && x > (i === 0 ? 0 : all[i - 1]!))) bad("tier starts are whole scores that rise from Steady to Legendary");
  } else if (doc.evaluation.by !== "outcome") bad("a puzzle between sides is judged by its outcome");
  if (!(doc.evaluation.paceWindowSeconds > 0)) bad("the pace's stretch must be longer than nothing");

  // Signals, pieces, moves and controls.
  for (const s of doc.signals.in) {
    if (!["number", "flag", "outcome"].includes(s.type)) bad(`signal ${s.id} must be a number, a flag or an outcome`);
    if (!["on-change", "sampled", "at-end"].includes(s.when)) bad(`signal ${s.id} does not say when it flows`);
  }
  for (const p of doc.pieces) {
    if (p.family !== undefined && setting.get(p.family)?.type !== "whole") bad(`piece ${p.id} is a family counted by ${p.family}, which is not a whole-number setting`);
    if (p.of !== undefined && !d.pieces.includes(p.of)) bad(`piece ${p.id} is based on ${p.of}, which is not a piece`);
    if (p.states && !Array.isArray(p.states)) sized(`piece ${p.id}'s count`, (p.states as { count: Sized }).count);
  }
  for (const m of doc.moves) {
    if (!GESTURES.includes(m.gesture)) bad(`move ${m.id} names no gesture the guide has`);
    if (m.line.trim() === "") bad(`move ${m.id} needs a line`);
    for (const [name, type] of Object.entries(m.fields)) if (!MOVE_FIELDS.includes(type)) bad(`move ${m.id}'s field ${name} has no such type as ${type}`);
  }
  for (const c of doc.controls) if (c.move !== undefined && c.move !== "none" && !d.moves.includes(c.move)) bad(`control ${c.id} makes ${c.move}, which is not a move`);

  // Events and the moment.
  const fieldsOf = (id: string, types: readonly string[]): string[] => Object.entries(event.get(id)?.fields ?? {}).flatMap(([name, type]) => (types.includes(type) ? [name] : []));
  for (const e of doc.events) {
    if (e.line.trim() === "") bad(`event ${e.id} needs a line`);
    for (const [name, type] of Object.entries(e.fields)) if (!EVENT_FIELDS.includes(type)) bad(`event ${e.id}'s field ${name} has no such type as ${type}`);
    if (fieldsOf(e.id, ["points"]).length > 1) bad(`event ${e.id} carries its points in one field`);
    for (const c of e.changes ?? []) if (!CHANGES.includes(c)) bad(`event ${e.id} carries ${c}, which is not a board change`);
  }
  const moment = doc.moment;
  if (!event.has(moment.event)) bad(`the moment names ${moment.event}, which is not an event`);
  else {
    const numbers = fieldsOf(moment.event, ["number"]);
    if (!numbers.includes(moment.size)) bad(`the moment is sized by ${moment.size}, which is not a number field of ${moment.event}`);
    if (moment.when !== undefined) {
      const c = condition(moment.when);
      if (!c) bad("the moment's condition must be a number field, a comparison and a whole number");
      else if (!numbers.includes(c.field)) bad(`the moment's condition reads ${c.field}, which is not a number field of ${moment.event}`);
    }
    sized("the moment's most", moment.most);
  }

  // Scoring.
  for (const p of doc.payouts) {
    if (p.line.trim() === "") bad(`payout ${p.id} needs a line`);
    if (p.on.length === 0) bad(`payout ${p.id} pays on no event`);
    for (const e of p.on) {
      if (!event.has(e)) bad(`payout ${p.id} pays on ${e}, which is not an event`);
      else {
        if (fieldsOf(e, ["points"]).length === 0) bad(`payout ${p.id} pays on ${e}, which has no points field`);
        if (p.counts !== undefined && !fieldsOf(e, ["number", "places"]).includes(p.counts)) bad(`payout ${p.id} counts ${p.counts}, which ${e} does not carry as a number or as places`);
      }
    }
    if (!["flat", "linear", "superlinear", "stepped"].includes(p.growth)) bad(`payout ${p.id} has no such growth as ${p.growth}`);
    if (p.growth === "flat" && p.counts !== undefined) bad(`payout ${p.id} is flat, so it counts nothing`);
    if (p.growth !== "flat" && p.counts === undefined) bad(`payout ${p.id} grows, so it must count a field`);
    for (const s of p.reads) if (!setting.has(s)) bad(`payout ${p.id} reads ${s}, which is not a setting`);
    const size = setting.get(p.reads[0] ?? "");
    if (!size) bad(`payout ${p.id} reads no setting to size it`);
    else if ((p.growth === "stepped") !== (size.type === "list")) bad(`payout ${p.id} is sized by ${size.id}: a stepped payout reads a list, and every other a number`);
    if (p.cap !== undefined) sized(`payout ${p.id}'s cap`, p.cap);
  }
  for (const m of doc.multipliers) {
    if (m.scales.length === 0) bad(`multiplier ${m.id} scales no payout`);
    for (const p of m.scales) if (!d.payouts.includes(p)) bad(`multiplier ${m.id} scales ${p}, which is not a payout`);
    if ("percent" in m.by) {
      if (setting.get(m.by.percent)?.type !== "percent") bad(`multiplier ${m.id} is sized by ${m.by.percent}, which is not a percent`);
    } else {
      if (setting.get(m.by.table)?.type !== "list") bad(`multiplier ${m.id}'s table ${m.by.table} is not a list`);
      if (m.by.index !== "streak" && m.by.index !== "step") bad(`multiplier ${m.id}'s table is indexed by the streak or by a cascade's step`);
      if (m.by.index === "streak" && !doc.streak) bad(`multiplier ${m.id} is indexed by a streak the puzzle does not declare`);
    }
  }
  if (doc.streak) {
    if (!(Number.isInteger(doc.streak.grace) && doc.streak.grace >= 0)) bad("the streak's grace is a whole number of misses");
    for (const e of doc.streak.breaksOn) if (!event.get(e)?.mistake) bad(`the streak breaks on ${e}, which is not a declared mistake`);
    if (!doc.multipliers.some((m) => "table" in m.by && m.by.index === "streak")) bad("the streak raises no multiplier");
    if (!d.stats.includes("best_streak")) bad("a puzzle with a streak keeps the stat best_streak");
  }
  for (const g of doc.gauges) {
    if (g.most !== undefined) sized(`gauge ${g.id}'s most`, g.most);
    if (g.danger !== undefined) sized(`gauge ${g.id}'s danger`, g.danger);
  }

  // Texts.
  const keys = new Set(doc.texts.map((x) => x.key));
  for (const k of requiredTexts(doc)) if (!keys.has(k)) bad(`the text key ${k} is not declared`);
  for (const x of doc.texts) {
    const m = /^event\.(.+)$/.exec(x.key);
    if (!m) continue;
    if (!event.has(m[1]!)) bad(`the text key ${x.key} names no event`);
    else for (const p of x.placeholders ?? []) if (!(p in event.get(m[1]!)!.fields)) bad(`the callout ${x.key} keeps a place for ${p}, which ${m[1]} does not carry`);
  }
  return out;
}

/** The rules know every part the puzzle declares, and declare nothing it lacks. */
export function checkRules(doc: PuzzleDoc, rules: { readonly id: string; readonly version: string; readonly knows: Knows }): string[] {
  const out: string[] = [];
  if (rules.id !== doc.id) out.push(`the rules are ${rules.id}'s, not ${doc.id}'s`);
  const [a, b] = [versionOf(rules.version), versionOf(doc.version)];
  // A change that raises the major changes the rules; they must be written for the document's major.
  if (!a || !b || a.major !== b.major) out.push(`the rules are written for version ${rules.version}, and the document is at ${doc.version}`);
  const d = declared(doc);
  for (const name of Object.keys(d) as (keyof Knows)[]) {
    const known = new Set(rules.knows[name]);
    const said = new Set(d[name]);
    for (const id of said) if (!known.has(id)) out.push(`the rules do not know the ${name} entry ${id}`);
    for (const id of known) if (!said.has(id)) out.push(`the rules know the ${name} entry ${id}, which the puzzle does not declare`);
  }
  return out;
}

/**
 * The parts of the guide this engine does not run yet (ADR 0085). A puzzle that declares one is
 * refused rather than run wrongly.
 */
export function unsupported(doc: PuzzleDoc): string[] {
  const out: string[] = [];
  if (doc.opponents !== undefined) out.push("rounds between sides are not run yet");
  if (doc.round.tempo.kind === "turns") out.push("turns are not run yet");
  if (doc.board.shape !== "grid") out.push("only a grid is run yet");
  if (doc.board.rim) out.push("a rim is not run yet");
  if (doc.terrain.length > 0) out.push("terrain is not run yet");
  if (doc.deal.secrets.length > 0) out.push("secrets are not run yet: they need a host that keeps the seed");
  if (doc.tasks.length > 0) out.push("tasks are not run yet");
  if (doc.settings.some((s) => s.type === "maps")) out.push("maps are not run yet");
  if (doc.pieces.some((p) => p.footprint !== undefined && p.footprint !== "one cell")) out.push("pieces of several cells are not run yet");
  return out;
}

/**
 * How big an event is as the puzzle's moment, from 0 to 1, or null when it is not the moment
 * (docs/puzzles/DOMAIN.md, "The moment and the beat"). Every skin of a puzzle plays its beat by this.
 */
export function momentOf(doc: PuzzleDoc, values: Readonly<Record<string, unknown>>, event: { readonly id: string; readonly fields: Readonly<Record<string, unknown>> }): number | null {
  const m = doc.moment;
  if (event.id !== m.event) return null;
  if (m.when !== undefined) {
    const c = condition(m.when);
    const v = c ? event.fields[c.field] : undefined;
    if (!c || typeof v !== "number" || !c.holds(v)) return null;
  }
  const size = event.fields[m.size];
  const most = typeof m.most === "number" ? m.most : values[m.most];
  if (typeof size !== "number" || typeof most !== "number" || most <= 0) return null;
  return Math.max(0, Math.min(1, size / most));
}
