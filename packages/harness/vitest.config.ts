import { defineConfig } from "vitest/config";

/** Unit tests for the harness's pure parts: scenario codec, presets, review replay. Boards are smoked by Playwright. */
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
