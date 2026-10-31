import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Emits `dist/version.json` with the commit the build came from, so the deploy pipeline
 * (.github/workflows/deploy.yml) can confirm the live client is the merged commit.
 * The pipeline sets COMMIT_SHA; Vercel git builds set VERCEL_GIT_COMMIT_SHA; plain GitHub Actions
 * sets GITHUB_SHA; local builds say "dev".
 */
function versionFile(): Plugin {
  const commit =
    process.env.COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "dev";
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
  // VITE_* vars live in the repo-root .env alongside the server's.
  envDir: "../..",
  server: {
    port: 5173,
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
