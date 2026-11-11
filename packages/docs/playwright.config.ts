import { defineConfig, devices } from "@playwright/test";

// PW_PORT lets two checkouts run their smoke side by side without sharing a preview server.
const port = Number(process.env.PW_PORT ?? 4175);

export default defineConfig({
  testDir: "./e2e",
  timeout: process.env.CI ? 60_000 : 30_000,
  retries: process.env.CI ? 1 : 0,
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
    command: `pnpm vite build && pnpm vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
