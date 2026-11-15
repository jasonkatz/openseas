import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Picks, TakeKind } from "@openseas/protocol";
import type { AgentIdentity } from "../chat/sdkRunner.js";
import type { Logger } from "../log.js";
import { isFrame, isMp3 } from "../takes/scan.js";
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

/** Where a puzzle's picked art and sound are committed (ADR 0040, ADR 0041). */
export const atlasPath = (puzzle: string): string => `packages/boards/src/sprites/${puzzle}.webp`;
export const framesPath = "packages/boards/src/sprites/frames.json";
const OVERRIDES = "packages/boards/src/sprites/overrides/";
export const overridePath = (puzzle: string, frame: string): string => `${OVERRIDES}${puzzle}-${frame}.webp`;
export const soundPath = (puzzle: string, cue: string): string => `packages/boards/src/sounds/${puzzle}/${cue}.mp3`;

/** Every path placing these picks, or putting back those of the last Save, could write. */
export function pickPaths(puzzle: string, picks: Picks, saved: Picks): string[] {
  const frames = new Set([...Object.keys(picks.sprites), ...Object.keys(saved.sprites)]);
  const cues = new Set([...Object.keys(picks.sounds), ...Object.keys(saved.sounds)]);
  return [...(frames.size ? [atlasPath(puzzle)] : []), ...[...frames].map((f) => overridePath(puzzle, f)), ...[...cues].map((c) => soundPath(puzzle, c))];
}

/** The service's own copy of the sprite script, from the image it runs in: never the worktree's, which the agent can edit. */
export const SPRITE_SCRIPT = fileURLToPath(new URL("../../../boards/scripts/sprites.py", import.meta.url));

/** One pick as Save placed it, for the pull request: the take by its number when the draft made it. */
export interface PlacedPick {
  kind: TakeKind;
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
  /** The agent's unix user (ADR 0047): Pillow decodes the takes as it, never as the service. Null off production. */
  identity: AgentIdentity | null;
  /** In production a frame is never decoded without the agent's user to decode it as. */
  production?: boolean;
  log: Logger;
  /** The sprite script to run; the service's own by default. */
  script?: string;
  /** How long the script may take. */
  timeoutMs?: number;
}

export interface Placer {
  /**
   * Place a draft's picks in its worktree (ADR 0053), after its numbers and before the commit.
   * `saved` is what the last Save placed: a pick let go since is put back as the base branch has
   * it. Every pick is checked before a file is touched. Throws SaveRefused.
   */
  place(o: { id: string; puzzle: string; worktree: string; picks: Picks; saved: Picks }): Promise<Placement>;
}

const NONE = (p: Picks): boolean => Object.keys(p.sprites).length === 0 && Object.keys(p.sounds).length === 0;

export function createPlacer(o: PlacerOptions): Placer {
  const { repo, takes, identity, log } = o;
  const script = o.script ?? SPRITE_SCRIPT;

  /** A picked take, checked against what it is picked for, with its bytes. */
  async function fetchTake(id: string, puzzle: string, kind: TakeKind, name: string, hash: string): Promise<{ bytes: Buffer; take: number | null }> {
    if (!takes) throw new SaveRefused("takes");
    const info = await takes.info(hash);
    if (!info || info.kind !== kind || info.puzzle !== puzzle || info.name !== name) throw new SaveRefused("pick", name);
    let read: Awaited<ReturnType<Takes["read"]>>;
    try {
      read = await takes.read(hash);
    } catch (err) {
      log.error({ err, draft: id, hash }, "could not read a picked take");
      throw new SaveRefused("takes");
    }
    if (!read) throw new SaveRefused("takes");
    if (!(kind === "sprite" ? isFrame(read.bytes) : isMp3(read.bytes))) throw new SaveRefused("pick", name);
    return { bytes: read.bytes, take: info.draft === id ? info.take : null };
  }

  /** The sprite script's `put`, as the agent's user, on files the service wrote and that user may only read. */
  function runPut(worktree: string, puzzle: string, frames: Array<[string, string]>, home: string): Promise<void> {
    const args = ["-I", script, "--root", worktree, "put", puzzle, ...frames.map(([name, file]) => `${name}=${file}`)];
    return new Promise((resolve, reject) => {
      const child = spawn("python3", args, {
        cwd: worktree,
        env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: home, LANG: "C.UTF-8" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: o.timeoutMs ?? 120_000,
        ...(identity ? { uid: identity.uid, gid: identity.gid } : {}),
      });
      let said = "";
      const hear = (b: Buffer): void => void (said = (said + b.toString()).slice(-2000));
      child.stdout.on("data", hear);
      child.stderr.on("data", hear);
      child.on("error", reject);
      child.on("close", (code, signal) => (code === 0 ? resolve() : reject(new Error(`sprites.py put ended ${signal ?? code}: ${said.trim().split("\n").pop() ?? ""}`))));
    });
  }

  return {
    async place({ id, puzzle, worktree, picks, saved }) {
      if (NONE(picks) && NONE(saved)) return { placed: [], files: [] };
      const placed: PlacedPick[] = [];
      const files = new Set<string>();

      // Everything is checked first: a refused pick leaves the worktree as it was.
      const sprites: Array<{ name: string; hash: string; bytes: Buffer; take: number | null }> = [];
      const spriteWork = Object.keys(picks.sprites).length > 0 || Object.keys(saved.sprites).length > 0;
      if (spriteWork) {
        let named: Record<string, unknown> = {};
        try {
          const all = JSON.parse(await readFile(join(worktree, framesPath), "utf8")) as Record<string, unknown>;
          const entry = all[puzzle];
          if (entry && typeof entry === "object" && !Array.isArray(entry)) named = entry as Record<string, unknown>;
        } catch {
          named = {};
        }
        const hasAtlas = await repo.baseHas(id, atlasPath(puzzle));
        for (const [name, hash] of Object.entries(picks.sprites)) {
          // A frame the manifest does not name is a change to code: only a renderer that asks for it would draw it.
          if (!hasAtlas || !Object.hasOwn(named, name)) throw new SaveRefused("pick", name);
          sprites.push({ name, hash, ...(await fetchTake(id, puzzle, "sprite", name, hash)) });
        }
      }
      const sounds: Array<{ name: string; hash: string; bytes: Buffer | null; take: number | null }> = [];
      for (const [name, pick] of Object.entries(picks.sounds)) {
        if (pick === "synth") sounds.push({ name, hash: pick, bytes: null, take: null });
        else sounds.push({ name, hash: pick, ...(await fetchTake(id, puzzle, "sound", name, pick)) });
      }

      try {
        if (spriteWork) {
          // One encode from the base branch's atlas: what was placed earlier is pasted back from its override, then the picks.
          const reverted = new Set<string>();
          for (const frame of Object.keys(saved.sprites)) {
            if (picks.sprites[frame] !== undefined) continue;
            await repo.fromBase(id, overridePath(puzzle, frame));
            reverted.add(overridePath(puzzle, frame));
            files.add(overridePath(puzzle, frame));
          }
          // With no pick left and no other override the branch adds, the base's atlas is put back as it was, not encoded again.
          const prefix = `${OVERRIDES}${puzzle}-`;
          const others = (await repo.files(id)).filter((f) => f.startsWith(prefix) && f.endsWith(".webp") && !reverted.has(f));
          const hasAtlas = await repo.baseHas(id, atlasPath(puzzle));
          const paste = hasAtlas && (sprites.length > 0 || others.length > 0);
          if (paste && o.production && !identity) {
            log.error({ draft: id }, "picks are not placed: the service cannot run the sprite script as the agent's user");
            throw new SaveRefused("takes");
          }
          if (hasAtlas) {
            await repo.fromBase(id, atlasPath(puzzle));
            files.add(atlasPath(puzzle));
          }
          if (paste) {
            const dir = await mkdtemp(join(tmpdir(), "studio-picks-"));
            try {
              // The service's files, which the agent's user may read and not change.
              await chmod(dir, 0o755);
              const given: Array<[string, string]> = [];
              for (const s of sprites) {
                const file = join(dir, `${s.hash}.webp`);
                await writeFile(file, s.bytes, { mode: 0o644 });
                given.push([s.name, file]);
              }
              if (identity) await repo.own(id, identity.uid, identity.gid);
              await runPut(worktree, puzzle, given, dir);
            } finally {
              await rm(dir, { recursive: true, force: true });
            }
            for (const s of sprites) {
              files.add(overridePath(puzzle, s.name));
              placed.push({ kind: "sprite", name: s.name, pick: s.hash, take: s.take, file: overridePath(puzzle, s.name) });
            }
          }
        }

        for (const cue of Object.keys(saved.sounds)) {
          if (picks.sounds[cue] !== undefined) continue;
          await repo.fromBase(id, soundPath(puzzle, cue));
          files.add(soundPath(puzzle, cue));
        }
        for (const s of sounds) {
          const path = soundPath(puzzle, s.name);
          // A sound is placed as its take's bytes: the take was mastered as `sounds.py place` would master it (ADR 0051).
          if (s.bytes) {
            await mkdir(dirname(join(worktree, path)), { recursive: true });
            await writeFile(join(worktree, path), s.bytes);
          } else await rm(join(worktree, path), { force: true });
          files.add(path);
          placed.push({ kind: "sound", name: s.name, pick: s.hash, take: s.take, file: path });
        }
      } catch (err) {
        if (err instanceof SaveRefused) throw err;
        log.error({ err, draft: id }, "could not place a draft's picks");
        throw new SaveRefused("takes");
      }
      return { placed, files: [...files] };
    },
  };
}
