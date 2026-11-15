/**
 * The Vite plugin that builds every puzzle's atlas from its frame files (ADR 0054). An app that
 * bundles `boards` adds it to its Vite config; `src/sprites/atlas.ts` imports what it provides:
 *
 *   import atlases from "virtual:openseas/atlases";
 *   // { cooling: { url, frames: { cog: [x, y, w, h], ... } }, ... }
 *
 * A build emits each atlas as an asset of its own, `<puzzle>-<hash>.webp`. The dev server packs
 * one when it is first asked for and again when one of its frames changes. Either way a packed atlas
 * is kept in Vite's cache folder by the hash of its frames, so it is encoded once per change.
 * Nothing is written into any app's source or public folder. Plain JavaScript, like `./pack.js`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SPRITES, check, framePath, layout, pack, sources } from "./pack.js";

const ID = "virtual:openseas/atlases";
const RESOLVED = `\0${ID}`;
/** Where the dev server serves a packed atlas, under the app's base. */
const ROUTE = "@openseas/atlases/";

/**
 * @param {{ dir?: string }} [options] `dir` is the sprites folder to pack from; tests point it elsewhere.
 * @returns {import("vite").Plugin}
 */
export function atlases(options = {}) {
  const dir = options.dir ?? SPRITES;
  /** @type {import("vite").ResolvedConfig} */
  let config;
  /** Packed atlases by the hash of their frames, for this process. @type {Map<string, Promise<Buffer>>} */
  const packed = new Map();
  /** What the dev server serves at each address it has handed out. @type {Map<string, { puzzle: string; names: string[] }>} */
  const served = new Map();

  /**
   * A puzzle's atlas, from memory, Vite's cache folder, or packed now.
   *
   * @param {string} puzzle
   * @param {string[]} names
   * @returns {{ hash: string; bytes: Promise<Buffer> }}
   */
  function atlas(puzzle, names) {
    const { files, hash } = sources(puzzle, names, dir);
    let bytes = packed.get(hash);
    if (!bytes) {
      const cached = join(config.cacheDir, "openseas-atlases", `${hash}.webp`);
      bytes = existsSync(cached)
        ? Promise.resolve(readFileSync(cached))
        : pack(puzzle, names, files).then((out) => {
            mkdirSync(join(config.cacheDir, "openseas-atlases"), { recursive: true });
            writeFileSync(cached, out);
            return out;
          });
      // A failed pack is not kept: the next request tries again, after the frame is fixed.
      bytes.catch(() => packed.delete(hash));
      packed.set(hash, bytes);
    }
    return { hash, bytes };
  }

  return {
    name: "openseas-atlases",
    configResolved(resolved) {
      config = resolved;
    },
    resolveId(id) {
      return id === ID ? RESOLVED : undefined;
    },
    async load(id) {
      if (id !== RESOLVED) return undefined;
      const listed = check(dir);
      this.addWatchFile(join(dir, "frames.json"));
      /** @type {string[]} */
      const entries = [];
      // Every atlas is asked for at once, so a build packs them side by side.
      const all = Object.entries(listed).map(([puzzle, names]) => ({ puzzle, names, ...atlas(puzzle, names) }));
      for (const { puzzle, names, hash, bytes } of all) {
        for (const name of names) this.addWatchFile(framePath(puzzle, name, dir));
        /** @type {string} */
        let url;
        if (config.command === "build") {
          const ref = this.emitFile({ type: "asset", name: `${puzzle}.webp`, source: await bytes });
          url = `import.meta.ROLLUP_FILE_URL_${ref}`;
        } else {
          const path = `${ROUTE}${puzzle}-${hash.slice(0, 12)}.webp`;
          served.set(path, { puzzle, names });
          url = JSON.stringify(`${config.base}${path}`);
        }
        entries.push(`${JSON.stringify(puzzle)}: { url: ${url}, frames: ${JSON.stringify(layout(names).frames)} }`);
      }
      return `export default {\n  ${entries.join(",\n  ")}\n};\n`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0]?.slice(config.base.length);
        const asked = path ? served.get(path) : undefined;
        if (!asked) return next();
        atlas(asked.puzzle, asked.names).bytes.then(
          (bytes) => {
            res.setHeader("Content-Type", "image/webp");
            res.setHeader("Cache-Control", "no-cache");
            res.end(bytes);
          },
          (/** @type {unknown} */ err) => next(err),
        );
      });
    },
  };
}
