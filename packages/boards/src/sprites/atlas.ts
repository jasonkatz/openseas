import { Texture, type Graphics } from "pixi.js";
import frames from "./frames.json";

export type SpritePuzzle = keyof typeof frames;

// Literal URLs let Vite fingerprint and serve these assets in either application, including
// previews and non-root base paths. Never reach across to another app's public directory.
const urls: Record<SpritePuzzle, string> = {
  bilging: new URL("./bilging.webp", import.meta.url).href,
  sailing: new URL("./sailing.webp", import.meta.url).href,
  carpentry: new URL("./carpentry.webp", import.meta.url).href,
  gunnery: new URL("./gunnery.webp", import.meta.url).href,
  navigation: new URL("./navigation.webp", import.meta.url).href,
  swordfight: new URL("./swordfight.webp", import.meta.url).href,
  battle: new URL("./battle.webp", import.meta.url).href,
};
const images = new Map<SpritePuzzle, HTMLImageElement>();
const pending = new Map<SpritePuzzle, Promise<void>>();
const textures = new Map<string, Texture>();
const listeners = new Set<() => void>();
let revision = 0;

/** One decode per atlas for the lifetime of the page. A failed image keeps the procedural art. */
export function loadPuzzleSprites(puzzle: SpritePuzzle): Promise<void> {
  let task = pending.get(puzzle);
  if (!task) {
    task = new Promise<void>((resolve) => {
      const image = new Image();
      let finished = false;
      const finish = (ok: boolean): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        image.onload = image.onerror = null;
        if (ok) {
          images.set(puzzle, image);
          revision++;
          for (const notify of listeners) notify();
        }
        resolve();
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

function frame(puzzle: SpritePuzzle, name: string): readonly number[] | undefined {
  return (frames[puzzle] as Record<string, number[]>)[name];
}

/** Draw within the caller's transform; dimensions are CSS pixels, not device pixels. */
export function drawSprite(ctx: CanvasRenderingContext2D, puzzle: SpritePuzzle, name: string, x: number, y: number, w: number, h: number): boolean {
  const image = images.get(puzzle);
  const f = frame(puzzle, name);
  if (!image || !f) return false;
  ctx.drawImage(image, f[0]!, f[1]!, f[2]!, f[3]!, x, y, w, h);
  return true;
}

/** Shared atlas textures are page-owned; renderers must never destroy them or their source. */
export function spriteTexture(puzzle: SpritePuzzle, name: string): Texture | undefined {
  const image = images.get(puzzle);
  const f = frame(puzzle, name);
  if (!image || !f) return undefined;
  const key = `${puzzle}/${name}`;
  let texture = textures.get(key);
  if (!texture) {
    // Graphics fills in Pixi v8 address the source image rather than a subtexture's frame.
    // Extract once so both a Sprite and a textured polygon sample exactly the named frame.
    const canvas = document.createElement("canvas");
    canvas.width = f[2]!;
    canvas.height = f[3]!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(image, f[0]!, f[1]!, f[2]!, f[3]!, 0, 0, canvas.width, canvas.height);
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
