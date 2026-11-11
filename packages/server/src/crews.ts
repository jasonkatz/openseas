import { and, eq, sql } from "drizzle-orm";
import { crewFlagProblem, type Content, type CrewFlag } from "@openseas/content";
import { NEW_RATING, isPuzzleId, tierFor } from "@openseas/engine";
import type {
  CrewInfo,
  CrewInvite,
  CrewMember,
  CrewNotice,
  CrewRank,
  CrewRow,
  CrewTag,
  CrewWhere,
  ErrorCode,
  PirateProfile,
  ServerMessage,
} from "@openseas/protocol";
import { schema, type Db } from "./db/index.js";
import { recordEvent } from "./events.js";
import { appendLedger, InsufficientFundsError } from "./ledger.js";
import type { Logger } from "./log.js";
import { lookOf, pirateRecord } from "./pirates.js";
import type { Presence } from "./presence.js";
import type { ShipRoom, ShipService } from "./ships/service.js";
import type { SocialService } from "./social.js";

/** A crew request refused. The code is sent to the client as is. */
export class CrewError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "CrewError";
  }
}

const RANK_ORDER: Record<CrewRank, number> = { commodore: 0, officer: 1, spacer: 2 };

interface Member {
  rank: CrewRank;
  joinedAt: number;
}

interface Invite {
  byName: string;
  at: number;
}

interface Crew {
  id: string;
  name: string;
  flag: CrewFlag;
  foundedAt: number;
  stats: { voyages: number; victories: number; plunder: number };
  members: Map<string, Member>;
  /** Invitations waiting, by the invited pirate's id. */
  invites: Map<string, Invite>;
}

export interface CrewServiceOptions {
  now?: () => number;
  randomId: () => string;
}

/** Fold a name for uniqueness: lowercase, single spaces. */
export const crewNameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Crews (M6, ADR 0025): the social unit and the invite list (DESIGN.md 3.4, 3.7). Postgres holds
 * them; this keeps every crew, member and invitation in memory as well, loaded at start and written
 * through on every change, so a ship snapshot or a notice board can say who flies with whom without
 * a query. One server process serves the star system in v1 (DESIGN.md 4.3), so memory is the truth while
 * it runs. Mutations run one at a time.
 */
export class CrewService {
  /** These pirates' summaries changed (they joined, left or founded a crew); the connection layer re-sends them. */
  onSummaryChanged: ((pirateIds: readonly string[]) => void) | null = null;

  private readonly crews = new Map<string, Crew>();
  private readonly byPirate = new Map<string, string>();
  /** Names of every member and invitee, for views; pirate names never change. */
  private readonly names = new Map<string, string>();
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly content: Content,
    private readonly log: Logger,
    private readonly ships: ShipService,
    private readonly social: SocialService,
    private readonly presence: Presence,
    private readonly opts: CrewServiceOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get rules() {
    return this.content.world.crews;
  }

  /** Read every crew, member and invitation. Called once at start. */
  async load(): Promise<void> {
    this.crews.clear();
    this.byPirate.clear();
    const crews = await this.db.select().from(schema.crew);
    for (const c of crews) {
      this.crews.set(c.id, {
        id: c.id,
        name: c.name,
        flag: c.flag,
        foundedAt: c.foundedAt.getTime(),
        stats: { voyages: c.voyages, victories: c.victories, plunder: c.plunder },
        members: new Map(),
        invites: new Map(),
      });
    }
    const members = await this.db
      .select({ pirateId: schema.crewMember.pirateId, crewId: schema.crewMember.crewId, rank: schema.crewMember.rank, joinedAt: schema.crewMember.joinedAt, name: schema.pirate.name })
      .from(schema.crewMember)
      .innerJoin(schema.pirate, eq(schema.pirate.id, schema.crewMember.pirateId));
    for (const m of members) {
      const crew = this.crews.get(m.crewId);
      if (!crew) continue;
      crew.members.set(m.pirateId, { rank: asRank(m.rank), joinedAt: m.joinedAt.getTime() });
      this.byPirate.set(m.pirateId, m.crewId);
      this.names.set(m.pirateId, m.name);
    }
    const invites = await this.db
      .select({ crewId: schema.crewInvite.crewId, pirateId: schema.crewInvite.pirateId, byName: schema.crewInvite.byName, at: schema.crewInvite.at, name: schema.pirate.name })
      .from(schema.crewInvite)
      .innerJoin(schema.pirate, eq(schema.pirate.id, schema.crewInvite.pirateId));
    for (const i of invites) {
      this.crews.get(i.crewId)?.invites.set(i.pirateId, { byName: i.byName, at: i.at.getTime() });
      this.names.set(i.pirateId, i.name);
    }
    this.log.info({ crews: this.crews.size, members: this.byPirate.size }, "crews loaded");
  }

  // ---- lookups for the other services

  crewIdOf(pirateId: string): string | null {
    return this.byPirate.get(pirateId) ?? null;
  }

  tagOf(pirateId: string): CrewTag | null {
    const crew = this.crewOf(pirateId);
    return crew ? tag(crew) : null;
  }

  sameCrew(a: string, b: string): boolean {
    const x = this.byPirate.get(a);
    return x !== undefined && x === this.byPirate.get(b);
  }

  // ---- connections

  /** A pirate's newest socket opened: they hear their crew as it stands. */
  connected(pirateId: string, name: string): void {
    this.names.set(pirateId, name);
    this.presence.send(pirateId, this.stateFor(pirateId));
  }

  // ---- what a member sees

  stateFor(pirateId: string): ServerMessage {
    const crew = this.crewOf(pirateId);
    const invites: CrewInvite[] = [];
    for (const c of this.crews.values()) {
      const inv = c.invites.get(pirateId);
      if (inv) invites.push({ crew: tag(c), members: c.members.size, by: inv.byName, at: inv.at });
    }
    invites.sort((a, b) => b.at - a.at);
    return { type: "crew.state", crew: crew ? this.info(crew, pirateId) : null, invites, serverNow: this.now() };
  }

  /** The board of crews: the most plunder first. */
  list(limit = 20): ServerMessage {
    const rows: CrewRow[] = [...this.crews.values()]
      .sort((a, b) => b.stats.plunder - a.stats.plunder || b.stats.victories - a.stats.victories || b.stats.voyages - a.stats.voyages || b.members.size - a.members.size || a.foundedAt - b.foundedAt)
      .slice(0, limit)
      .map((c) => ({ ...tag(c), members: c.members.size, stats: { ...c.stats } }));
    return { type: "crew.list", crews: rows };
  }

  async profile(viewerId: string, by: { pirateId?: string | undefined; name?: string | undefined }): Promise<ServerMessage> {
    const where = by.pirateId ? eq(schema.pirate.id, by.pirateId) : by.name ? sql`lower(${schema.pirate.name}) = lower(${by.name.trim()})` : null;
    if (!where) throw new CrewError("no_such_pirate");
    const [p] = await this.db.select({ id: schema.pirate.id, name: schema.pirate.name, look: schema.pirate.look, title: schema.pirate.title }).from(schema.pirate).where(where);
    if (!p) throw new CrewError("no_such_pirate");
    const [ratings, record] = await Promise.all([this.db.select().from(schema.rating).where(eq(schema.rating.pirateId, p.id)), pirateRecord(this.db, p.id)]);
    const crew = this.crewOf(p.id);
    const rank = crew?.members.get(p.id)?.rank;
    const mine = this.crewOf(viewerId);
    const profile: PirateProfile = {
      pirateId: p.id,
      name: p.name,
      crew: crew && rank ? { ...tag(crew), rank } : null,
      ratings: ratings.flatMap((r) => (isPuzzleId(r.puzzle) ? [{ puzzle: r.puzzle, tier: tierFor(r.rating ?? NEW_RATING.rating, this.content.ratingTiers).key, rounds: r.rounds }] : [])),
      voyages: record?.voyages ?? 0,
      victories: record?.victories ?? 0,
      look: lookOf(this.content, p.id, p.look),
      title: p.title && this.content.world.pirates.titles.some((t) => t.id === p.title) ? p.title : null,
      online: this.presence.online(p.id),
      invited: Boolean(mine?.invites.has(p.id)),
    };
    return { type: "pirate.profile", profile };
  }

  /** Crew chat: to every member who is connected, wherever they are. */
  chat(pirateId: string, message: ServerMessage): void {
    const crew = this.crewOf(pirateId);
    if (!crew) throw new CrewError("not_in_crew");
    for (const id of crew.members.keys()) this.presence.send(id, message);
  }

  // ---- actions

  found(pirateId: string, rawName: string, flag: CrewFlag): Promise<void> {
    return this.serial(async () => {
      if (this.crewOf(pirateId)) throw new CrewError("already_in_crew");
      const name = rawName.trim().replace(/\s+/g, " ");
      const rules = this.rules;
      if (name.length < rules.name.min || name.length > rules.name.max) throw new CrewError("crew_name_bad");
      const key = crewNameKey(name);
      if ([...this.crews.values()].some((c) => crewNameKey(c.name) === key)) throw new CrewError("crew_name_taken");
      if (crewFlagProblem(rules, flag)) throw new CrewError("crew_flag_bad");
      const id = this.opts.randomId();
      const at = new Date(this.now());
      try {
        await this.db.transaction(async (tx) => {
          await tx.insert(schema.crew).values({ id, name, nameKey: key, flag, founderId: pirateId, foundedAt: at });
          await tx.insert(schema.crewMember).values({ pirateId, crewId: id, rank: "commodore", joinedAt: at });
          if (rules.foundingFee > 0) await appendLedger(tx, pirateId, -rules.foundingFee, "crew_founded", id);
          await recordEvent(tx, pirateId, "crew.founded", { crewId: id, name, flag });
        });
      } catch (e) {
        if (e instanceof InsufficientFundsError) throw new CrewError("short_of_credits");
        if (isUniqueViolation(e)) throw new CrewError("crew_name_taken");
        throw e;
      }
      const crew: Crew = { id, name, flag, foundedAt: at.getTime(), stats: { voyages: 0, victories: 0, plunder: 0 }, members: new Map([[pirateId, { rank: "commodore", joinedAt: at.getTime() }]]), invites: new Map() };
      this.crews.set(id, crew);
      this.byPirate.set(pirateId, id);
      this.log.info({ crewId: id, name, pirateId }, "crew founded");
      this.notify([pirateId], { type: "founded", crew: tag(crew) });
      this.changed([pirateId]);
    });
  }

  setFlag(pirateId: string, flag: CrewFlag): Promise<void> {
    return this.serial(async () => {
      const crew = this.must(pirateId, "commodore");
      if (crewFlagProblem(this.rules, flag)) throw new CrewError("crew_flag_bad");
      await this.db.update(schema.crew).set({ flag }).where(eq(schema.crew.id, crew.id));
      crew.flag = { ...flag };
      this.notify(this.others(crew, pirateId), { type: "flag", by: this.nameOf(pirateId) });
      this.changed([...crew.members.keys()]);
    });
  }

  invite(pirateId: string, name: string): Promise<void> {
    return this.serial(async () => {
      const crew = this.must(pirateId, "officer");
      const [target] = await this.db
        .select({ id: schema.pirate.id, name: schema.pirate.name })
        .from(schema.pirate)
        .where(sql`lower(${schema.pirate.name}) = lower(${name.trim()})`);
      if (!target) throw new CrewError("no_such_pirate");
      if (crew.members.has(target.id)) throw new CrewError("already_crewmate");
      if (crew.invites.has(target.id)) throw new CrewError("already_invited");
      if (crew.members.size >= this.rules.maxMembers) throw new CrewError("crew_full");
      if (crew.invites.size >= this.rules.maxInvites) throw new CrewError("crew_invites_full");
      const byName = this.nameOf(pirateId);
      const at = this.now();
      await this.db.insert(schema.crewInvite).values({ crewId: crew.id, pirateId: target.id, byName, at: new Date(at) }).onConflictDoNothing();
      crew.invites.set(target.id, { byName, at });
      this.names.set(target.id, target.name);
      void recordEvent(this.db, pirateId, "crew.invited", { crewId: crew.id, pirateId: target.id }).catch((e) => this.log.warn({ err: e }, "event write failed"));
      this.notify([target.id], { type: "invited", crew: tag(crew), by: byName });
      this.pushState([target.id, ...this.officers(crew)]);
    });
  }

  uninvite(pirateId: string, targetId: string): Promise<void> {
    return this.serial(async () => {
      const crew = this.must(pirateId, "officer");
      if (!crew.invites.has(targetId)) throw new CrewError("no_invite");
      await this.db.delete(schema.crewInvite).where(and(eq(schema.crewInvite.crewId, crew.id), eq(schema.crewInvite.pirateId, targetId)));
      crew.invites.delete(targetId);
      this.pushState([targetId, ...this.officers(crew)]);
    });
  }

  answer(pirateId: string, crewId: string, accept: boolean): Promise<void> {
    return this.serial(async () => {
      const crew = this.crews.get(crewId);
      if (!crew || !crew.invites.has(pirateId)) throw new CrewError("no_invite");
      const name = this.nameOf(pirateId);
      if (!accept) {
        await this.db.delete(schema.crewInvite).where(and(eq(schema.crewInvite.crewId, crew.id), eq(schema.crewInvite.pirateId, pirateId)));
        crew.invites.delete(pirateId);
        this.notify(this.officers(crew), { type: "declined", name });
        this.pushState([pirateId, ...this.officers(crew)]);
        return;
      }
      if (crew.members.size >= this.rules.maxMembers) throw new CrewError("crew_full");
      // Joining a crew leaves the one the pirate is in.
      const old = this.crewOf(pirateId);
      if (old) await this.drop(old, pirateId, { type: "left", name });
      const at = this.now();
      await this.db.transaction(async (tx) => {
        await tx.delete(schema.crewInvite).where(and(eq(schema.crewInvite.crewId, crew.id), eq(schema.crewInvite.pirateId, pirateId)));
        await tx.insert(schema.crewMember).values({ pirateId, crewId: crew.id, rank: "spacer", joinedAt: new Date(at) });
        await recordEvent(tx, pirateId, "crew.joined", { crewId: crew.id });
      });
      crew.invites.delete(pirateId);
      crew.members.set(pirateId, { rank: "spacer", joinedAt: at });
      this.byPirate.set(pirateId, crew.id);
      this.notify(this.others(crew, pirateId), { type: "joined", name });
      this.changed([...crew.members.keys()]);
    });
  }

  leave(pirateId: string): Promise<void> {
    return this.serial(async () => {
      const crew = this.crewOf(pirateId);
      if (!crew) throw new CrewError("not_in_crew");
      await this.drop(crew, pirateId, { type: "left", name: this.nameOf(pirateId) });
      this.changed([pirateId]);
    });
  }

  setRank(pirateId: string, targetId: string, rank: CrewRank): Promise<void> {
    return this.serial(async () => {
      const crew = this.must(pirateId, "commodore");
      const target = crew.members.get(targetId);
      if (!target || targetId === pirateId) throw new CrewError("not_in_crew");
      if (target.rank === rank) return;
      if (rank === "commodore") {
        // Handing over the crew: the old commodore stays on as an officer.
        await this.db.transaction(async (tx) => {
          await tx.update(schema.crewMember).set({ rank: "commodore" }).where(eq(schema.crewMember.pirateId, targetId));
          await tx.update(schema.crewMember).set({ rank: "officer" }).where(eq(schema.crewMember.pirateId, pirateId));
        });
        target.rank = "commodore";
        crew.members.get(pirateId)!.rank = "officer";
        this.notify([...crew.members.keys()], { type: "rank", name: this.nameOf(targetId), rank: "commodore" });
      } else {
        await this.db.update(schema.crewMember).set({ rank }).where(eq(schema.crewMember.pirateId, targetId));
        target.rank = rank;
        this.notify([...crew.members.keys()], { type: "rank", name: this.nameOf(targetId), rank });
      }
      this.changed([...crew.members.keys()]);
    });
  }

  remove(pirateId: string, targetId: string): Promise<void> {
    return this.serial(async () => {
      const crew = this.must(pirateId, "officer");
      const me = crew.members.get(pirateId)!;
      const target = crew.members.get(targetId);
      if (!target || targetId === pirateId) throw new CrewError("not_in_crew");
      // The commodore may put out anyone; an officer only a spacer.
      if (me.rank !== "commodore" && target.rank !== "spacer") throw new CrewError("crew_rank_low");
      const by = this.nameOf(pirateId);
      await this.drop(crew, targetId, { type: "removed", name: this.nameOf(targetId), by });
      this.notify([targetId], { type: "dismissed", crewName: crew.name, by });
      this.changed([targetId]);
    });
  }

  // ---- what ships tell crews

  /** A voyage reached port: every crew with a member aboard counts it. */
  tallyVoyage(pirateIds: readonly string[]): Promise<void> {
    return this.serial(async () => {
      for (const crew of this.crewsAmong(pirateIds).keys()) {
        await this.db.update(schema.crew).set({ voyages: sql`${schema.crew.voyages} + 1` }).where(eq(schema.crew.id, crew.id));
        crew.stats.voyages += 1;
      }
    });
  }

  /** A raider beaten: every crew with a member aboard counts the win and what its members were paid. */
  tallyVictory(room: ShipRoom, tierId: string, shares: ReadonlyMap<string, number>): Promise<void> {
    return this.serial(async () => {
      const aboard = new Set(shares.keys());
      for (const [crew, ids] of this.crewsAmong([...shares.keys()])) {
        const plunder = ids.reduce((n, id) => n + (shares.get(id) ?? 0), 0);
        await this.db
          .update(schema.crew)
          .set({ victories: sql`${schema.crew.victories} + 1`, plunder: sql`${schema.crew.plunder} + ${plunder}` })
          .where(eq(schema.crew.id, crew.id));
        crew.stats.victories += 1;
        crew.stats.plunder += plunder;
        const onOutpost = [...crew.members.keys()].filter((id) => !aboard.has(id));
        this.notify(onOutpost, { type: "victory", names: ids.map((id) => this.nameOf(id)), shipName: room.name, tierId, plunder });
      }
    });
  }

  /** A ship launched: crewmates on the outpost hear who went, and whether they can still catch her in flight. */
  launched(room: ShipRoom, to: string, pirateIds: readonly string[]): void {
    const aboard = new Set(pirateIds);
    for (const [crew, ids] of this.crewsAmong(pirateIds)) {
      for (const id of crew.members.keys()) {
        if (aboard.has(id) || !this.presence.online(id)) continue;
        this.notify([id], { type: "launched", names: ids.map((x) => this.nameOf(x)), shipId: room.shipId, shipName: room.name, to, joinable: this.ships.canJoin(room, id, this.outpostOf(id)) });
      }
    }
  }

  // ---- internals

  private crewOf(pirateId: string): Crew | null {
    const id = this.byPirate.get(pirateId);
    return id ? (this.crews.get(id) ?? null) : null;
  }

  /** The pirate's crew, if their rank is at least `rank`. */
  private must(pirateId: string, rank: CrewRank): Crew {
    const crew = this.crewOf(pirateId);
    if (!crew) throw new CrewError("not_in_crew");
    const mine = crew.members.get(pirateId)!.rank;
    if (RANK_ORDER[mine] > RANK_ORDER[rank]) throw new CrewError("crew_rank_low");
    return crew;
  }

  private nameOf(pirateId: string): string {
    return this.names.get(pirateId) ?? pirateId;
  }

  private others(crew: Crew, pirateId: string): string[] {
    return [...crew.members.keys()].filter((id) => id !== pirateId);
  }

  private officers(crew: Crew): string[] {
    return [...crew.members].filter(([, m]) => m.rank !== "spacer").map(([id]) => id);
  }

  private outpostOf(pirateId: string): string | null {
    return this.ships.roomOf(pirateId) ? null : this.social.outpostOf(pirateId);
  }

  /** Every crew with someone among these pirates, with who. */
  private crewsAmong(pirateIds: readonly string[]): Map<Crew, string[]> {
    const out = new Map<Crew, string[]>();
    for (const id of pirateIds) {
      const crew = this.crewOf(id);
      if (!crew) continue;
      const list = out.get(crew) ?? [];
      list.push(id);
      out.set(crew, list);
    }
    return out;
  }

  /**
   * Take a member out of a crew. A commodore going hands the crew to the next in rank, longest in
   * the crew first; the last one out disbands it, and its invitations go with it. The rest of the
   * crew hears `notice`.
   */
  private async drop(crew: Crew, pirateId: string, notice: CrewNotice): Promise<void> {
    const leaving = crew.members.get(pirateId);
    if (!leaving) return;
    if (crew.members.size === 1) {
      const invitees = [...crew.invites.keys()];
      await this.db.transaction(async (tx) => {
        await tx.delete(schema.crew).where(eq(schema.crew.id, crew.id));
        await recordEvent(tx, pirateId, "crew.disbanded", { crewId: crew.id, name: crew.name });
      });
      this.crews.delete(crew.id);
      this.byPirate.delete(pirateId);
      this.log.info({ crewId: crew.id, name: crew.name }, "crew disbanded");
      this.pushState(invitees);
      return;
    }
    const successor =
      leaving.rank === "commodore"
        ? [...crew.members].filter(([id]) => id !== pirateId).sort(([, a], [, b]) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || a.joinedAt - b.joinedAt)[0]![0]
        : null;
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.crewMember).where(eq(schema.crewMember.pirateId, pirateId));
      if (successor) await tx.update(schema.crewMember).set({ rank: "commodore" }).where(eq(schema.crewMember.pirateId, successor));
      await recordEvent(tx, pirateId, "crew.left", { crewId: crew.id, reason: notice.type });
    });
    crew.members.delete(pirateId);
    this.byPirate.delete(pirateId);
    const rest = [...crew.members.keys()];
    this.notify(rest, notice);
    if (successor) {
      crew.members.get(successor)!.rank = "commodore";
      this.notify(rest, { type: "rank", name: this.nameOf(successor), rank: "commodore" });
    }
    this.changed(rest);
  }

  private info(crew: Crew, viewerId: string): CrewInfo {
    const viewerOutpost = this.outpostOf(viewerId);
    const members: CrewMember[] = [...crew.members]
      .sort(([, a], [, b]) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || a.joinedAt - b.joinedAt)
      .map(([pirateId, m]) => ({ pirateId, name: this.nameOf(pirateId), rank: m.rank, joinedAt: m.joinedAt, where: this.whereOf(pirateId, viewerId, viewerOutpost) }));
    const rank = crew.members.get(viewerId)?.rank ?? "spacer";
    return {
      ...tag(crew),
      foundedAt: crew.foundedAt,
      stats: { ...crew.stats },
      members,
      invited: rank === "spacer" ? [] : [...crew.invites.keys()].map((id) => ({ pirateId: id, name: this.nameOf(id) })),
    };
  }

  private whereOf(pirateId: string, viewerId: string, viewerOutpost: string | null): CrewWhere {
    const room = this.ships.roomOf(pirateId);
    if (room) {
      const s = room.state;
      const at = this.ships.where(room);
      return {
        kind: "aboard",
        shipId: room.shipId,
        shipName: room.name,
        outpostId: s.outpostId,
        to: at.kind === "in-flight" ? at.to : null,
        progress: at.kind === "in-flight" ? at.progress : 0,
        joinable: pirateId !== viewerId && this.ships.canJoin(room, viewerId, viewerOutpost),
      };
    }
    const outpost = this.presence.online(pirateId) ? this.social.outpostOf(pirateId) : null;
    return outpost ? { kind: "on-outpost", outpostId: outpost } : { kind: "offline" };
  }

  private notify(pirateIds: readonly string[], notice: CrewNotice): void {
    const at = this.now();
    for (const id of pirateIds) this.presence.send(id, { type: "crew.notice", notice, at });
  }

  private pushState(pirateIds: readonly string[]): void {
    for (const id of new Set(pirateIds)) this.presence.send(id, this.stateFor(id));
  }

  /** Membership or the flag changed for these pirates: their views, their summaries and the ships they fly all follow. */
  private changed(pirateIds: readonly string[]): void {
    const ids = [...new Set(pirateIds)];
    this.pushState(ids);
    this.onSummaryChanged?.(ids);
    this.ships.refreshColors(ids);
  }

  /** Run crew mutations one at a time, so two answers to one crew never race. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function tag(crew: Crew): CrewTag {
  return { id: crew.id, name: crew.name, flag: { ...crew.flag } };
}

function asRank(s: string): CrewRank {
  return s === "commodore" || s === "officer" ? s : "spacer";
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } } | null)?.code ?? (e as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "23505";
}
