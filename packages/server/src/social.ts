import type { ChatChannel, ServerMessage, WalkSpot } from "@openseas/protocol";
import { Room, RoomRegistry, type RoomMember } from "./rooms.js";
import type { CrewLookup, LookLookup, ShipService } from "./ships/service.js";

/** The least time between two walks a pirate's place hears about. */
export const WALK_MIN_MS = 80;

/** A request the cantina refuses. The code is sent to the client as is. */
export class SocialError extends Error {
  constructor(readonly code: "not_aboard" | "aboard_a_ship" | "not_in_crew") {
    super(code);
    this.name = "SocialError";
  }
}

/** Where crew chat goes: every connected member of the sender's crew (M6). */
export interface CrewChat extends CrewLookup {
  chat(pirateId: string, message: ServerMessage): void;
}

/**
 * Who is on the outpost where, and the three chat channels (DESIGN.md 3.7). Outposts are rooms (ADR 0005) of
 * the connected pirates standing on them; a pirate aboard a ship is in no outpost room. Ship chat
 * goes to the ship room the ship service keeps, crew chat to the crew wherever its members are.
 * Nothing here is persisted: chat is ephemeral in v1.
 *
 * Walking (ADR 0032) is relayed here too: a pirate's walk target in their place's frame goes to
 * everyone else in the place, the outpost room on the outpost or the ship room aboard. It is cosmetic; no
 * rule reads it, so it is only bounded and paced, never checked against the ground.
 */
export class SocialService {
  /** Crews, once the crew service exists. */
  crews: CrewChat | null = null;
  /** What each pirate wears (DESIGN.md 3.6), once the connection layer has looks; without it presence carries none. */
  looks: LookLookup | null = null;
  private readonly outposts = new RoomRegistry<ServerMessage>();
  private readonly names = new Map<string, string>();
  private readonly where = new Map<string, string>();
  /** Where each pirate last walked to, in the frame of the place they are in now. Forgotten when they leave it. */
  private readonly walks = new Map<string, { scope: "outpost" | "ship"; at: WalkSpot; sentAt: number }>();

  constructor(
    private readonly ships: ShipService,
    private readonly now: () => number = Date.now,
  ) {
    ships.onDisembark = (pirateId, outpostId) => this.onOutpost(pirateId, outpostId);
    ships.onBoarded = (pirateId) => {
      this.leaveOutpost(pirateId);
      this.walks.delete(pirateId);
      this.sendDeckWalkers(pirateId);
    };
  }

  /** A socket opened. If the pirate is not aboard, they stand on their outpost. */
  async connected(pirateId: string, name: string, member: RoomMember<ServerMessage>): Promise<void> {
    this.names.set(pirateId, name);
    this.members.set(pirateId, member);
    if (this.ships.roomOf(pirateId)) {
      this.sendDeckWalkers(pirateId);
      return;
    }
    this.onOutpost(pirateId, await this.ships.pirateOutpost(pirateId));
  }

  /** A socket closed. Only the socket that holds the seat takes the pirate off the outpost. */
  disconnected(pirateId: string, member: RoomMember<ServerMessage>): void {
    if (this.members.get(pirateId) !== member) return;
    this.members.delete(pirateId);
    this.leaveOutpost(pirateId);
  }

  /** Where the pirate stands, if they are connected and on the outpost. */
  outpostOf(pirateId: string): string | null {
    return this.where.get(pirateId) ?? null;
  }

  presence(outpostId: string): ServerMessage {
    const room = this.outposts.peek(outpostId);
    const pirates = (room?.memberIds() ?? []).map((pirateId) => {
      const walk = this.walks.get(pirateId);
      return { pirateId, name: this.names.get(pirateId) ?? pirateId, crew: this.crews?.tagOf(pirateId) ?? null, at: walk?.scope === "outpost" ? walk.at : null, look: this.looks?.lookOf(pirateId) ?? null };
    });
    return { type: "outpost.presence", outpostId, pirates };
  }

  chat(pirateId: string, channel: ChatChannel, text: string): void {
    const msg: ServerMessage = { type: "chat.message", channel, pirateId, name: this.names.get(pirateId) ?? pirateId, text, at: this.now() };
    if (channel === "crew") {
      if (!this.crews?.crewIdOf(pirateId)) throw new SocialError("not_in_crew");
      this.crews.chat(pirateId, msg);
      return;
    }
    if (channel === "ship") {
      const room = this.ships.roomOf(pirateId);
      if (!room) throw new SocialError("not_aboard");
      room.conns.broadcast(msg);
      return;
    }
    const outpostId = this.where.get(pirateId);
    if (!outpostId) throw new SocialError("aboard_a_ship");
    this.outposts.get(outpostId).broadcast(msg);
  }

  /**
   * The pirate walks to a spot in their place. On the outpost it goes to the outpost's room, aboard to the
   * ship's, never back to the walker. A pirate in no place walks nowhere. Walks closer together than
   * `WALK_MIN_MS` are dropped: a client paces its own to a few a second.
   */
  walk(pirateId: string, at: WalkSpot): void {
    const room = this.ships.roomOf(pirateId);
    const outpostId = room ? null : this.where.get(pirateId);
    if (!room && !outpostId) return;
    const scope = room ? "ship" : "outpost";
    const now = this.now();
    const last = this.walks.get(pirateId);
    if (last && last.scope === scope && now - last.sentAt < WALK_MIN_MS) return;
    this.walks.set(pirateId, { scope, at: { x: at.x, z: at.z }, sentAt: now });
    const msg: ServerMessage = { type: "walk.moved", scope, pirateId, x: at.x, z: at.z };
    if (room) room.conns.broadcast(msg, pirateId);
    else this.outposts.peek(outpostId!)?.broadcast(msg, pirateId);
  }

  /** Crews or looks changed for these pirates: outposts where any of them stands hear the new presence, flags, looks and all. */
  refreshPresence(pirateIds: readonly string[]): void {
    const outposts = new Set<string>();
    for (const id of pirateIds) {
      const at = this.where.get(id);
      if (at) outposts.add(at);
    }
    for (const outpostId of outposts) this.outposts.peek(outpostId)?.broadcast(this.presence(outpostId));
  }

  // ---- internals

  private readonly members = new Map<string, RoomMember<ServerMessage>>();

  /** Where everyone else aboard the pirate's ship last walked to, for a pirate coming aboard (or back). */
  private sendDeckWalkers(pirateId: string): void {
    const room = this.ships.roomOf(pirateId);
    if (!room) return;
    const walkers: { pirateId: string; x: number; z: number }[] = [];
    for (const id of room.conns.memberIds()) {
      const w = this.walks.get(id);
      if (id !== pirateId && w?.scope === "ship") walkers.push({ pirateId: id, x: w.at.x, z: w.at.z });
    }
    room.conns.send(pirateId, { type: "walk.where", scope: "ship", walkers });
  }

  private onOutpost(pirateId: string, outpostId: string): void {
    const member = this.members.get(pirateId);
    if (!member) return;
    const before = this.where.get(pirateId);
    if (before === outpostId) return;
    if (before) this.leaveOutpost(pirateId);
    // Off a ship or off another outpost: wherever they walked there means nothing here.
    this.walks.delete(pirateId);
    const room: Room<ServerMessage> = this.outposts.get(outpostId);
    room.join(member);
    this.where.set(pirateId, outpostId);
    room.broadcast(this.presence(outpostId));
  }

  private leaveOutpost(pirateId: string): void {
    const outpostId = this.where.get(pirateId);
    if (!outpostId) return;
    this.where.delete(pirateId);
    if (this.walks.get(pirateId)?.scope === "outpost") this.walks.delete(pirateId);
    const room = this.outposts.peek(outpostId);
    if (!room) return;
    room.leave(pirateId);
    if (room.size === 0) this.outposts.sweep();
    else room.broadcast(this.presence(outpostId));
  }
}
