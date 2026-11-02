import { HttpErrorSchema, MeResponseSchema, type ErrorCode, type MeResponse, type PirateSummary } from "@openseas/protocol";
import { SERVER_URL } from "./base.js";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "network",
    readonly status: number,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError("network", 0);
  }
  if (!res.ok) {
    let code: ErrorCode = "internal";
    try {
      const parsed = HttpErrorSchema.safeParse(await res.json());
      if (parsed.success) code = parsed.data.error;
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(code, res.status);
  }
  return res.json();
}

export async function getMe(): Promise<MeResponse> {
  return MeResponseSchema.parse(await call("/api/me"));
}

export async function createPirate(inviteCode: string | undefined): Promise<PirateSummary> {
  const body = (await call("/api/pirate", { method: "POST", body: JSON.stringify(inviteCode ? { inviteCode } : {}) })) as {
    pirate: PirateSummary;
  };
  return body.pirate;
}
