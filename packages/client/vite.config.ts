import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Emits `dist/version.json` with the commit the build came from, so the post-merge check
 * (.github/workflows/deploy-verify.yml) can confirm the live client is the merged commit.
 * Vercel sets VERCEL_GIT_COMMIT_SHA; GitHub Actions sets GITHUB_SHA; local builds say "dev".
 */
function versionFile(): Plugin {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "dev";
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
