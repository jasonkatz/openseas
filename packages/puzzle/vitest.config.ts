import { defineConfig } from "vitest/config";
// The parity tests are long and busy. Two workers at most keep a CI runner, shared with the other packages' tests,
// from starving a worker's reports to the runner.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 30_000, maxWorkers: 2 } });
