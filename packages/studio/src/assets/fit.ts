/** A frame's size in an atlas, and the square its art is fitted in (`boards/src/sprites/README.md`). */
const FRAME = 192;
const ART = 176;
/** Below this a pixel is treated as empty when the art is trimmed, as the packers and `sprites.py place` treat it. */
const ALPHA = 32;

/**
 * A picture as the atlas would hold it: trimmed to its art, fitted in the middle of a square
 * frame. It is what `sprites.py place` does to a take (ADR 0040), done here so that a file tried
 * on the board sits at the size its placed frame would. Null when the picture cannot be read or
 * is empty. The caller owns the object URL it gets back.
 */
export async function fitFrame(file: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const src = document.createElement("canvas");
  src.width = bitmap.width;
  src.height = bitmap.height;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = sctx.getImageData(0, 0, src.width, src.height);
  let x0 = src.width;
  let y0 = src.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (data[(y * src.width + x) * 4 + 3]! <= ALPHA) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const scale = ART / Math.max(w, h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const out = document.createElement("canvas");
  out.width = out.height = FRAME;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(src, x0, y0, w, h, Math.floor((FRAME - dw) / 2), Math.floor((FRAME - dh) / 2), dw, dh);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  return blob ? URL.createObjectURL(blob) : null;
}
