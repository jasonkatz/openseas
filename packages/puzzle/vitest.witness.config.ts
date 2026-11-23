import { defineConfig } from "vitest/config";

/** `pnpm --filter @openseas/puzzle witness`: records every puzzle's witness rounds again. Run it only with a change that raises a major. */
export default defineConfig({
  test: { include: ["scripts/record-witness.ts"], testTimeout: 120_000 },
});
