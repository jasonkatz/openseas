// Bundles the server (including workspace shared sources) into dist/index.js for `pnpm start`.
import { build } from 'esbuild';
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  external: ['ws'],
  sourcemap: true,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
console.log('server bundled → dist/index.js');
