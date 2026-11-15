/** Every puzzle's atlas, built from its frame files by `@openseas/boards/vite` (ADR 0054). */
declare module "virtual:openseas/atlases" {
  const atlases: Record<string, { url: string; frames: Record<string, [x: number, y: number, w: number, h: number]> }>;
  export default atlases;
}
