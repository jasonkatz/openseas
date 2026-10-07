import { z } from "zod";
import { ErrorCodeSchema, PirateSummarySchema } from "./common.js";

export const CreatePirateRequestSchema = z.object({
  inviteCode: z.string().max(64).optional(),
});
export type CreatePirateRequest = z.infer<typeof CreatePirateRequestSchema>;

export const MeResponseSchema = z.object({
  pirate: PirateSummarySchema.nullable(),
  /** True when the server requires an invite code to create a pirate. */
  inviteRequired: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const HttpErrorSchema = z.object({ error: ErrorCodeSchema });
export type HttpError = z.infer<typeof HttpErrorSchema>;
