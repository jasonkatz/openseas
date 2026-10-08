import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { schema } from "./db/index.js";
import type { Env } from "./env.js";
import type { Logger } from "./log.js";

/**
 * Move everything a guest owns onto the account they just linked (ADR 0007). Idempotent: a second
 * call with the same pair is a no-op. The pirate row carries the ledger, ratings, and ships with it.
 */
export async function mergeGuestIntoAccount(db: Db, guestUserId: string, accountUserId: string): Promise<void> {
  if (guestUserId === accountUserId) return;
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.pirate).where(eq(schema.pirate.userId, accountUserId));
    if (existing) return; // the account already has a pirate; the guest's pirate is left as is
    await tx.update(schema.pirate).set({ userId: accountUserId }).where(eq(schema.pirate.userId, guestUserId));
  });
}

export function createAuth(env: Env, db: Db, log: Logger) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    socialProviders.discord = { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: env.CLIENT_ORIGINS,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // No email/password auth exists (DESIGN.md 3.8).
    emailAndPassword: { enabled: false },
    socialProviders,
    plugins: [
      anonymous({
        emailDomainName: "guest.openseas.invalid",
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          log.info({ from: anonymousUser.user.id, to: newUser.user.id }, "linking guest to account");
          await mergeGuestIntoAccount(db, anonymousUser.user.id, newUser.user.id);
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
