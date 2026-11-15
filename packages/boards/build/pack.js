/**
 * Packs a puzzle's frames into its atlas (ADR 0054). Each frame is a lossless 192px WebP of its own,
 * `src/sprites/frames/<puzzle>/<frame>.webp`, and `src/sprites/frames.json` lists a puzzle's frames
 * in order. The atlas is a build output, never committed: the frames are laid out in rows of four on
 * a 196px stride, each with a transparent gutter of 2px, and encoded once.
 *
 * Node only: the Vite plugin (`./atlases.js`) and the studio's test of the built atlas run it. Plain
 * JavaScript, so any Node 22 loads it from a Vite config without a TypeScript loader.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/** The sprites folder in `boards`: the manifest, and a folder of frames for each puzzle. */
export const SPRITES = fileURLToPath(new URL("../src/sprites/", import.meta.url));
export const SIZE = 192;
export const GUTTER = 2;
export const STRIDE = SIZE + 2 * GUTTER;
export const COLUMNS = 4;
/**
 * The atlas's one lossy encode (ADR 0040): quality 90, alpha kept exact. Effort 5, not 6: it packs an
 * atlas in about a fifth of a second instead of nine, for some 2% more bytes.
 */
export const ENCODE = Object.freeze({ quality: 90, alphaQuality: 100, effort: 5 });
/** Changes when the packing or the encoder changes, so a cached atlas is not served for another. */
const VERSION = `1/${COLUMNS}/${STRIDE}/${JSON.stringify(ENCODE)}/${sharp.versions.sharp}/${sharp.versions.webp ?? ""}`;

/** @typedef {[x: number, y: number, w: number, h: number]} Rect */


/** The frame names of each puzzle, in the order the studio lists them. */
/** @returns {Record<string, string[]>} */
export function manifest(dir = SPRITES) {
  return JSON.parse(readFileSync(join(dir, "frames.json"), "utf8"));
}

/** @type {(puzzle: string, name: string, dir?: string) => string} */
export const framePath = (puzzle, name, dir = SPRITES) => join(dir, "frames", puzzle, `${name}.webp`);

/**
 * The manifest and the frames folder agree: every puzzle listed has a folder, every frame listed has
 * a file, and every file is listed. Throws, naming each disagreement, so a build never ships an atlas
 * missing a frame or a frame no manifest names.
 *
 * @returns {Record<string, string[]>}
 */
export function check(dir = SPRITES) {
  const listed = manifest(dir);
  /** @type {string[]} */
  const problems = [];
  const root = join(dir, "frames");
  for (const folder of existsSync(root) ? readdirSync(root) : []) if (!Object.hasOwn(listed, folder)) problems.push(`frames/${folder} is not a puzzle in frames.json`);
  for (const [puzzle, names] of Object.entries(listed)) {
    if (!/^[a-z]+$/.test(puzzle)) problems.push(`${puzzle}: a puzzle id is lowercase letters`);
    /** @type {Set<string>} */
    const seen = new Set();
    for (const name of names) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) problems.push(`${puzzle}/${name}: a frame name is lowercase words joined by dashes`);
      if (seen.has(name)) problems.push(`${puzzle}/${name} is listed twice`);
      seen.add(name);
      if (!existsSync(framePath(puzzle, name, dir))) problems.push(`${puzzle}/${name} is listed but frames/${puzzle}/${name}.webp is missing`);
    }
    const folder = join(root, puzzle);
    for (const file of existsSync(folder) ? readdirSync(folder) : []) {
      const name = file.replace(/\.webp$/, "");
      if (name === file || !seen.has(name)) problems.push(`frames/${puzzle}/${file} is not listed in frames.json`);
    }
  }
  if (problems.length) throw new Error(`The sprite frames do not match frames.json:\n  ${problems.join("\n  ")}`);
  return listed;
}

/**
 * Where each frame sits in its puzzle's atlas: rows of four, in the manifest's order.
 *
 * @param {readonly string[]} names
 * @returns {{ width: number; height: number; frames: Record<string, Rect> }}
 */
export function layout(names) {
  const columns = Math.min(COLUMNS, Math.max(1, names.length));
  /** @type {Record<string, Rect>} */
  const frames = {};
  names.forEach((name, i) => {
    frames[name] = [(i % columns) * STRIDE + GUTTER, Math.floor(i / columns) * STRIDE + GUTTER, SIZE, SIZE];
  });
  return { width: columns * STRIDE, height: Math.max(1, Math.ceil(names.length / columns)) * STRIDE, frames };
}

/**
 * A puzzle's frames as read from disk, with a hash of everything its atlas is made from.
 *
 * @param {string} puzzle
 * @param {readonly string[]} names
 * @returns {{ files: Buffer[]; hash: string }}
 */
export function sources(puzzle, names, dir = SPRITES) {
  const files = names.map((name) => readFileSync(framePath(puzzle, name, dir)));
  const hash = createHash("sha256").update(VERSION).update(JSON.stringify(names));
  for (const file of files) hash.update(createHash("sha256").update(file).digest());
  return { files, hash: hash.digest("hex") };
}

/**
 * A puzzle's atlas, encoded once. Throws when a frame is not a 192px image.
 *
 * @param {string} puzzle
 * @param {readonly string[]} names
 * @param {readonly Buffer[]} files
 * @returns {Promise<Buffer>}
 */
export async function pack(puzzle, names, files) {
  const { width, height, frames } = layout(names);
  const layers = await Promise.all(
    names.map(async (name, i) => {
      const input = /** @type {Buffer} */ (files[i]);
      const meta = await sharp(input).metadata();
      if (meta.width !== SIZE || meta.height !== SIZE) throw new Error(`${puzzle}/${name} is ${meta.width}x${meta.height}; a frame is ${SIZE}x${SIZE}`);
      const [left, top] = /** @type {Rect} */ (frames[name]);
      return { input: await sharp(input).ensureAlpha().png().toBuffer(), left, top };
    }),
  );
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .webp(ENCODE)
    .toBuffer();
}

/**
 * Raw RGBA pixels of an image, for comparing frames with the atlas they were packed into.
 *
 * @param {Buffer} input
 * @returns {Promise<{ data: Buffer; width: number; height: number }>}
 */
export async function pixels(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
