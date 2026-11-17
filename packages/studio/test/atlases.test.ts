import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GUTTER, SIZE, SPRITES, check, layout, manifest, pack, pixels, sources } from "@openseas/boards/pack";

/**
 * Each puzzle's atlas is built from one lossless file a frame (ADR 0054). The atlas the build ships
 * must hold every frame file at its rectangle, pixel for pixel within its one lossy encode, and
 * nothing in the gutters between them.
 */

/** Alpha survives exactly; colour, weighted by alpha, stays within one quality-90 encode. */
const MIN_PSNR = 30;

type Pixels = Awaited<ReturnType<typeof pixels>>;

/** How closely a frame's place in the atlas matches the frame: alpha's largest difference, and colour's PSNR, premultiplied. */
function compare(atlas: Pixels, frame: Pixels, x0: number, y0: number): { alpha: number; psnr: number } {
  let alpha = 0;
  let squared = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const a = ((y0 + y) * atlas.width + x0 + x) * 4;
      const f = (y * frame.width + x) * 4;
      alpha = Math.max(alpha, Math.abs(atlas.data[a + 3]! - frame.data[f + 3]!));
      for (let c = 0; c < 3; c++) {
        const d = (atlas.data[a + c]! * atlas.data[a + 3]! - frame.data[f + c]! * frame.data[f + 3]!) / 255;
        squared += d * d;
      }
    }
  }
  const mse = squared / (SIZE * SIZE * 3);
  return { alpha, psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse) };
}

describe("the atlases built from frame files (ADR 0054)", () => {
  const listed = check();

  for (const [puzzle, names] of Object.entries(listed)) {
    it(`${puzzle}: every frame is in the built atlas at its rectangle, and the gutters are clear`, async () => {
      const { files } = sources(puzzle, names);
      const atlas = await pixels(await pack(puzzle, names, files));
      const { width, height, frames } = layout(names);
      expect([atlas.width, atlas.height]).toEqual([width, height]);
      const inside = new Uint8Array(width * height);
      for (const [i, name] of names.entries()) {
        const [x, y, w, h] = frames[name]!;
        expect([w, h]).toEqual([SIZE, SIZE]);
        const frame = await pixels(files[i]!);
        expect([frame.width, frame.height], name).toEqual([SIZE, SIZE]);
        const { alpha, psnr } = compare(atlas, frame, x, y);
        expect(alpha, `${name}'s alpha`).toBe(0);
        expect(psnr, `${name}'s colour`).toBeGreaterThan(MIN_PSNR);
        for (let row = y; row < y + h; row++) inside.fill(1, row * width + x, row * width + x + w);
      }
      let stray = 0;
      for (let p = 0; p < width * height; p++) if (!inside[p] && atlas.data[p * 4 + 3]! > 0) stray++;
      expect(stray, "opaque pixels outside every frame").toBe(0);
    });
  }

  it("a frame in the wrong place fails the comparison", async () => {
    const names = listed.salvage!;
    const { files } = sources("salvage", names);
    const atlas = await pixels(await pack("salvage", names, files));
    const [x, y] = layout(names).frames[names[1]!]!;
    const wrong = compare(atlas, await pixels(files[0]!), x, y);
    expect(wrong.alpha > 0 || wrong.psnr <= MIN_PSNR).toBe(true);
  });

  it("lays frames on a 196px stride with a 2px gutter, four to a row", () => {
    const { width, height, frames } = layout(["a", "b", "c", "d", "e"]);
    expect([width, height]).toEqual([4 * (SIZE + 2 * GUTTER), 2 * (SIZE + 2 * GUTTER)]);
    expect(frames.a).toEqual([GUTTER, GUTTER, SIZE, SIZE]);
    expect(frames.e).toEqual([GUTTER, SIZE + 3 * GUTTER, SIZE, SIZE]);
  });

  describe("the frames folder and the manifest must agree", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlases-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const copy = (): string => {
      const at = mkdtempSync(join(dir, "s-"));
      cpSync(join(SPRITES, "frames.json"), join(at, "frames.json"));
      cpSync(join(SPRITES, "frames"), join(at, "frames"), { recursive: true });
      return at;
    };

    it("as they do in the repository", () => {
      expect(Object.keys(listed).length).toBe(2);
      expect(Object.values(listed).flat().length).toBe(16);
    });

    it("refuses a listed frame with no file", () => {
      const at = copy();
      rmSync(join(at, "frames", "salvage", "debris-gold.webp"));
      expect(() => check(at)).toThrow(/salvage\/debris-gold is listed but/);
    });

    it("refuses a file no manifest lists", () => {
      const at = copy();
      cpSync(join(at, "frames", "salvage", "debris-gold.webp"), join(at, "frames", "salvage", "debris-gold-2.webp"));
      expect(() => check(at)).toThrow(/frames\/salvage\/debris-gold-2.webp is not listed/);
    });

    it("refuses a frame that is not 192px when packing", async () => {
      const at = copy();
      const names = manifest(at).salvage!;
      // A transparent image of one pixel.
      const dot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      writeFileSync(join(at, "frames", "salvage", "debris-gold.webp"), Buffer.from(dot, "base64"));
      await expect(pack("salvage", names, sources("salvage", names, at).files)).rejects.toThrow(/salvage\/debris-gold is 1x1/);
    });
  });
});
