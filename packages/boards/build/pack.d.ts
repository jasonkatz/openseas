/** Types for `./pack.js`, which packs a puzzle's frames into its atlas (ADR 0054). */
export type Rect = [x: number, y: number, w: number, h: number];
export declare const SPRITES: string;
export declare const SIZE: number;
export declare const GUTTER: number;
export declare const STRIDE: number;
export declare const COLUMNS: number;
export declare const ENCODE: Readonly<{ quality: number; alphaQuality: number; effort: number }>;
export declare function manifest(dir?: string): Record<string, string[]>;
export declare const framePath: (puzzle: string, name: string, dir?: string) => string;
export declare function check(dir?: string): Record<string, string[]>;
export declare function layout(names: readonly string[]): { width: number; height: number; frames: Record<string, Rect> };
export declare function sources(puzzle: string, names: readonly string[], dir?: string): { files: Buffer[]; hash: string };
export declare function pack(puzzle: string, names: readonly string[], files: readonly Buffer[]): Promise<Buffer>;
export declare function pixels(input: Buffer): Promise<{ data: Buffer; width: number; height: number }>;
