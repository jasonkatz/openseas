import { defineConfig } from "vitest/config";

/** Unit tests for the round session, against a fake socket and clock. The boards are smoked by the harness (Playwright). */
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
