import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** The commit this build came from: the deploy pipeline sets COMMIT_SHA; local builds say "dev". */
const commit = process.env.COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "dev";

/**
 * Emits `dist/version.json` with the commit, so the deploy pipeline (.github/workflows/deploy.yml)
 * can confirm the live harness is the merged commit, the same way it checks the game.
 */
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
  define: { __HARNESS_COMMIT__: JSON.stringify(commit) },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: false },
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
