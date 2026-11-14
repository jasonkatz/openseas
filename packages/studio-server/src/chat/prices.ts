import type { ChatModel } from "@openseas/protocol";

/** The model each choice in the picker runs (ADR 0042 decision 5). */
export const MODEL_IDS: Readonly<Record<ChatModel, string>> = { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5", opus: "claude-opus-5-5" };

/** What a response used, as the Messages API reports it. */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * US dollars a million tokens: input, output, a cache read. Read from Anthropic's published
 * prices when this was written; the meter is the studio's own guard against a runaway turn, an
 * estimate and not a bill. A cache write is charged at 1.25 times input.
 */
const PRICES: ReadonlyArray<{ prefix: string; input: number; output: number; cacheRead: number }> = [
  { prefix: "claude-haiku-5-5", input: 0.1, output: 0.5, cacheRead: 0.01 },
  { prefix: "claude-sonnet-5-5", input: 2, output: 10, cacheRead: 0.1 },
  { prefix: "claude-opus-5-5", input: 4, output: 20, cacheRead: 0.2 },
];
/** A model the table does not know is priced as the dearest it does: the meter errs toward stopping early. */
const DEAREST = PRICES[PRICES.length - 1]!;

export function costUsd(model: string, u: Usage): number {
  const p = PRICES.find((x) => model.startsWith(x.prefix)) ?? DEAREST;
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000;
}
