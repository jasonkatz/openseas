import { Sprite, Texture, type Container } from "pixi.js";

/**
 * How a canvas is drawn on the machine in front of us. A GPU gets the screen's own pixels, up to
 * two each way, and antialiasing. A software renderer (a headless browser, a machine without a
 * GPU) pays for every pixel on the CPU: at a phone's density a board is over a million of them, a
 * frame takes a fifth of a second, and a board's clock, which never runs more than a twentieth of
 * a second for one frame, falls behind the wall's. So there a board is drawn one pixel per pixel
 * without antialiasing. What a board shows and how it plays are the same either way.
 */

let software: boolean | null = null;

/**
 * Whether WebGL here is drawn on the CPU. Asked of a throwaway context, once, because antialiasing
 * is fixed when a context is created: whoever makes a renderer has to know before they make it.
 */
export function softwareRendered(): boolean {
  if (software !== null) return software;
  software = false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      software = /swiftshader|llvmpipe|softpipe|software/i.test(String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    software = false;
  }
  return software;
}

/** The antialiasing and resolution a board's PixiJS application starts with. */
export function boardSurface(): { antialias: boolean; resolution: number } {
  return softwareRendered() ? { antialias: false, resolution: 1 } : { antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1) };
}

/**
 * Destroy textures a board baked for a size it no longer has. A board bakes its pieces again after
 * a resize and hands the new textures to the sprites it is drawing, but a sprite it only sets when
 * the state changes (a preview, a ghost, a piece still leaving) may be holding an old one, and
 * PixiJS throws when it draws a sprite whose texture is gone. So any sprite under `root` still on
 * one of `old` is blanked first; the board sets it again the next time it draws that thing.
 */
export function retireTextures(root: Container, old: Iterable<Texture>): void {
  const gone = new Set(old);
  if (gone.size === 0) return;
  const walk = (node: Container): void => {
    if (node instanceof Sprite && gone.has(node.texture)) node.texture = Texture.EMPTY;
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  for (const texture of gone) texture.destroy(true);
}
