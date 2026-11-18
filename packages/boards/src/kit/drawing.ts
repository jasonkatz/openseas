import type { Drawing, Layer } from "@openseas/protocol";

/**
 * The one painter of a piece drawn from data (ADR 0065, docs/BRAND.md section 3). A drawing is a
 * list of layers on the 24 unit square, painted in order in the fill and stroke colour already
 * set: a layer marked `cut` takes its shape out of what is drawn so far, so the ground shows
 * through. Every board's pieces and the studio's sprite editor paint through here, so what the
 * editor shows is what the board draws.
 */

const RAD = Math.PI / 180;

function trace(ctx: CanvasRenderingContext2D, layer: Layer): void {
  ctx.beginPath();
  switch (layer.kind) {
    case "rect":
      ctx.roundRect(layer.x, layer.y, layer.w, layer.h, Math.min(layer.r, layer.w / 2, layer.h / 2));
      ctx.fill();
      return;
    case "disc":
      ctx.arc(layer.x, layer.y, layer.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "poly": {
      const p = layer.points;
      for (let i = 0; i + 1 < p.length; i += 2) {
        if (i === 0) ctx.moveTo(p[i]!, p[i + 1]!);
        else ctx.lineTo(p[i]!, p[i + 1]!);
      }
      ctx.closePath();
      ctx.fill();
      // Its corners are rounded by a stroke of its own colour: it grows by half of `round`.
      if (layer.round > 0) {
        ctx.lineJoin = "round";
        ctx.lineWidth = layer.round;
        ctx.stroke();
      }
      return;
    }
    case "bar":
      ctx.moveTo(layer.x0, layer.y0);
      ctx.lineTo(layer.x1, layer.y1);
      ctx.lineCap = "round";
      ctx.lineWidth = layer.width;
      ctx.stroke();
      return;
    case "arc":
      ctx.arc(layer.x, layer.y, layer.r, layer.from * RAD, layer.to * RAD, layer.to < layer.from);
      ctx.lineCap = layer.cap ? "round" : "butt";
      ctx.lineWidth = layer.width;
      ctx.stroke();
      return;
    case "path": {
      layer.steps.forEach((s, i) => {
        if ("r" in s) ctx.arc(s.x, s.y, s.r, s.from * RAD, s.to * RAD, s.ccw ?? false);
        else if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      if (layer.fill) {
        ctx.closePath();
        ctx.fill();
      }
      if (layer.width > 0) {
        ctx.lineJoin = "round";
        ctx.lineCap = layer.cap ? "round" : "butt";
        ctx.lineWidth = layer.width;
        ctx.stroke();
      }
      return;
    }
  }
}

/** Paints one layer, every copy of it, as `paintDrawing` does. */
export function paintLayer(ctx: CanvasRenderingContext2D, layer: Layer): void {
  const copies = layer.copies ?? 1;
  for (let k = 0; k < copies; k++) {
    const deg = (layer.turn ?? 0) + k * (layer.spread ?? 0);
    ctx.save();
    if (layer.cut) ctx.globalCompositeOperation = "destination-out";
    if (deg !== 0) {
      ctx.translate(12, 12);
      ctx.rotate(deg * RAD);
      ctx.translate(-12, -12);
    }
    trace(ctx, layer);
    ctx.restore();
  }
}

/** Paints a drawing on the 24 unit square at the context's origin, in the colour already set. */
export function paintDrawing(ctx: CanvasRenderingContext2D, drawing: Drawing): void {
  for (const layer of drawing.layers) paintLayer(ctx, layer);
}
