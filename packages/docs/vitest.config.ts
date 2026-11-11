import { defineConfig } from "vitest/config";

/** Unit tests hold every guide to its shape and its media to the files on disk. The pages are smoked by Playwright. */
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
