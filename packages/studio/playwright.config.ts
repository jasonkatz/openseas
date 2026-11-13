import { defineConfig, devices } from "@playwright/test";

// PW_PORT lets two checkouts run their smoke side by side without sharing a preview server.
const port = Number(process.env.PW_PORT ?? 4174);

export default defineConfig({
  testDir: "./e2e",
  // CI runners draw the phone profile several times slower than a laptop; give them room.
  timeout: process.env.CI ? 60_000 : 30_000,
  retries: process.env.CI ? 1 : 0,
  // In CI an HTML report is written too, so a failure's trace reaches the uploaded artifact.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  webServer: {
    // The build is told where the studio's service is; no service runs here, and the tests that
    // need one answer for it themselves (e2e/links.spec.ts).
    command: `pnpm vite build && pnpm vite preview --port ${port} --strictPort`,
    env: { VITE_STUDIO_SERVICE_URL: process.env.VITE_STUDIO_SERVICE_URL ?? "http://localhost:8090" },
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
