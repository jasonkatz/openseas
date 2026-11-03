/**
 * Rooms are the seam for sharding later (ADR 0005). In v1 a room is an in-process set of
 * connections that can be broadcast to. Ships, islands, and swordfights will be rooms from M3.
 * The practice page does not need rooms, but the abstraction is designed now so M3 fits it.
 */
export interface RoomMember<M> {
  readonly id: string;
  send(message: M): void;
}

export class Room<M> {
  private readonly members = new Map<string, RoomMember<M>>();

  constructor(readonly id: string) {}

  join(member: RoomMember<M>): void {
    this.members.set(member.id, member);
  }

  leave(memberId: string): void {
    this.members.delete(memberId);
  }

  has(memberId: string): boolean {
    return this.members.has(memberId);
  }

  get(memberId: string): RoomMember<M> | undefined {
    return this.members.get(memberId);
  }

  send(memberId: string, message: M): boolean {
    const m = this.members.get(memberId);
    if (!m) return false;
    m.send(message);
    return true;
  }

  get size(): number {
    return this.members.size;
  }

  memberIds(): string[] {
    return [...this.members.keys()];
  }

  broadcast(message: M, except?: string): void {
    for (const [id, m] of this.members) if (id !== except) m.send(message);
  }
}

export class RoomRegistry<M> {
  private readonly rooms = new Map<string, Room<M>>();

  get(id: string): Room<M> {
    let r = this.rooms.get(id);
    if (!r) {
      r = new Room<M>(id);
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
