import { defineConfig, devices } from "@playwright/test";

const port = 4174;

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
    command: "pnpm vite build && pnpm vite preview --port 4174 --strictPort",
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
