import { expect, test } from "@playwright/test";

/**
 * Every cue, measured (docs/BRAND.md section 8, ADR 0062 decision 5). Nobody can listen in a
 * smoke, so the numbers are held instead: each cue is rendered through an OfflineAudioContext in
 * the real browser, by the same code that plays it, with every argument its board may give it,
 * and its length, its peak and its two ends are checked. What the definitions promise as data is
 * held by test/sound.test.ts; this holds what comes out.
 */

/** The same numbers as `LIMITS` in boards/src/cues.ts: typed here so a change to either is a change to both. */
const LIMITS = { cue: 0.4, beat: 0.7, peak: 0.14, band: 3 };

interface Row {
  cue: string;
  args: unknown[];
  sets: string[];
  length: number;
  peak: number;
  first: number;
  tail: number;
  step: number;
}

test("every cue is short, level with the others, and starts and ends at nothing", async ({ page }, testInfo) => {
  // One browser's numbers are the numbers: the phone profile runs the same engine.
  test.skip(testInfo.project.name !== "desktop", "measured once");
  await page.goto("/");
  const rows = await page.evaluate(async () => {
    const measure = (window as unknown as { openseasMeasureCues(): Promise<Row[]> }).openseasMeasureCues;
    return (await measure()).map((r) => ({ ...r, args: [...r.args] }));
  });
  expect(rows.length).toBeGreaterThan(28);
  expect(new Set(rows.map((r) => r.cue)).size).toBe(28);
  // The game's own cues and every puzzle's copies are measured (ADR 0070).
  expect(new Set(rows.flatMap((r) => r.sets)).size).toBe(23);

  const db = (peak: number): number => 20 * Math.log10(peak / LIMITS.peak);
  const table = rows.map((r) => `${`${r.cue}(${r.args.join(", ")})`.padEnd(18)} ${String(Math.round(r.length * 1000)).padStart(4)}ms  peak ${r.peak.toFixed(3)}  ${db(r.peak) >= 0 ? "+" : ""}${db(r.peak).toFixed(1)}dB`);
  console.log(`\ncue                length  peak   from target\n${table.join("\n")}`);
  await testInfo.attach("cues.txt", { body: table.join("\n"), contentType: "text/plain" });

  for (const r of rows) {
    const name = `${r.cue}(${r.args.join(", ")})`;
    // Heard, and over in time: silence is -80 dBFS.
    expect(r.length, `${name} length`).toBeGreaterThan(0.03);
    expect(r.length, `${name} length`).toBeLessThanOrEqual(r.cue === "beat" ? LIMITS.beat : LIMITS.cue);
    // Nowhere near clipping, and within the band of the one target.
    expect(r.peak, `${name} peak`).toBeLessThan(0.5);
    expect(Math.abs(db(r.peak)), `${name} peak from target, dB`).toBeLessThanOrEqual(LIMITS.band);
    // No click: it starts at nothing, ends at nothing, and never jumps between two samples.
    expect(r.first, `${name} first sample`).toBeLessThan(1e-4);
    expect(r.tail, `${name} after its end`).toBeLessThanOrEqual(1e-4);
    expect(r.step, `${name} biggest step`).toBeLessThan(0.04);
  }
});
