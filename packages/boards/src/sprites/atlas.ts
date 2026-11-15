import { Texture, type Graphics } from "pixi.js";
import frames from "./frames.json";

export type SpritePuzzle = keyof typeof frames;

// Literal URLs let Vite fingerprint and serve these assets in either application, including
// previews and non-root base paths. Never reach across to another app's public directory.
const urls: Record<SpritePuzzle, string> = {
  cooling: new URL("./cooling.webp", import.meta.url).href,
  engines: new URL("./engines.webp", import.meta.url).href,
  plating: new URL("./plating.webp", import.meta.url).href,
  gunnery: new URL("./gunnery.webp", import.meta.url).href,
  navigation: new URL("./navigation.webp", import.meta.url).href,
  swordfight: new URL("./swordfight.webp", import.meta.url).href,
  battle: new URL("./battle.webp", import.meta.url).href,
  salvage: new URL("./salvage.webp", import.meta.url).href,
  overload: new URL("./overload.webp", import.meta.url).href,
  deflectors: new URL("./deflectors.webp", import.meta.url).href,
  reactor: new URL("./reactor.webp", import.meta.url).href,
  scanner: new URL("./scanner.webp", import.meta.url).href,
  tug: new URL("./tug.webp", import.meta.url).href,
  racks: new URL("./racks.webp", import.meta.url).href,
  cutting: new URL("./cutting.webp", import.meta.url).href,
};
/**
 * Frames placed over the atlas, each a lossless image of its own (ADR 0053): `overrides/<puzzle>-<frame>.webp`,
 * bundled by Vite and loaded with the puzzle's atlas. The atlas file is never re-encoded to place one.
 */
const placedFiles = import.meta.glob<string>("./overrides/*.webp", { query: "?url", import: "default", eager: true });
/** The bundled overrides by puzzle, then frame name. A puzzle id has no dash, so the first one ends it. */
const placedUrls = new Map<string, Map<string, string>>();
for (const [path, url] of Object.entries(placedFiles)) {
  const file = /^\.\/overrides\/([a-z]+)-(.+)\.webp$/.exec(path);
  if (!file) continue;
  const [, puzzle, name] = file as unknown as [string, string, string];
  if (!placedUrls.has(puzzle)) placedUrls.set(puzzle, new Map());
  placedUrls.get(puzzle)!.set(name, url);
}
/** The frames a build places over a puzzle's atlas, by name, with the URL each is served from. */
export const placedSprites = (puzzle: string): ReadonlyMap<string, string> => placedUrls.get(puzzle) ?? new Map();
/** The bundled overrides once decoded, by `<puzzle>/<frame>`. One that fails to load leaves the atlas's frame. */
const placed = new Map<string, HTMLImageElement>();

const images = new Map<SpritePuzzle, HTMLImageElement>();
const pending = new Map<SpritePuzzle, Promise<void>>();
const textures = new Map<string, Texture>();
const listeners = new Set<() => void>();
let revision = 0;
/** A frame drawn from an image of its own in place of its place in the atlas (ADR 0050), by `<puzzle>/<frame>`. */
const overrides = new Map<string, { image: HTMLImageElement; url: string }>();
let overrideRevision = 0;

/** One image, decoded, or null when it does not load in time. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    let finished = false;
    const finish = (ok: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      resolve(ok ? image : null);
    };
    const timeout = setTimeout(() => finish(false), 8000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

/** The frames a build places over a puzzle's atlas, decoded before the atlas counts as ready, so a board never draws the old frame first. */
async function loadPlaced(puzzle: SpritePuzzle): Promise<void> {
  await Promise.all(
    [...placedSprites(puzzle)].map(async ([name, url]) => {
      const image = await loadImage(url);
      if (image) placed.set(`${puzzle}/${name}`, image);
    }),
  );
}

/** One decode per atlas, and per frame placed over it, for the lifetime of the page. A failed atlas keeps the procedural art. */
export function loadPuzzleSprites(puzzle: SpritePuzzle): Promise<void> {
  let task = pending.get(puzzle);
  if (!task) {
    const over = loadPlaced(puzzle);
    task = new Promise<void>((resolve) => {
      const image = new Image();
      let finished = false;
      const finish = (ok: boolean): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        image.onload = image.onerror = null;
        void over.then(() => {
          if (ok) {
            images.set(puzzle, image);
            revision++;
            for (const notify of listeners) notify();
          }
          resolve();
        });
      };
      const timeout = setTimeout(() => finish(false), 8000);
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = urls[puzzle];
    });
    pending.set(puzzle, task);
  }
  return task;
}

export const spriteRevision = (): number => revision;
export const subscribeSprites = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const spritesReady = (puzzle: SpritePuzzle): boolean => images.has(puzzle);
/** Counts the frames swapped since the page opened: a board is made again when it moves, since each bakes its art once. */
export const spriteOverrideRevision = (): number => overrideRevision;
/** Every frame name in a puzzle's atlas, in the manifest's order, then any frame placed over it that the atlas lacks. */
export const spriteFrames = (puzzle: SpritePuzzle): string[] => [...new Set([...Object.keys(frames[puzzle]), ...placedSprites(puzzle).keys()])];
/** True while a frame is drawn from an image of its own. */
export const spriteOverridden = (puzzle: SpritePuzzle, name: string): boolean => overrides.has(`${puzzle}/${name}`);

/**
 * Draws a frame from an image of its own, a whole square frame as the atlas would hold it, or
 * with `null` as the build ships it again: the frame placed over the atlas where there is one,
 * else the atlas's (ADR 0050, ADR 0053). Presentation only: a board made after this draws
 * the new art, and whoever holds a board makes it again when `spriteOverrideRevision` moves.
 * False when the image does not load, and then nothing changes.
 */
export async function overrideSprite(puzzle: SpritePuzzle, name: string, url: string | null): Promise<boolean> {
  const key = `${puzzle}/${name}`;
  if (url === null) {
    if (!overrides.delete(key)) return true;
  } else {
    const image = new Image();
    // A take is read from another origin; without this its pixels could not be baked into a texture.
    image.crossOrigin = "anonymous";
    image.src = url;
    try {
      await image.decode();
    } catch {
      return false;
    }
    overrides.set(key, { image, url });
  }
  // The old texture is left to whichever board still draws it: shared textures are never destroyed here.
  textures.delete(key);
  revision++;
  overrideRevision++;
  for (const notify of listeners) notify();
  return true;
}
export const isSpritePuzzle = (id: string): id is SpritePuzzle => Object.hasOwn(urls, id);
/** True when the atlas is decoded and holds this frame: what a caller asks before it draws its fallback. */
export const hasSprite = (puzzle: SpritePuzzle, name: string): boolean => source(puzzle, name) !== undefined;

/** Where a frame sits in its atlas image, for a legend that crops it in CSS. Undefined until the atlas is decoded. */
export function spriteCrop(puzzle: SpritePuzzle, name: string): { url: string; x: number; y: number; size: number; width: number; height: number } | undefined {
  const own = overrides.get(`${puzzle}/${name}`);
  if (own) return { url: own.url, x: 0, y: 0, size: own.image.naturalWidth, width: own.image.naturalWidth, height: own.image.naturalHeight };
  const shipped = images.has(puzzle) ? placed.get(`${puzzle}/${name}`) : undefined;
  if (shipped) return { url: shipped.src, x: 0, y: 0, size: shipped.naturalWidth, width: shipped.naturalWidth, height: shipped.naturalHeight };
  const image = images.get(puzzle);
  const f = frame(puzzle, name);
  if (!image || !f) return undefined;
  return { url: urls[puzzle], x: f[0]!, y: f[1]!, size: f[2]!, width: image.naturalWidth, height: image.naturalHeight };
}

function frame(puzzle: SpritePuzzle, name: string): readonly number[] | undefined {
  return (frames[puzzle] as Record<string, number[]>)[name];
}

/** The pixels a frame is drawn from: the studio's swap, else the frame the build places over the atlas, else its place in the decoded atlas. */
function source(puzzle: SpritePuzzle, name: string): { image: HTMLImageElement; x: number; y: number; w: number; h: number } | undefined {
  const own = overrides.get(`${puzzle}/${name}`);
  if (own) return { image: own.image, x: 0, y: 0, w: own.image.naturalWidth, h: own.image.naturalHeight };
  // Placed frames count once the atlas is ready, so a board that asks before then draws its fallback, as it would without them.
  const shipped = images.has(puzzle) ? placed.get(`${puzzle}/${name}`) : undefined;
  if (shipped) return { image: shipped, x: 0, y: 0, w: shipped.naturalWidth, h: shipped.naturalHeight };
  const image = images.get(puzzle);
  const f = frame(puzzle, name);
  if (!image || !f) return undefined;
  return { image, x: f[0]!, y: f[1]!, w: f[2]!, h: f[3]! };
}

/** Draw within the caller's transform; dimensions are CSS pixels, not device pixels. */
export function drawSprite(ctx: CanvasRenderingContext2D, puzzle: SpritePuzzle, name: string, x: number, y: number, w: number, h: number): boolean {
  const s = source(puzzle, name);
  if (!s) return false;
  ctx.drawImage(s.image, s.x, s.y, s.w, s.h, x, y, w, h);
  return true;
}

/** Shared atlas textures are page-owned; renderers must never destroy them or their source. */
export function spriteTexture(puzzle: SpritePuzzle, name: string): Texture | undefined {
  const s = source(puzzle, name);
  if (!s) return undefined;
  const key = `${puzzle}/${name}`;
  let texture = textures.get(key);
  if (!texture) {
    // Graphics fills in Pixi v8 address the source image rather than a subtexture's frame.
    // Extract once so both a Sprite and a textured polygon sample exactly the named frame.
    const canvas = document.createElement("canvas");
    canvas.width = s.w;
    canvas.height = s.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(s.image, s.x, s.y, s.w, s.h, 0, 0, canvas.width, canvas.height);
    texture = Texture.from(canvas);
    textures.set(key, texture);
  }
  return texture;
}

/** Textured geometry for renderers that retain Graphics for exact puzzle shapes and hit areas. */
export function paintSprite(g: Graphics, puzzle: SpritePuzzle, name: string, x: number, y: number, w: number, h: number, alpha = 1, color = 0xffffff): boolean {
  const texture = spriteTexture(puzzle, name);
  if (!texture) return false;
  g.rect(x, y, w, h).fill({ texture, textureSpace: "local", alpha, color });
  return true;
}
