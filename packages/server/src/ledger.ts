import { desc, eq, sql } from "drizzle-orm";
import { schema, type Db, type Tx } from "./db/index.js";

/**
 * Append one entry to a pirate's ledger and return the new balance. The pirate row is locked for
 * the duration of the transaction so concurrent appends serialize (DESIGN.md 3.6).
 */
export async function appendLedger(tx: Tx, pirateId: string, delta: number, reason: string, ref: string | null): Promise<number> {
  await tx.execute(sql`select 1 from ${schema.pirate} where ${schema.pirate.id} = ${pirateId} for update`);
  const current = await balance(tx, pirateId);
  const balanceAfter = current + delta;
  if (balanceAfter < 0) throw new InsufficientFundsError(pirateId, current, delta);
  await tx.insert(schema.ledgerEntry).values({ pirateId, delta, balanceAfter, reason, ref });
  return balanceAfter;
}

export async function balance(db: Db | Tx, pirateId: string): Promise<number> {
  const [last] = await db
    .select({ balanceAfter: schema.ledgerEntry.balanceAfter })
    .from(schema.ledgerEntry)
    .where(eq(schema.ledgerEntry.pirateId, pirateId))
    .orderBy(desc(schema.ledgerEntry.id))
    .limit(1);
  return last?.balanceAfter ?? 0;
}

export class InsufficientFundsError extends Error {
  constructor(
    readonly pirateId: string,
    readonly balance: number,
    readonly delta: number,
  ) {
    super("insufficient funds");
    this.name = "InsufficientFundsError";
  }
}
