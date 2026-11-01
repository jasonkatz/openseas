import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Content, ShipGrant } from "@openseas/content";
import { msg } from "@openseas/content";
import { tierFor } from "@openseas/engine";
import { schema, type Tx } from "./db/index.js";
import { appendLedger } from "./ledger.js";

/**
 * The one and only way a pirate gets a ship (ADR 0010). Charges the ledger (possibly zero) and
 * creates the ship row in the same transaction.
 */
export async function purchaseShip(
  tx: Tx,
  content: Content,
  pirateId: string,
  classId: string,
  price: number,
  grantId: string | null,
  name: string,
  /** The island the ship is delivered to: where the pirate stands. */
  islandId: string,
): Promise<{ shipId: string; balance: number }> {
  const shipClass = content.world.shipClasses.find((c) => c.id === classId);
  if (!shipClass) throw new Error(`unknown ship class ${classId}`);
  const balance = await appendLedger(tx, pirateId, -price, "ship.purchase", grantId ?? classId);
  const shipId = randomUUID();
  await tx.insert(schema.ship).values({ id: shipId, ownerId: pirateId, classId, name, grantId, islandId });
  return { shipId, balance };
}

export interface GrantContext {
  voyagesCompleted: number;
  /** Best rating across puzzles on the display scale, or null if unrated. */
  bestRating: number | null;
}

export function grantEligible(content: Content, grant: ShipGrant, ctx: GrantContext): boolean {
  if (ctx.voyagesCompleted < grant.requires.voyagesCompleted) return false;
  if (grant.requires.minTier !== null) {
    if (ctx.bestRating === null) return false;
    const need = content.ratingTiers.find((t) => t.key === grant.requires.minTier);
    if (!need) return false;
    const have = tierFor(ctx.bestRating, content.ratingTiers);
    if (have.min < need.min) return false;
  }
  return true;
}

/** Apply every automatic grant the pirate qualifies for and has not already received. */
export async function applyAutomaticGrants(
  tx: Tx,
  content: Content,
  pirateId: string,
  pirateName: string,
  ctx: GrantContext,
  islandId: string,
): Promise<string[]> {
  const granted: string[] = [];
  for (const grant of content.world.shipGrants) {
    if (!grant.automatic || !grantEligible(content, grant, ctx)) continue;
    if (grant.once) {
      const [already] = await tx
        .select({ id: schema.ship.id })
        .from(schema.ship)
        .where(and(eq(schema.ship.ownerId, pirateId), eq(schema.ship.grantId, grant.id)))
        .limit(1);
      if (already) continue;
    }
    const [adjective, noun] = pirateName.split(" ");
    const shipName = msg(content, "ship.default_name", { adjective: adjective ?? "Salty", noun: noun ?? "Gull" });
    await purchaseShip(tx, content, pirateId, grant.shipClassId, grant.price, grant.id, shipName, islandId);
    granted.push(grant.id);
  }
  return granted;
}
