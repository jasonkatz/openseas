import { defineConfig } from "@playwright/test";

/**
 * The capture run (ADR 0038): not a test suite. Each file in `capture/` plays a puzzle on the
 * harness and writes that guide's screenshots and clips into `public/media/<puzzle>/`. Run one
 * puzzle with `pnpm --filter @openseas/docs capture cooling`. It needs ffmpeg on the PATH.
 */
const port = Number(process.env.HARNESS_PORT ?? 4174);

export default defineConfig({
  testDir: "./capture",
  testMatch: /.*\.capture\.ts/,
  // One at a time: a clip is real time, and a busy machine drops its frames.
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    trace: "off",
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: `pnpm --filter @openseas/harness exec vite build && pnpm --filter @openseas/harness exec vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
