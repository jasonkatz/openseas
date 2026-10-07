import type { Pirate, ServerMsg } from '@tidebound/shared';
import { ISLANDS, ISLAND_BY_ID, HOME_ISLAND_ID, rngFromSeed, rngNext, rngPick, randomSeed } from '@tidebound/shared';
import type { Rng } from '@tidebound/shared';
import { Session } from './session';
import type { World } from './world';
import { randomAvatar } from './world';

/**
 * Ambient islanders: NPC pirates that wander the islands and chatter, so the
 * overworld feels inhabited even when few players are online. They are real
 * pirates in the world (presence, chat) but never board ships.
 */
const NAMES = ['Old Gorm', 'Pegleg Ysolde', 'Quiet Tam', 'Brass Nell', 'Fiddler Hob', 'Salt Marla', 'Rook the Younger', 'Cook Bess', 'Grell Oneshoe', 'Lanterns Pip'];
const LINES = [
  'Fine weather for a pillage.', 'Heard the brigands are thick off Wyrmtooth this week.', 'Rum\'s cheap at Saltmarrow, dear at Gullrock. Just saying.',
  'Anyone need a bilge rat? I\'m not volunteering.', 'A navy sloop\'s free to any crew that\'ll sail her.', 'My carpentry\'s Excellent, ask anyone.',
  'Iron sells best at Ember Reach, if ye can get there in one piece.', 'The Lantern Room pours the best ale on the ocean.', 'Arr.', 'Mind the reefs north of Brineholm.',
];

class BotWs {
  readyState = 1;
  OPEN = 1;
  send(_s: string) { /* bots don't read */ }
  close() { /* noop */ }
}

interface Bot { session: Session; target: { x: number; y: number }; idleUntil: number; nextChat: number; rng: Rng }

export class Bots {
  bots: Bot[] = [];
  constructor(private world: World) {}

  spawn(count: number): void {
    let rng = rngFromSeed(randomSeed());
    for (let i = 0; i < count; i++) {
      const name = NAMES[i % NAMES.length]!;
      let p = Object.values(this.world.data.pirates).find((x) => x.name === name && x.id.startsWith('bot'));
      if (!p) {
        p = this.world.makePirate(name, randomAvatar(), 'bot');
        p.title = 'Islander';
      }
      const islandId = i < Math.ceil(count * 0.5) ? HOME_ISLAND_ID : ISLANDS[i % ISLANDS.length]!.id;
      p.location = { kind: 'island', islandId, x: 400 + i * 120, y: 600 };
      const session = new Session(`bot${i}`, new BotWs() as unknown as Session['ws']);
      session.pirateId = p.id;
      session.pos = { x: p.location.x, y: p.location.y, facing: 2, moving: false };
      this.world.byPirate.set(p.id, session);
      let v: number;
      [rng, v] = rngNext(rng);
      this.bots.push({ session, target: { x: p.location.x, y: p.location.y }, idleUntil: Date.now() + v * 5000, nextChat: Date.now() + 20000 + v * 60000, rng: rngFromSeed(randomSeed()) });
    }
  }

  tick(now: number, dt: number): void {
    for (const b of this.bots) {
      const p = this.world.data.pirates[b.session.pirateId!];
      if (!p || p.location.kind !== 'island') continue;
      const isl = ISLAND_BY_ID[p.location.islandId]!;
      const pos = b.session.pos;
      if (now < b.idleUntil) { pos.moving = false; }
      else {
        const dx = b.target.x - pos.x, dy = b.target.y - pos.y;
        const d = Math.hypot(dx, dy);
        if (d < 6) {
          let v: number;
          [b.rng, v] = rngNext(b.rng);
          b.idleUntil = now + 2000 + v * 9000;
          // Wander to a spot near a random building door or the dock.
          let bld: (typeof isl.buildings)[number];
          [b.rng, bld] = rngPick(b.rng, isl.buildings);
          let ox: number, oy: number;
          [b.rng, ox] = rngNext(b.rng);
          [b.rng, oy] = rngNext(b.rng);
          b.target = { x: Math.max(60, Math.min(isl.width - 60, bld.door.x + (ox - 0.5) * 300)), y: Math.max(60, Math.min(isl.height - 60, bld.door.y + 20 + oy * 160)) };
          pos.moving = false;
        } else {
          const sp = 110 * dt;
          pos.x += (dx / d) * sp;
          pos.y += (dy / d) * sp;
          pos.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
          pos.moving = true;
          p.location.x = pos.x; p.location.y = pos.y;
        }
      }
      if (now >= b.nextChat) {
        let line: string;
        [b.rng, line] = rngPick(b.rng, LINES);
        let v: number;
        [b.rng, v] = rngNext(b.rng);
        b.nextChat = now + 45000 + v * 120000;
        // Only talk when someone real is around to hear it.
        const listeners = this.world.piratesOnIsland(isl.id).filter((s) => !s.id.startsWith('bot'));
        if (listeners.length > 0) {
          const msg: ServerMsg = { t: 'chat', from: p.name, fromId: p.id, channel: 'local', text: line, at: now };
          for (const s of listeners) s.send(msg);
        }
      }
    }
  }
}

export type { Pirate };
