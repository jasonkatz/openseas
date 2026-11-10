import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "./e2e",
  // CI runners draw the phone profile several times slower than a laptop; give them room.
  timeout: process.env.CI ? 60_000 : 30_000,
  retries: process.env.CI ? 1 : 0,
  // In CI an HTML report is written too, so a failure's trace reaches the uploaded artifact.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    // A failure keeps its trace: the film strip, the action log, the console and the network. It
    // leaves out the DOM snapshot Playwright would take around every action. The world moves its
    // labels every frame, and snapshotting that page made the long desktop test half as slow again
    // on a two-core runner, which is what pushed it over its timeout on main. The page's state at
    // the failure is still written beside the trace (error-context.md).
    trace: { mode: "retain-on-failure", screenshots: true, snapshots: false, sources: true },
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  webServer: {
    command: "pnpm vite build && pnpm vite preview --port 4173 --strictPort",
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
