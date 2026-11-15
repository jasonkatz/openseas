import type { Plugin } from "vite";

/**
 * The Vite plugin that builds every puzzle's atlas from its frame files (ADR 0054), and provides
 * `virtual:openseas/atlases`. `dir` is the sprites folder to pack from; tests point it elsewhere.
 */
export declare function atlases(options?: { dir?: string }): Plugin;
