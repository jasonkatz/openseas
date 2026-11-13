/**
 * What a capture file is written with (ADR 0038). A capture opens a round on the studio's `/play`
 * page (the puzzle alone, ADR 0042), on a pinned seed, plays it with the pointer or the keyboard as a player would, and saves what the
 * board's canvas shows: `still` writes one frame, `clip` records while a callback plays.
 *
 * Everything lands in `public/media/<puzzle>/`: a still as `<name>.webp`, a clip as `<name>.mp4`
 * with its last frame as `<name>.webp` for the poster. A guide names its media by `<name>` alone.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const MEDIA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "media");
/** The widest a saved picture is, in pixels. Twice a phone column, so it stays sharp on one. */
const MAX_WIDTH = 840;

export interface LabOptions {
  /** The engine seed. Pin it: the same seed deals the same board every run. */
  seed: string;
  /** Round length in seconds; the content length when absent. */
  seconds?: number;
  /** Config overrides by path, as the studio's `c.<path>` links take them. The server's schema must accept the result, or the page deals nothing. */
  config?: Record<string, unknown>;
  /** Clock rate: 0.25, 0.5, 1, 2 or 4. */
  speed?: number;
  /** Start with the round's clock stopped; `stepClock` and `toggleClock` drive it from there. */
  paused?: boolean;
  /** Idle hints. Off unless a capture is about them. */
  hints?: boolean;
}

/** Open a puzzle's `/play` page on a round already started and wait for its board to be drawn. */
export async function openLab(page: Page, puzzle: string, opts: LabOptions): Promise<void> {
  const q = new URLSearchParams({ seed: opts.seed });
  if (opts.seconds) q.set("seconds", String(opts.seconds));
  for (const [path, value] of Object.entries(opts.config ?? {})) q.set(`c.${path}`, typeof value === "string" ? value : JSON.stringify(value));
  if (opts.speed && opts.speed !== 1) q.set("speed", String(opts.speed));
  if (opts.paused) q.set("paused", "1");
  if (!opts.hints) q.set("hints", "0");
  q.set("start", "1");
  // Sound off before the page's first script runs: a capture is silent.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("openseas.muted", "1");
    } catch {
      /* private mode */
    }
  });
  await page.goto(`/play/${puzzle}?${q.toString()}`);
  await expect(canvasOf(page, puzzle)).toBeVisible();
  await showPointer(page);
  // The start splash and the deal's own animation.
  await page.waitForTimeout(1800);
}

/**
 * The round's clock, as the studio hands it to a script (`window.openseasRoundClock`, studio's
 * bench/useBench): there is no control for it on screen. Called in the page, so the pointer stays
 * where the hand left it.
 */
interface RoundClock {
  pause(): void;
  resume(): void;
  step(ms?: number): void;
  readonly paused: boolean;
  readonly tick: number | null;
}
type ClockWindow = { openseasRoundClock?: RoundClock };
const NO_CLOCK = "no round clock: the round is not running";

/** Step a stopped clock: one tick of a ticked puzzle a step, a second for the others. */
export async function stepClock(page: Page, times = 1): Promise<void> {
  await page.evaluate(
    ([n, none]) => {
      const clock = (window as unknown as ClockWindow).openseasRoundClock;
      if (!clock) throw new Error(none);
      for (let i = 0; i < n; i++) clock.step();
    },
    [times, NO_CLOCK] as const,
  );
}

/** Let a stopped clock run, or stop a running one. */
export async function toggleClock(page: Page): Promise<void> {
  await page.evaluate((none) => {
    const clock = (window as unknown as ClockWindow).openseasRoundClock;
    if (!clock) throw new Error(none);
    if (clock.paused) clock.resume();
    else clock.pause();
  }, NO_CLOCK);
}

/** The tick a ticked puzzle's round is on. */
export async function clockTick(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as ClockWindow).openseasRoundClock?.tick ?? 0);
}

export const canvasOf = (page: Page, puzzle: string) => page.getByTestId(`${puzzle}-canvas`);

/** The board string the page publishes (`data-board`): the engine's state, as the puzzle's smoke reads it. */
export async function boardString(page: Page, puzzle: string): Promise<string> {
  return (await page.getByTestId(`${puzzle}-board`).getAttribute("data-board")) ?? "";
}

/** An attribute of the canvas (`data-view`, `data-geom`, `data-cursor` and whatever else a renderer publishes). */
export async function canvasAttr(page: Page, puzzle: string, name: string): Promise<string> {
  return (await canvasOf(page, puzzle).getAttribute(name)) ?? "";
}

/** Wait until the canvas draws exactly the engine's board: every animation has landed. Ticked boards may never settle; pass a short timeout and ignore the result. */
export async function settled(page: Page, puzzle: string, timeout = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const [want, shown] = await page.evaluate(
      (id) => [
        document.querySelector(`[data-testid="${id}-board"]`)?.getAttribute("data-board") ?? null,
        document.querySelector(`[data-testid="${id}-canvas"]`)?.getAttribute("data-view") ?? null,
      ],
      puzzle,
    );
    if (want && want === shown) return true;
    await page.waitForTimeout(80);
  }
  return false;
}

/** Where a kit board's grid sits on the page, from the `data-geom` its canvas publishes. Prototype boards only. */
export async function boardGeom(page: Page, puzzle: string): Promise<{ ox: number; oy: number; cell: number }> {
  const canvas = canvasOf(page, puzzle);
  await expect(canvas).toHaveAttribute("data-geom", /^-?\d+,-?\d+,[\d.]+$/);
  const [gx, gy, cell] = ((await canvas.getAttribute("data-geom")) ?? "").split(",").map(Number) as [number, number, number];
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  return { ox: box.x + gx, oy: box.y + gy, cell };
}

/** The canvas's box on the page. */
export async function canvasBox(page: Page, puzzle: string): Promise<Box> {
  const box = await canvasOf(page, puzzle).boundingBox();
  if (!box) throw new Error(`no ${puzzle} canvas`);
  return box;
}

/**
 * A dot that follows the mouse, drawn in the page so a picture shows where the player points and
 * when they press. Headless Chromium draws no cursor of its own.
 */
async function showPointer(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById("capture-pointer")) return;
    const dot = document.createElement("div");
    dot.id = "capture-pointer";
    dot.style.cssText =
      "position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;pointer-events:none;z-index:99999;" +
      "background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.95);box-shadow:0 0 0 1.5px rgba(7,14,26,.7),0 2px 8px rgba(0,0,0,.5);" +
      "transition:width .09s,height .09s,margin .09s,background .09s;display:none";
    document.body.appendChild(dot);
    const press = (down: boolean): void => {
      dot.style.width = dot.style.height = down ? "18px" : "26px";
      dot.style.margin = down ? "-9px 0 0 -9px" : "-13px 0 0 -13px";
      dot.style.background = down ? "rgba(255,214,102,.75)" : "rgba(255,255,255,.28)";
    };
    window.addEventListener("pointermove", (e) => {
      dot.style.display = "block";
      dot.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
    }, true);
    window.addEventListener("pointerdown", () => press(true), true);
    window.addEventListener("pointerup", () => press(false), true);
  });
}

/** Take the pointer dot off the picture (a keyboard capture, or a still of the board alone). */
export async function hidePointer(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await page.evaluate(() => {
    const dot = document.getElementById("capture-pointer");
    if (dot) dot.style.display = "none";
  });
}

function ffmpeg(args: string[]): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
}

function outPath(puzzle: string, name: string, ext: string): string {
  const dir = join(MEDIA, puzzle);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.${ext}`);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of the page a picture shows. A canvas is often wider than its board; a capture that
 * knows where the board sits passes that box (in page pixels) so the picture is the board alone.
 */
export interface RegionOptions {
  region?: Box;
}

/** Save the canvas as it is now: `public/media/<puzzle>/<name>.webp`. */
export async function still(page: Page, puzzle: string, name: string, opts: RegionOptions = {}): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), "openseas-still-"));
  try {
    const png = join(tmp, "still.png");
    await page.screenshot({ path: png, clip: opts.region ?? (await canvasBox(page, puzzle)) });
    ffmpeg(["-i", png, "-vf", `scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos`, "-c:v", "libwebp", "-quality", "84", outPath(puzzle, name, "webp")]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface ClipOptions extends RegionOptions {
  /** Keep recording this long after `play` returns, so the last move lands. Default 900 ms. */
  tailMs?: number;
  /** Hold the opening frame this long before `play` runs. Default 500 ms. */
  leadMs?: number;
}

/**
 * Record the canvas while `play` runs: `public/media/<puzzle>/<name>.mp4`, and its last frame as
 * `<name>.webp`. Keep a clip short (three to eight seconds) and about one idea.
 */
export async function clip(page: Page, puzzle: string, name: string, play: () => Promise<void>, opts: ClipOptions = {}): Promise<void> {
  const box = opts.region ?? (await canvasBox(page, puzzle));
  const tmp = mkdtempSync(join(tmpdir(), "openseas-clip-"));
  const frames: { file: string; at: number }[] = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", (frame) => {
    const file = join(tmp, `f${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(frame.data, "base64"));
    frames.push({ file, at: frame.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  try {
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
    await page.waitForTimeout(opts.leadMs ?? 500);
    await play();
    await page.waitForTimeout(opts.tailMs ?? 900);
    await cdp.send("Page.stopScreencast");
    await cdp.detach().catch(() => {});
    if (frames.length < 2) throw new Error(`clip ${puzzle}/${name}: only ${frames.length} frame(s); nothing moved on screen`);

    // The screencast sends a frame when the page changes, so each is held until the next one.
    const list = join(tmp, "frames.txt");
    const lines: string[] = [];
    frames.forEach((f, i) => {
      const next = frames[i + 1];
      const hold = next ? Math.min(2, Math.max(0.01, next.at - f.at)) : 0.6;
      lines.push(`file '${f.file}'`, `duration ${hold.toFixed(3)}`);
    });
    lines.push(`file '${frames[frames.length - 1]!.file}'`);
    writeFileSync(list, lines.join("\n"));

    // Frames are the whole viewport; cut the canvas out of them. The frame may not be at the
    // device scale, so the crop is in fractions of the frame.
    const vp = page.viewportSize()!;
    const fx = (n: number): string => (n / vp.width).toFixed(5);
    const fy = (n: number): string => (n / vp.height).toFixed(5);
    const crop = `crop=iw*${fx(box.width)}:ih*${fy(box.height)}:iw*${fx(box.x)}:ih*${fy(box.y)}`;
    const scale = `scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
    ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-vf", `${crop},${scale},fps=24,format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-movflags", "+faststart", "-an", outPath(puzzle, name, "mp4")]);
    ffmpeg(["-i", frames[frames.length - 1]!.file, "-vf", `${crop},${scale}`, "-c:v", "libwebp", "-quality", "84", outPath(puzzle, name, "webp")]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Move the mouse there in small steps, as a hand would, so a clip shows the travel. */
export async function glide(page: Page, x: number, y: number, ms = 260): Promise<void> {
  const steps = Math.max(2, Math.round(ms / 16));
  await page.mouse.move(x, y, { steps });
}

/** Glide to a point and click it. */
export async function tapAt(page: Page, x: number, y: number, holdMs = 90): Promise<void> {
  await glide(page, x, y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** Press, glide through the points, release. */
export async function dragThrough(page: Page, points: ReadonlyArray<readonly [number, number]>, stepMs = 200): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  await glide(page, first[0], first[1]);
  await page.mouse.down();
  await page.waitForTimeout(90);
  for (const [x, y] of rest) await glide(page, x, y, stepMs);
  await page.waitForTimeout(90);
  await page.mouse.up();
}

/**
 * The first seed `<prefix>-1`, `<prefix>-2`, ... whose value from `probe` is not null, with that
 * value. A capture plans with the engine itself: deal the seed in Node, look for the board that
 * shows the idea, then play that seed on the page. The search is deterministic, so every run finds
 * the same seed until the engine's rules change, and then it finds the next one that still shows it.
 */
export function findSeed<T>(prefix: string, probe: (seed: string) => T | null, max = 20_000): { seed: string; found: T } {
  for (let i = 1; i <= max; i++) {
    const seed = `${prefix}-${i}`;
    const found = probe(seed);
    if (found !== null) return { seed, found };
  }
  throw new Error(`no seed ${prefix}-1..${max} shows it`);
}

/** A box grown by `pad` pixels on every side, kept inside `within`. */
export function padded(box: Box, pad: number, within: Box): Box {
  const x = Math.max(within.x, box.x - pad);
  const y = Math.max(within.y, box.y - pad);
  return { x, y, width: Math.min(within.x + within.width, box.x + box.width + pad) - x, height: Math.min(within.y + within.height, box.y + box.height + pad) - y };
}
