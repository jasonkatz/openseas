/**
 * Rooms are the seam for sharding later (ADR 0005). In v1 a room is an in-process set of members
 * that can be broadcast to: a ship's crew aboard and connected, the pirates standing on an outpost.
 * Who is in a room is the room's own business (a pirate who dropped is still aboard, out of the
 * ship's room); how a message reaches a member is not: the room says it through their line, the
 * pirate's newest socket (Presence).
 */
export interface Lines<M> {
  send(memberId: string, message: M): void;
}

export class Room<M> {
  private readonly members = new Set<string>();

  constructor(
    readonly id: string,
    private readonly lines: Lines<M>,
  ) {}

  join(memberId: string): void {
    this.members.add(memberId);
  }

  leave(memberId: string): void {
    this.members.delete(memberId);
  }

  has(memberId: string): boolean {
    return this.members.has(memberId);
  }

  /** Say something to one member; false when they are not in the room. */
  send(memberId: string, message: M): boolean {
    if (!this.members.has(memberId)) return false;
    this.lines.send(memberId, message);
    return true;
  }

  get size(): number {
    return this.members.size;
  }

  memberIds(): string[] {
    return [...this.members];
  }

  broadcast(message: M, except?: string): void {
    for (const id of this.members) if (id !== except) this.lines.send(id, message);
  }
}

export class RoomRegistry<M> {
  private readonly rooms = new Map<string, Room<M>>();

  constructor(private readonly lines: Lines<M>) {}

  get(id: string): Room<M> {
    let r = this.rooms.get(id);
    if (!r) {
      r = new Room<M>(id, this.lines);
      this.rooms.set(id, r);
    }
    return r;
  }

  peek(id: string): Room<M> | undefined {
    return this.rooms.get(id);
  }

  /** Drop empty rooms. */
  sweep(): void {
    for (const [id, r] of this.rooms) if (r.size === 0) this.rooms.delete(id);
  }
}
