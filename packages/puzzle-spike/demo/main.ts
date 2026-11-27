// THROWAWAY SPIKE. A page to play the seven-line Swap on, drawn from events and read() alone.
import swapSource from "../examples/swap.puzzle.ts?raw";
import sparks from "../examples/sparks.puzzle.js";
import swap from "../examples/swap.puzzle.js";
import { expand, explain, hint, play, read, start, type AnyMove, type Cell, type Composed, type Event, type Piece, type Round } from "../src/index.js";

const PUZZLES: Record<string, { puzzle: Composed<any>; label: string; note: string }> = {
  swap: { puzzle: swap, label: "Swap", note: "The seven lines, and nothing else." },
  sparks: { puzzle: sparks, label: "Swap with sparks", note: "The same three stock parts and one part written by hand. A cream star is a spark: swap it to clear everything around it." },
};

// The stock skin: eight silhouettes, each told from the others by its outline alone.
const COLOURS = ["--sand", "--sky", "--moss", "--lilac", "--rose", "--teal", "--rust", "--slate"];
const SHAPES = [
  `<rect x="5" y="5" width="22" height="22" rx="4"/>`,
  `<circle cx="16" cy="16" r="12"/>`,
  `<path d="M16 4 29 27H3z"/>`,
  `<path d="M16 3 29 16 16 29 3 16z"/>`,
  `<path d="M9 4h14l7 12-7 12H9L2 16z"/>`,
  `<path d="M12 4h8v8h8v8h-8v8h-8v-8H4v-8h8z"/>`,
  `<path d="M4 8h24v6H4zM4 18h24v6H4z"/>`,
  `<path d="M16 4a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm0 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z" fill-rule="evenodd"/>`,
];
const SPARK = `<path d="M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12z"/>`;
const draw = (p: Piece): string =>
  p.piece === "kind" ? `<svg viewBox="0 0 32 32" fill="var(${COLOURS[(p.kind! - 1) % 8]})">${SHAPES[(p.kind! - 1) % 8]}</svg>` : `<svg viewBox="0 0 32 32" fill="var(--cream)">${SPARK}</svg>`;

let which = "swap";
let seed = 7;
let round: Round<AnyMove> = start(PUZZLES[which]!.puzzle, { seed });
let picked: Cell | null = null;
let shown: Cell[] = [];

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const same = (a: Cell | null, b: Cell): boolean => a !== null && a.x === b.x && a.y === b.y;
const at = (c: Cell): string => `column ${c.x + 1}, row ${c.y + 1}`;

function say(e: Event): string {
  const n = (e.fields.pieces as Cell[] | undefined)?.length;
  const pts = e.points === undefined ? "" : ` <b>+${e.points}</b>`;
  switch (e.event) {
    case "fill": return "A fresh board was dealt, already settled, with a move to make.";
    case "swap": return `Two pieces traded places (${at(e.fields.a as Cell)} and ${at(e.fields.b as Cell)}).`;
    case "clear": return `A line of ${n} cleared.${pts}`;
    case "rise": return `Pieces rose, and ${e.changes.filter((c) => c.change === "arrive").length} new ones came in from below.`;
    case "reshuffle": return "No move was left, so the loop dealt the board again.";
    case "burst": return `A spark cleared ${n} pieces around it.${pts}`;
    case "charge": return `A piece on the bottom row became a spark (${at(e.fields.at as Cell)}).`;
    default: return e.event;
  }
}

function render(): void {
  const r = read(round);
  $("board").style.gridTemplateColumns = `repeat(${r.board[0]!.length}, 1fr)`;
  $("board").innerHTML = r.board
    .flatMap((row, y) => row.map((p, x) => `<button class="cell${same(picked, { x, y }) ? " picked" : ""}${shown.some((c) => same(c, { x, y })) ? " shown" : ""}" data-x="${x}" data-y="${y}" aria-label="${at({ x, y })}">${p ? draw(p) : ""}</button>`))
    .join("");
  $("score").textContent = String(r.score);
  $("left").textContent = String(r.movesLeft);
  $("status").textContent = r.ended ? `The round is over: it ended on "${r.ended}".` : picked ? "Now click a piece beside it." : "Click a piece, then one beside it.";
  const last = round.last;
  $("events").innerHTML = last.refused
    ? `<li class="refused">Refused: ${esc(last.refused)}. Nothing changed.</li>`
    : last.events.map((e) => `<li><code>${e.event}</code> ${say(e)}</li>`).join("");
  $("note").textContent = PUZZLES[which]!.note;
  $("explain").textContent = explain(PUZZLES[which]!.puzzle);
  $("document").textContent = expand(PUZZLES[which]!.puzzle).document;
  $("doc-lines").textContent = String(expand(PUZZLES[which]!.puzzle).document.trimEnd().split("\n").length);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-puzzle]")) b.setAttribute("aria-pressed", String(b.dataset.puzzle === which));
  ($("seed") as HTMLInputElement).value = String(seed);
}

function move(m: AnyMove): void {
  round = play(round, m);
  picked = null;
  shown = [];
  render();
}
function fresh(): void {
  round = start(PUZZLES[which]!.puzzle, { seed });
  picked = null;
  shown = [];
  render();
}

$("board").addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".cell");
  if (!el) return;
  const c = { x: Number(el.dataset.x), y: Number(el.dataset.y) };
  if (!picked) return void ((picked = c), (shown = []), render());
  if (same(picked, c)) return void ((picked = null), render());
  move({ move: "swap", a: picked, b: c });
});
$("hint").addEventListener("click", () => {
  const h = hint(round) as { a: Cell; b: Cell } | null;
  shown = h ? [h.a, h.b] : [];
  picked = null;
  render();
});
$("play-hint").addEventListener("click", () => {
  const h = hint(round);
  if (h) move(h);
});
$("finish").addEventListener("click", () => {
  for (let h = hint(round); h && !read(round).ended; h = hint(round)) round = play(round, h);
  picked = null;
  shown = [];
  render();
});
$("illegal").addEventListener("click", () => move({ move: "swap", a: { x: 0, y: 0 }, b: { x: 3, y: 3 } }));
$("new").addEventListener("click", () => ((seed = Number(($("seed") as HTMLInputElement).value) || 1), fresh()));
$("next-seed").addEventListener("click", () => (seed++, fresh()));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-puzzle]")) b.addEventListener("click", () => ((which = b.dataset.puzzle!), fresh()));

$("source").textContent = swapSource.replace('"../src/index.js"', '"@openseas/puzzle"');
render();
