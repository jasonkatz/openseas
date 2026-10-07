import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Crew, Pirate, Ship } from '@tidebound/shared';

export interface WorldData {
  version: number;
  pirates: Record<string, Pirate>;
  /** login token -> pirate id */
  tokens: Record<string, string>;
  crews: Record<string, Crew>;
  ships: Record<string, Ship>;
  nextShipNo: number;
}

export function emptyWorld(): WorldData {
  return { version: 1, pirates: {}, tokens: {}, crews: {}, ships: {}, nextShipNo: 1 };
}

/** JSON-file persistence with debounced writes. Good enough for a single-node world. */
export class Store {
  data: WorldData;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private path: string) {
    this.data = this.load();
  }

  private load(): WorldData {
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, 'utf8')) as WorldData;
        if (raw && raw.version === 1) return { ...emptyWorld(), ...raw };
      }
    } catch (e) {
      console.warn('[store] failed to load, starting fresh:', (e as Error).message);
    }
    return emptyWorld();
  }

  markDirty(): void {
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 2000);
  }

  flush(): void {
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.path);
    } catch (e) {
      console.error('[store] write failed:', (e as Error).message);
    }
  }
}
