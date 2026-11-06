import { z } from "zod";
import { ErrorCodeSchema, PirateSummarySchema } from "./common.js";

export const CreatePirateRequestSchema = z.object({
  inviteCode: z.string().max(64).optional(),
});
export type CreatePirateRequest = z.infer<typeof CreatePirateRequestSchema>;

/** The accounts a guest can upgrade to (DESIGN.md 3.8). Only those the server has keys for are offered. */
export const AuthProviderSchema = z.enum(["discord", "google"]);
export type AuthProvider = z.infer<typeof AuthProviderSchema>;

export const MeResponseSchema = z.object({
  pirate: PirateSummarySchema.nullable(),
  /** True when the server requires an invite code to create a pirate. */
  inviteRequired: z.boolean(),
  /** Providers this server can sign in with; empty where none is configured (a PR preview, say). */
  providers: z.array(AuthProviderSchema).default([]),
  /** Providers already linked to the signed-in account. Empty for a guest. */
  linked: z.array(AuthProviderSchema).default([]),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const HttpErrorSchema = z.object({ error: ErrorCodeSchema });
export type HttpError = z.infer<typeof HttpErrorSchema>;
