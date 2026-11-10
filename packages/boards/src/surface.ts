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
