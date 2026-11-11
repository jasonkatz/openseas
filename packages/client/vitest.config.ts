import { defineConfig } from "vitest/config";

/** Unit tests for what in the game is pure: the world's layout, and the rules that keep the place honest against the ship. The shell is smoked by Playwright (e2e). */
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
