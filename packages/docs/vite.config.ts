import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** The commit this build came from: the deploy pipeline sets COMMIT_SHA; local builds say "dev". */
const commit = process.env.COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "dev";

/** Emits `dist/version.json` with the commit, as the game and the harness do, so a deploy can be checked. */
function versionFile(): Plugin {
  return {
    name: "openseas-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ commit }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  server: { port: 5175, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
