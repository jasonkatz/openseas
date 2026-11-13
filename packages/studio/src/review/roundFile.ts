import { isPuzzleId, type PuzzleId } from "@openseas/engine";
import { parseMoveFor } from "@openseas/protocol";

/**
 * A round as the harness copies it out and reads it back: enough to replay it anywhere the
 * engine runs. `hashes` are the engine's hash after each move, as the client sent them. The
 * server's `puzzle_round` row (`puzzle`, `seed`, `move_log`) is accepted too, so a round from the
 * database can be pasted in; its config is then taken from content, which is what the server used.
 */
export interface RoundFile {
  readonly kind: "openseas.round";
  readonly version: 1;
  readonly puzzle: PuzzleId;
  readonly seed: string;
  readonly config?: unknown;
  readonly roundSeconds?: number;
  readonly mode?: string;
  readonly sessionId?: string | null;
  readonly moves: readonly unknown[];
  readonly hashes?: readonly string[];
  readonly summary?: { readonly score: number; readonly moves: number; readonly bestCombo: number };
  readonly exportedAt?: string;
  readonly harnessCommit?: string;
}

export type ParsedRoundFile = { ok: true; round: RoundFile; notes: string[] } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads a round out of pasted text. Every move is checked against the puzzle's wire schema, as the
 * server checks them, so a stray field or a move from another puzzle is refused here, not deep in
 * a replay. Returns notes for anything filled in.
 */
export function parseRoundFile(text: string): ParsedRoundFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not_json" };
  }
  if (!isRecord(raw)) return { ok: false, error: "not_object" };
  const notes: string[] = [];
  const puzzle = raw.puzzle;
  if (!isPuzzleId(puzzle)) return { ok: false, error: "no_puzzle" };
  const seed = raw.seed;
  if (typeof seed !== "string" || seed.length === 0) return { ok: false, error: "no_seed" };
  const movesRaw = Array.isArray(raw.moves) ? raw.moves : Array.isArray(raw.moveLog) ? raw.moveLog : Array.isArray(raw.move_log) ? raw.move_log : null;
  if (!movesRaw) return { ok: false, error: "no_moves" };
  if (!Array.isArray(raw.moves)) notes.push("moves_from_row");
  const moves: unknown[] = [];
  for (let i = 0; i < movesRaw.length; i++) {
    const m = parseMoveFor(puzzle, movesRaw[i]);
    if (m === null) return { ok: false, error: `bad_move:${i}` };
    moves.push(m);
  }
  const config = isRecord(raw.config) ? raw.config : undefined;
  if (config === undefined) notes.push("config_from_content");
  const hashes = Array.isArray(raw.hashes) && raw.hashes.every((h) => typeof h === "string") ? (raw.hashes as string[]) : undefined;
  const roundSeconds = typeof raw.roundSeconds === "number" && raw.roundSeconds > 0 ? raw.roundSeconds : undefined;
  const summary = isRecord(raw.summary) && typeof raw.summary.score === "number" ? (raw.summary as RoundFile["summary"]) : undefined;
  return {
    ok: true,
    notes,
    round: {
      kind: "openseas.round",
      version: 1,
      puzzle,
      seed,
      ...(config !== undefined ? { config } : {}),
      ...(roundSeconds !== undefined ? { roundSeconds } : {}),
      ...(typeof raw.mode === "string" ? { mode: raw.mode } : {}),
      ...(typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {}),
      moves,
      ...(hashes ? { hashes } : {}),
      ...(summary ? { summary } : {}),
    },
  };
}

export const ROUND_FILE_STORAGE_KEY = "openseas.harness.review";

/** Hands a round file to a puzzle page through sessionStorage; the page opens it with `?review=1`. */
export function stashRoundFile(round: RoundFile): boolean {
  try {
    window.sessionStorage.setItem(ROUND_FILE_STORAGE_KEY, JSON.stringify(round));
    return true;
  } catch {
    return false;
  }
}

export function takeStashedRoundFile(puzzle: PuzzleId): RoundFile | null {
  try {
    const text = window.sessionStorage.getItem(ROUND_FILE_STORAGE_KEY);
    if (!text) return null;
    window.sessionStorage.removeItem(ROUND_FILE_STORAGE_KEY);
    const parsed = parseRoundFile(text);
    return parsed.ok && parsed.round.puzzle === puzzle ? parsed.round : null;
  } catch {
    return null;
  }
}
