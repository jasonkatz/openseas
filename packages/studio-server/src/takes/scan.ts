import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { TakeKind } from "@openseas/protocol";

/** A take found in a worktree, in the form it would be committed in. */
export interface FoundTake {
  kind: TakeKind;
  /** The frame or the cue. */
  name: string;
  /** Its number among the worktree's takes of that name. */
  take: number;
  bytes: Buffer;
  /** What the generator was asked for, where the script kept it. */
  prompt: string | null;
}

/**
 * Where the generation scripts leave a take's committed form (`boards/scripts`), under the
 * worktree's `.art/`, which git ignores: a fitted frame, or a mastered sound.
 */
const KINDS: ReadonlyArray<{ kind: TakeKind; folder: string; file: RegExp; limit: number; looks(b: Buffer): boolean }> = [
  { kind: "sprite", folder: "sprites", file: /^frame-(\d{1,4})\.webp$/, limit: 512 * 1024, looks: isFrame },
  { kind: "sound", folder: "sounds", file: /^placed-(\d{1,4})\.mp3$/, limit: 2 * 1024 * 1024, looks: isMp3 },
];
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FRAME = 192;
/** More than a session's worth: a worktree with more than this is not read past it. */
const MOST = 400;

/** A WebP picture that says it is one frame's size. Its pixels are never decoded here. */
export function isFrame(b: Buffer): boolean {
  if (b.length < 30 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return false;
  const chunk = b.toString("latin1", 12, 16);
  let w: number;
  let h: number;
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return false;
    const bits = b.readUInt32LE(21);
    w = (bits & 0x3fff) + 1;
    h = ((bits >>> 14) & 0x3fff) + 1;
  } else if (chunk === "VP8X") {
    w = b.readUIntLE(24, 3) + 1;
    h = b.readUIntLE(27, 3) + 1;
  } else if (chunk === "VP8 ") {
    w = b.readUInt16LE(26) & 0x3fff;
    h = b.readUInt16LE(28) & 0x3fff;
  } else return false;
  return w === FRAME && h === FRAME;
}

/** An MP3 by its first bytes: a tag, or a frame's sync. */
export function isMp3(b: Buffer): boolean {
  return b.length > 4 && (b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0));
}

const isDir = (path: string): boolean => {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * A file's bytes, read as the agent's own files must be: they are another user's, written by
 * commands the service did not choose, and the service may be root. So a link is never followed,
 * only a plain file under the limit is read, and where the machine can say where an open file
 * really is, it must be under `inside`.
 */
function readPlain(path: string, limit: number, inside: string): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit || stat.size === 0) return null;
    try {
      const real = realpathSync(`/proc/self/fd/${fd}`);
      if (!real.startsWith(inside + sep)) return null;
    } catch {
      /* no /proc: the checks on each folder above stand alone */
    }
    const out = Buffer.alloc(stat.size);
    let read = 0;
    while (read < out.length) {
      const n = readSync(fd, out, read, out.length - read, read);
      if (n === 0) return null;
      read += n;
    }
    return out;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The request the script kept beside a take, as the words the generator was given. */
function promptOf(path: string, inside: string): string | null {
  const raw = readPlain(path, 32 * 1024, inside);
  if (!raw) return null;
  try {
    const request = JSON.parse(raw.toString("utf8")) as { prompt?: unknown; text?: unknown };
    const words = typeof request.prompt === "string" ? request.prompt : typeof request.text === "string" ? request.text : null;
    return words === null ? null : words.slice(0, 4000);
  } catch {
    return null;
  }
}

/**
 * Every take of a puzzle that the generation scripts have left in a worktree. Anything that is
 * not what a script writes is passed over without a word: a link, a folder where a file should
 * be, a file too large, a picture of another size.
 */
export function scanTakes(worktree: string, puzzle: string): FoundTake[] {
  const found: FoundTake[] = [];
  let root: string;
  try {
    root = realpathSync(worktree);
  } catch {
    return found;
  }
  const art = join(root, ".art");
  if (!NAME.test(puzzle) || !isDir(art)) return found;
  for (const k of KINDS) {
    const base = join(art, k.folder, puzzle);
    if (!isDir(join(art, k.folder)) || !isDir(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const folder = join(base, name);
      if (!NAME.test(name) || !isDir(folder)) continue;
      for (const file of readdirSync(folder).sort()) {
        const m = k.file.exec(file);
        if (!m) continue;
        if (found.length >= MOST) return found;
        const bytes = readPlain(join(folder, file), k.limit, art);
        if (!bytes || !k.looks(bytes)) continue;
        found.push({ kind: k.kind, name, take: Number(m[1]), bytes, prompt: promptOf(join(folder, `take-${m[1]}.json`), art) });
      }
    }
  }
  return found;
}
