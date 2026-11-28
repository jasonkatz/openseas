import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MOTION, css, paintDrawing, stockPiece, t } from "@openseas/boards";
import { budget, expand, explain, grid, hint, lines, play, puzzle, read, refill, seenAfter, seenEmpty, start, swap, type Cell, type Event, type Round, type Seen, type SwapMove } from "@openseas/puzzle";
import { Link } from "../router.jsx";
import "./rungs.css";

/**
 * Swap, the puzzle of seven lines (ADR 0092), played on the new engine. It is the proof of rungs 0
 * and 1: `start`, `play` and `read` are all this page calls, and the board is drawn from a round's
 * events alone, in the stock skin. It never reads the round's state to draw: `data-view` is what the
 * events made and `data-board` is what the engine holds, and the smoke holds the two equal.
 */
const SWAP = puzzle("swap", {
  board: grid(6, 7),
  pieces: 5,
  parts: [swap(), lines(3), refill()],
  ends: budget(20),
});

const CELL = 24;
const kindsOf = (board: Seen): string => board.map((row) => row.map((p) => p?.kind ?? 0).join("")).join("/");
const same = (a: Cell | null, b: Cell): boolean => a !== null && a.x === b.x && a.y === b.y;
/** How long one event plays: a clear a little longer than a move, as the look's motion has it. */
const msOf = (e: Event): number => (e.changes.some((c) => c.change === "leave") ? MOTION.clear : MOTION.move) + 40;

interface Playing {
  /** The board before the event being played. */
  readonly from: Seen;
  readonly queue: readonly Event[];
  readonly since: number;
}

function paint(canvas: HTMLCanvasElement, board: Seen, playing: { event: Event; t: number } | null, cursor: Cell, picked: Cell | null, hinted: SwapMove | null): void {
  const height = board.length;
  const width = board[0]!.length;
  const scale = canvas.width / (width * CELL);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width * CELL, height * CELL);
  ctx.fillStyle = css("raised");
  ctx.fillRect(0, 0, width * CELL, height * CELL);

  const piece = (kind: number, x: number, y: number, size = 1, alpha = 1): void => {
    const { drawing, color } = stockPiece(kind);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x * CELL + CELL / 2, y * CELL + CELL / 2);
    ctx.scale(size * 0.82, size * 0.82);
    ctx.translate(-12, -12);
    ctx.fillStyle = ctx.strokeStyle = css(color);
    paintDrawing(ctx, drawing);
    ctx.restore();
  };

  const moving = new Set<string>();
  const changes = playing?.event.changes ?? [];
  for (const c of changes) moving.add(c.change === "travel" ? `${c.from.x},${c.from.y}` : `${c.at.x},${c.at.y}`);
  board.forEach((row, y) => row.forEach((p, x) => p && !moving.has(`${x},${y}`) && piece(p.kind ?? 1, x, y)));
  if (playing) {
    const { t: at } = playing;
    for (const c of changes) {
      if (c.change === "leave") {
        const p = board[c.at.y]![c.at.x];
        if (p) piece(p.kind ?? 1, c.at.x, c.at.y, 1 - at, 1 - at);
      } else if (c.change === "travel") {
        const p = board[c.from.y]![c.from.x];
        if (p) piece(p.kind ?? 1, c.from.x + (c.to.x - c.from.x) * at, c.from.y + (c.to.y - c.from.y) * at);
      } else if (c.change === "arrive") {
        const off = c.from === "above" ? -1 : c.from === "below" ? 1 : 0;
        piece(c.piece.kind ?? 1, c.at.x, c.at.y + off * (1 - at), off === 0 ? at : 1, at);
      } else if ("piece" in c) piece(c.piece.kind ?? 1, c.at.x, c.at.y);
    }
  }

  const ring = (p: Cell, token: "amber" | "cream" | "dim", dash: readonly number[] = []): void => {
    ctx.save();
    ctx.strokeStyle = css(token);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([...dash]);
    ctx.beginPath();
    ctx.roundRect(p.x * CELL + 1.2, p.y * CELL + 1.2, CELL - 2.4, CELL - 2.4, 4);
    ctx.stroke();
    ctx.restore();
  };
  if (hinted) (ring(hinted.a, "dim", [3, 2]), ring(hinted.b, "dim", [3, 2]));
  ring(cursor, "cream");
  if (picked) ring(picked, "amber");
}

export function SwapRung() {
  const [seed, setSeed] = useState(() => Number(new URLSearchParams(window.location.search).get("seed")) || 1);
  const first = useMemo(() => start(SWAP, { seed }), [seed]);
  const [round, setRound] = useState<Round<SwapMove>>(first);
  const size = read(first).board;
  const [seen, setSeen] = useState<Seen>(() => seenEmpty(size[0]!.length, size.length));
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [cursor, setCursor] = useState<Cell>({ x: 0, y: 0 });
  const [picked, setPicked] = useState<Cell | null>(null);
  const [hinted, setHinted] = useState<SwapMove | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Cell | null>(null);

  // A new round: an empty board, and the deal played in as its one event.
  useEffect(() => {
    setRound(first);
    setSeen(seenEmpty(size[0]!.length, size.length));
    setPlaying({ from: seenEmpty(size[0]!.length, size.length), queue: first.last.events, since: performance.now() });
    setPicked(null);
    setHinted(null);
    setReason(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  // Play the queue, an event at a time. The board takes no move until it has played out.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!playing || playing.queue.length === 0) {
      paint(el, seen, null, cursor, picked, hinted);
      return;
    }
    const event = playing.queue[0]!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const tick = (now: number): void => {
      const at = still ? 1 : Math.min(1, (now - playing.since) / msOf(event));
      paint(el, playing.from, { event, t: at }, cursor, picked, null);
      if (at < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const next = seenAfter(playing.from, event);
      setSeen(next);
      setPlaying(playing.queue.length > 1 ? { from: next, queue: playing.queue.slice(1), since: performance.now() } : null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, seen, cursor, picked, hinted]);

  const busy = playing !== null;
  const now = read(round);

  const make = useCallback(
    (a: Cell, b: Cell): void => {
      if (busy) return;
      const next = play(round, { move: "swap", a, b });
      setPicked(null);
      setHinted(null);
      setReason(next.last.refused);
      if (next.last.refused) return;
      setRound(next);
      setPlaying({ from: seen, queue: next.last.events, since: performance.now() });
    },
    [busy, round, seen],
  );

  const cellAt = (e: PointerEvent<HTMLCanvasElement>): Cell => {
    const box = e.currentTarget.getBoundingClientRect();
    const clamp = (n: number, most: number): number => Math.max(0, Math.min(most - 1, n));
    return { x: clamp(Math.floor(((e.clientX - box.left) / box.width) * size[0]!.length), size[0]!.length), y: clamp(Math.floor(((e.clientY - box.top) / box.height) * size.length), size.length) };
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>): void => {
    const at = cellAt(e);
    setCursor(at);
    drag.current = at;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onUp = (e: PointerEvent<HTMLCanvasElement>): void => {
    const from = drag.current;
    drag.current = null;
    if (!from) return;
    const to = cellAt(e);
    // A drag swaps the piece it began on with the one it ended on. A tap picks one, and a second tap swaps.
    if (!same(from, to)) return make(from, to);
    if (picked && !same(picked, to)) return make(picked, to);
    setPicked(same(picked, to) ? null : to);
  };
  const onKey = (e: KeyboardEvent<HTMLCanvasElement>): void => {
    const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, readonly [number, number]>)[e.key];
    if (step) {
      e.preventDefault();
      const to = { x: cursor.x + step[0], y: cursor.y + step[1] };
      if (to.x < 0 || to.y < 0 || to.x >= size[0]!.length || to.y >= size.length) return;
      // With a piece picked, an arrow swaps it that way. Otherwise it moves the cursor.
      if (picked) return make(picked, to);
      setCursor(to);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setPicked(same(picked, cursor) ? null : cursor);
    } else if (e.key === "Escape") setPicked(null);
  };

  return (
    <main className="page rung" data-testid="rung-swap">
      <p className="muted">
        <Link to="/">{t("rungs.back")}</Link>
      </p>
      <h1>{t("rungs.swap.name")}</h1>
      <p className="muted">{t("rungs.swap.how_to")}</p>
      <div className="rung-hud" data-testid="rung-board" data-board={kindsOf(now.board)} data-score={now.score} data-ended={now.ended ?? ""} data-busy={busy ? "1" : "0"}>
        <span>{t("rungs.score", { score: now.score })}</span>
        <span>{t("rungs.moves_left", { count: now.movesLeft ?? 0 })}</span>
      </div>
      <canvas
        ref={canvas}
        className="rung-canvas"
        data-testid="rung-canvas"
        data-view={kindsOf(seen)}
        width={size[0]!.length * CELL * 3}
        height={size.length * CELL * 3}
        style={{ aspectRatio: `${size[0]!.length} / ${size.length}` }}
        tabIndex={0}
        role="application"
        aria-label={t("rungs.board_label")}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onKeyDown={onKey}
      />
      <p className="rung-says" role="status" data-testid="rung-says">
        {now.ended ? t("rungs.ended", { score: now.score }) : reason ? t(`rungs.${reason}`) : " "}
      </p>
      <div className="rung-actions">
        <button type="button" data-testid="rung-new" onClick={() => setSeed(seed + 1)}>
          {t("rungs.new_round")}
        </button>
        <button type="button" data-testid="rung-hint" disabled={busy || now.ended !== null} onClick={() => setHinted(hint(round))}>
          {t("rungs.hint")}
        </button>
      </div>
      <details data-testid="rung-explain">
        <summary>{t("rungs.explain")}</summary>
        <pre>{explain(SWAP)}</pre>
      </details>
      <details data-testid="rung-expand">
        <summary>{t("rungs.expand")}</summary>
        <pre>{expand(SWAP)}</pre>
      </details>
    </main>
  );
}
