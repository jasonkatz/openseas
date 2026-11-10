import { defineConfig } from "vitest/config";

/** Unit tests for the world's layout, which is pure. The shell is smoked by Playwright (e2e). */
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
