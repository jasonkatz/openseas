import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { and, eq, inArray } from "drizzle-orm";
import type { AuthProvider } from "@openseas/protocol";
import type { Db } from "./db/index.js";
import { schema } from "./db/index.js";
import type { Env } from "./env.js";
import type { Logger } from "./log.js";

/**
 * What linking did with the guest's pirate: carried it onto the account (`moved`), left it behind
 * because the account already has a pirate of its own (`kept`), or found no guest pirate (`none`).
 */
export type MergeOutcome = "moved" | "kept" | "none";

/**
 * Move everything a guest owns onto the account they just linked (ADR 0007). Idempotent: a second
 * call with the same pair is a no-op. The pirate row carries the ledger, ratings, ships and crew
 * with it. An account that already has a pirate keeps it: that is a returning player signing in on
 * a new device, and their old pirate wins (DESIGN.md 3.8).
 */
export async function mergeGuestIntoAccount(db: Db, guestUserId: string, accountUserId: string): Promise<MergeOutcome> {
  if (guestUserId === accountUserId) return "none";
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: schema.pirate.id }).from(schema.pirate).where(eq(schema.pirate.userId, accountUserId));
    const [guest] = await tx.select({ id: schema.pirate.id }).from(schema.pirate).where(eq(schema.pirate.userId, guestUserId));
    if (!guest) return "none";
    if (existing) return "kept";
    await tx.update(schema.pirate).set({ userId: accountUserId }).where(eq(schema.pirate.id, guest.id));
    return "moved";
  });
}

/**
 * After a link: the guest's auth user goes, sessions and all, unless a pirate is still theirs (the
 * account had its own). A pirate is never deleted with its user (ADR 0007), so that guest stays.
 */
export async function retireGuest(db: Db, guestUserId: string): Promise<boolean> {
  const [still] = await db.select({ id: schema.pirate.id }).from(schema.pirate).where(eq(schema.pirate.userId, guestUserId));
  if (still) return false;
  const gone = await db
    .delete(schema.user)
    .where(and(eq(schema.user.id, guestUserId), eq(schema.user.isAnonymous, true)))
    .returning({ id: schema.user.id });
  return gone.length > 0;
}

const PROVIDERS: readonly AuthProvider[] = ["discord", "google"];

/** The providers this server has keys for, in a fixed order. */
export function configuredProviders(env: Env): AuthProvider[] {
  if (env.DISABLE_SOCIAL_SIGN_IN) return [];
  return PROVIDERS.filter((p) => (p === "discord" ? env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET : env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET));
}

/** The providers linked to an account, in the same order. */
export async function linkedProviders(db: Db, userId: string): Promise<AuthProvider[]> {
  const rows = await db
    .select({ providerId: schema.account.providerId })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), inArray(schema.account.providerId, [...PROVIDERS])));
  const have = new Set(rows.map((r) => r.providerId));
  return PROVIDERS.filter((p) => have.has(p));
}

export function createAuth(env: Env, db: Db, log: Logger) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  const offered = configuredProviders(env);
  if (offered.includes("discord")) socialProviders.discord = { clientId: env.DISCORD_CLIENT_ID!, clientSecret: env.DISCORD_CLIENT_SECRET! };
  if (offered.includes("google")) socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! };

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: env.CLIENT_ORIGINS,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // No email/password auth exists (DESIGN.md 3.8).
    emailAndPassword: { enabled: false },
    socialProviders,
    // A signed-in pirate may link the other provider too, whatever email each one carries.
    account: { accountLinking: { enabled: true, trustedProviders: ["discord", "google"], allowDifferentEmails: true } },
    plugins: [
      anonymous({
        emailDomainName: "guest.openseas.invalid",
        // The plugin would delete the guest's user after a link; a pirate left on it would block
        // that, so we retire the guest ourselves once we know where the pirate went.
        disableDeleteAnonymousUser: true,
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          const outcome = await mergeGuestIntoAccount(db, anonymousUser.user.id, newUser.user.id);
          const retired = await retireGuest(db, anonymousUser.user.id);
          log.info({ from: anonymousUser.user.id, to: newUser.user.id, outcome, retired }, "guest linked to an account");
        },
      }),
    ],
    session: {
      // Guests live a long time in one browser.
      expiresIn: 60 * 60 * 24 * 90,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      ...(env.CROSS_SITE_COOKIES
        ? { defaultCookieAttributes: { sameSite: "none" as const, secure: true, partitioned: true } }
        : {}),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
