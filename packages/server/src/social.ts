import type { ChatChannel, ServerMessage } from "@openseas/protocol";
import { Room, RoomRegistry, type RoomMember } from "./rooms.js";
import type { ShipService } from "./ships/service.js";

/** A request the tavern refuses. The code is sent to the client as is. */
export class SocialError extends Error {
  constructor(readonly code: "not_aboard" | "aboard_a_ship") {
    super(code);
    this.name = "SocialError";
  }
}

/**
 * Who is ashore where, and the two chat channels (DESIGN.md 3.7). Islands are rooms (ADR 0005) of
 * the connected pirates standing on them; a pirate aboard a ship is in no island room. Ship chat
 * goes to the ship room the ship service keeps. Nothing here is persisted: chat is ephemeral in v1.
 */
export class SocialService {
  private readonly islands = new RoomRegistry<ServerMessage>();
  private readonly names = new Map<string, string>();
  private readonly where = new Map<string, string>();

  constructor(
    private readonly ships: ShipService,
    private readonly now: () => number = Date.now,
  ) {
    ships.onAshore = (pirateId, islandId) => this.ashore(pirateId, islandId);
    ships.onBoarded = (pirateId) => this.leaveIsland(pirateId);
  }

  /** A socket opened. If the pirate is not aboard, they stand on their island. */
  async connected(pirateId: string, name: string, member: RoomMember<ServerMessage>): Promise<void> {
    this.names.set(pirateId, name);
    this.members.set(pirateId, member);
    if (this.ships.roomOf(pirateId)) return;
    this.ashore(pirateId, await this.ships.pirateIsland(pirateId));
  }

  /** A socket closed. Only the socket that holds the seat takes the pirate off the island. */
  disconnected(pirateId: string, member: RoomMember<ServerMessage>): void {
    if (this.members.get(pirateId) !== member) return;
    this.members.delete(pirateId);
    this.leaveIsland(pirateId);
  }

  /** Where the pirate stands, if they are connected and ashore. */
  islandOf(pirateId: string): string | null {
    return this.where.get(pirateId) ?? null;
  }

  presence(islandId: string): ServerMessage {
    const room = this.islands.peek(islandId);
    const pirates = (room?.memberIds() ?? []).map((pirateId) => ({ pirateId, name: this.names.get(pirateId) ?? pirateId }));
    return { type: "island.presence", islandId, pirates };
  }

  chat(pirateId: string, channel: ChatChannel, text: string): void {
    const msg: ServerMessage = { type: "chat.message", channel, pirateId, name: this.names.get(pirateId) ?? pirateId, text, at: this.now() };
    if (channel === "ship") {
      const room = this.ships.roomOf(pirateId);
      if (!room) throw new SocialError("not_aboard");
      room.conns.broadcast(msg);
      return;
    }
    const islandId = this.where.get(pirateId);
    if (!islandId) throw new SocialError("aboard_a_ship");
    this.islands.get(islandId).broadcast(msg);
  }

  // ---- internals

  private readonly members = new Map<string, RoomMember<ServerMessage>>();

  private ashore(pirateId: string, islandId: string): void {
    const member = this.members.get(pirateId);
    if (!member) return;
    const before = this.where.get(pirateId);
    if (before === islandId) return;
    if (before) this.leaveIsland(pirateId);
    const room: Room<ServerMessage> = this.islands.get(islandId);
    room.join(member);
    this.where.set(pirateId, islandId);
    room.broadcast(this.presence(islandId));
  }

  private leaveIsland(pirateId: string): void {
    const islandId = this.where.get(pirateId);
    if (!islandId) return;
    this.where.delete(pirateId);
    const room = this.islands.peek(islandId);
    if (!room) return;
    room.leave(pirateId);
    if (room.size === 0) this.islands.sweep();
    else room.broadcast(this.presence(islandId));
  }
}
