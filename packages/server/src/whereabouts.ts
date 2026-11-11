import { eq, inArray } from "drizzle-orm";
import type { Content } from "@openseas/content";
import { schema, type Db, type Tx } from "./db/index.js";
import type { Presence } from "./presence.js";
import type { ShipRoom } from "./ships/service.js";

/**
 * Where a pirate is, in the crew card's three kinds (ADR 0025): aboard a ship, connected or not (a
 * dropped pirate's seat is held); on an outpost, connected; or offline.
 */
export type Whereabout = { kind: "aboard"; room: ShipRoom } | { kind: "on-outpost"; outpostId: string } | { kind: "offline" };

/** What a service that only asks where pirates are needs: the social service, crews, the connection layer. */
export type WhereaboutsLookup = Pick<Whereabouts, "of" | "outpost">;

/**
 * The one answer to "where is this pirate". A pirate is aboard a ship or at an outpost, and online or
 * not (Presence).
 *
 * Aboard is held in memory only, like the ships themselves: a restart puts every ship back in port.
 * The outpost a pirate is at is player state in Postgres (`pirate.outpost_id`): the one they stand
 * on, or, aboard, the one they boarded from or last docked at. It is kept in memory too, for every
 * pirate read or moved since start, so the notice board a client polls every few seconds never waits
 * on a query. Only the ship service moves pirates, and only through here, so memory never falls
 * behind Postgres.
 */
export class Whereabouts {
  private readonly aboard = new Map<string, ShipRoom>();
  /** Pirates a ship has let go of and is still putting on an outpost. */
  private readonly disembarking = new Set<string>();
  private readonly outposts = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly content: Content,
    private readonly presence: Presence,
  ) {}

  /**
   * Where the pirate is now. A pirate whose connection has just opened is offline here until their
   * outpost is read, which their connection does as it opens (SocialService.connected).
   */
  of(pirateId: string): Whereabout {
    const room = this.aboard.get(pirateId);
    if (room) return { kind: "aboard", room };
    if (this.disembarking.has(pirateId) || !this.presence.online(pirateId)) return { kind: "offline" };
    const outpostId = this.outposts.get(pirateId);
    return outpostId ? { kind: "on-outpost", outpostId } : { kind: "offline" };
  }

  /** The outpost the pirate is at: the one they stand on, or, aboard, the one they boarded from or their ship last docked at. */
  async outpost(pirateId: string): Promise<string> {
    const known = this.outposts.get(pirateId);
    if (known) return known;
    const [p] = await this.db.select({ outpostId: schema.pirate.outpostId }).from(schema.pirate).where(eq(schema.pirate.id, pirateId));
    const read = p?.outpostId ?? this.content.world.startOutpostId;
    // A move made while the read was out is newer than what it found.
    if (p && !this.outposts.has(pirateId)) this.outposts.set(pirateId, read);
    return this.outposts.get(pirateId) ?? read;
  }

  // ---- moves, the ship service's

  /** The pirate went aboard. Their outpost stays where it was until they disembark or the ship docks. */
  board(pirateId: string, room: ShipRoom): void {
    this.aboard.set(pirateId, room);
  }

  /**
   * The ship let go of the pirate: nothing finds them aboard from now on. Until the ship has put
   * them on an outpost (`disembark`) they are nowhere, offline to anyone who asks.
   */
  leaveShip(pirateId: string): void {
    if (this.aboard.delete(pirateId)) this.disembarking.add(pirateId);
  }

  /**
   * The pirate the ship let go of is at `outpostId`. Should the write fail, they are at the outpost
   * Postgres holds, and no longer nowhere.
   */
  async disembark(pirateId: string, outpostId: string): Promise<void> {
    try {
      await this.db.update(schema.pirate).set({ outpostId }).where(eq(schema.pirate.id, pirateId));
      this.outposts.set(pirateId, outpostId);
    } finally {
      this.disembarking.delete(pirateId);
    }
  }

  /** The ship these pirates are aboard docked at `outpostId`: they are at it now, still aboard. Written in the ship's own transaction. */
  async arrive(tx: Tx, pirateIds: readonly string[], outpostId: string): Promise<void> {
    if (pirateIds.length === 0) return;
    await tx.update(schema.pirate).set({ outpostId }).where(inArray(schema.pirate.id, pirateIds));
    for (const id of pirateIds) this.outposts.set(id, outpostId);
  }
}
