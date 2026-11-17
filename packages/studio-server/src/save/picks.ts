import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Picks } from "@openseas/protocol";
import type { Logger } from "../log.js";
import { isMp3 } from "../takes/scan.js";
import type { Takes } from "../takes/takes.js";
import type { Repo } from "./repo.js";

/** A Save the service turns down or cannot finish, with the code the page shows and, where it is about one thing, what. */
export class SaveRefused extends Error {
  constructor(
    readonly code: "nothing" | "pick" | "takes" | "conflict",
    readonly detail: string | null = null,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** Where a puzzle's picked sound is committed (ADR 0041). */
export const soundPath = (puzzle: string, cue: string): string => `packages/boards/src/sounds/${puzzle}/${cue}.mp3`;

/** Every path placing these picks, or putting back those of the last Save, could write. */
export function pickPaths(puzzle: string, picks: Picks, saved: Picks): string[] {
  const cues = new Set([...Object.keys(picks.sounds), ...Object.keys(saved.sounds)]);
  return [...cues].map((c) => soundPath(puzzle, c));
}

/** One pick as Save placed it, for the pull request: the take by its number when the draft made it. */
export interface PlacedPick {
  /** Always a sound: a draft picks nothing else (ADR 0062). */
  kind: "sound";
  name: string;
  /** The take's hash, or `synth` for a cue's synthesized voice. */
  pick: string;
  /** The take's number among the draft's own, or null when another draft made it (or for `synth`). */
  take: number | null;
  file: string;
}

export interface Placement {
  placed: PlacedPick[];
  /** Every repository path Save wrote or put back for the picks: none of them is the chat's doing. */
  files: string[];
}

export interface PlacerOptions {
  repo: Repo;
  /** Null when the service keeps no takes: a Save that picks one cannot place it. */
  takes: Takes | null;
  log: Logger;
}

export interface Placer {
  /**
   * Place a draft's picks in its worktree (ADR 0053), after its numbers and before the commit:
   * each take's bytes copied to where the build reads them. `saved` is what the last Save placed:
   * a pick let go since is put back as the base branch has it. Every pick is checked before a
   * file is touched. Nothing is decoded. Throws SaveRefused. Only cues are picked: the sprite picks
   * a draft kept before ADR 0062 may still carry never reach here (`picksOf` reads none, ADR 0063).
   */
  place(o: { id: string; puzzle: string; worktree: string; picks: Picks; saved: Picks }): Promise<Placement>;
}

const NONE = (p: Picks): boolean => Object.keys(p.sounds).length === 0;

export function createPlacer(o: PlacerOptions): Placer {
  const { repo, takes, log } = o;

  /** A picked take, checked against what it is picked for, with its bytes. */
  async function fetchTake(id: string, puzzle: string, name: string, hash: string): Promise<{ bytes: Buffer; take: number | null }> {
    if (!takes) throw new SaveRefused("takes");
    const info = await takes.info(hash);
    if (!info || info.kind !== "sound" || info.puzzle !== puzzle || info.name !== name) throw new SaveRefused("pick", name);
    let read: Awaited<ReturnType<Takes["read"]>>;
    try {
      read = await takes.read(hash);
    } catch (err) {
      log.error({ err, draft: id, hash }, "could not read a picked take");
      throw new SaveRefused("takes");
    }
    if (!read) throw new SaveRefused("takes");
    if (!isMp3(read.bytes)) throw new SaveRefused("pick", name);
    return { bytes: read.bytes, take: info.draft === id ? info.take : null };
  }

  return {
    async place({ id, puzzle, worktree, picks, saved }) {
      if (NONE(picks) && NONE(saved)) return { placed: [], files: [] };

      // Everything is checked first: a refused pick leaves the worktree as it was.
      const chosen: Array<{ kind: "sound"; name: string; pick: string; bytes: Buffer | null; take: number | null; file: string }> = [];
      for (const [name, pick] of Object.entries(picks.sounds)) {
        if (pick === "synth") chosen.push({ kind: "sound", name, pick, bytes: null, take: null, file: soundPath(puzzle, name) });
        else chosen.push({ kind: "sound", name, pick, file: soundPath(puzzle, name), ...(await fetchTake(id, puzzle, name, pick)) });
      }

      const files = new Set<string>();
      try {
        // A pick let go since the last Save goes back to what the base branch has there, or away.
        const letGo = Object.keys(saved.sounds)
          .filter((c) => picks.sounds[c] === undefined)
          .map((c) => soundPath(puzzle, c));
        for (const path of letGo) {
          await repo.fromBase(id, path);
          files.add(path);
        }
        // Each take is committed as its bytes, as `sounds.py place` would have mastered it (ADR 0051).
        // A `synth` pick deletes the sample.
        for (const c of chosen) {
          if (c.bytes) {
            await mkdir(dirname(join(worktree, c.file)), { recursive: true });
            await writeFile(join(worktree, c.file), c.bytes);
          } else await rm(join(worktree, c.file), { force: true });
          files.add(c.file);
        }
      } catch (err) {
        log.error({ err, draft: id }, "could not place a draft's picks");
        throw new SaveRefused("takes");
      }
      return { placed: chosen.map(({ kind, name, pick, take, file }) => ({ kind, name, pick, take, file })), files: [...files] };
    },
  };
}
