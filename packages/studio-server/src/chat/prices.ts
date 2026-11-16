import type { ChatModel } from "@openseas/protocol";

/** The model each choice in the picker runs (ADR 0042 decision 5). */
export const MODEL_IDS: Readonly<Record<ChatModel, string>> = { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5", opus: "claude-opus-5-5" };

/*
 * What a turn costs (ADR 0059). None of the three APIs the chat pays for answers in dollars: each
 * says what it billed in its own unit, on every response. Anthropic gives tokens by kind, OpenAI's
 * Images API gives tokens by kind, ElevenLabs gives the credits it charged. The service reads
 * those from the responses its proxy passes on, and turns them into dollars by the providers'
 * published rates, kept here. The units are the bill's own; only the rate is ours.
 */

/** What a Messages API response used, as it reports it. */
export interface Usage {
  /** The model that answered, as the response names it; the request's when the response does not. */
  model?: string;
  input: number;
  output: number;
  cacheRead: number;
  /** Cache writes at the five-minute lifetime, or of unknown lifetime. */
  cacheWrite: number;
  /** Cache writes at the hour lifetime: twice input, where five minutes is 1.25 times. */
  cacheWrite1h?: number;
  /** `fast` when the request ran in fast mode, at twice the standard rates. */
  speed?: string;
}

/** US dollars a million tokens: input, output, a cache read. Anthropic's published first-party rates. */
const ANTHROPIC: ReadonlyArray<{ prefix: string; input: number; output: number; cacheRead: number; longFrom?: number; long?: number }> = [
  // Above 100K tokens of prompt, Haiku 5.5 is billed at five times its rates.
  { prefix: "claude-haiku-5-5", input: 0.1, output: 0.5, cacheRead: 0.01, longFrom: 100_000, long: 5 },
  { prefix: "claude-sonnet-5-5", input: 2, output: 10, cacheRead: 0.1 },
  { prefix: "claude-opus-5-5", input: 4, output: 20, cacheRead: 0.2 },
];
/** A model a table does not know is priced as the dearest it does: the meter errs toward stopping early. */
const DEAREST = ANTHROPIC[ANTHROPIC.length - 1]!;

export function anthropicUsd(requested: string, u: Usage): number {
  const model = u.model || requested;
  const p = ANTHROPIC.find((x) => model.startsWith(x.prefix)) ?? DEAREST;
  const prompt = u.input + u.cacheRead + u.cacheWrite + (u.cacheWrite1h ?? 0);
  const scale = (p.longFrom !== undefined && prompt > p.longFrom ? (p.long ?? 1) : 1) * (u.speed === "fast" ? 2 : 1);
  const usd = u.input * p.input + u.cacheWrite * p.input * 1.25 + (u.cacheWrite1h ?? 0) * p.input * 2 + u.cacheRead * p.cacheRead + u.output * p.output;
  return (usd * scale) / 1_000_000;
}

/** What an Images API response used, as its `usage` reports it. */
export interface ImageUsage {
  textIn: number;
  imageIn: number;
  cachedIn: number;
  imageOut: number;
  textOut: number;
}

/** US dollars a million tokens, OpenAI's published rates for its image models. A cached input token is priced as cached text, the dearer reading never mattering at these counts. */
const OPENAI: ReadonlyArray<{ prefix: string; textIn: number; imageIn: number; cachedIn: number; imageOut: number; textOut: number }> = [
  { prefix: "gpt-image-1-mini", textIn: 2, imageIn: 2.5, cachedIn: 0.2, imageOut: 8, textOut: 8 },
  { prefix: "gpt-image-2", textIn: 5, imageIn: 8, cachedIn: 1.25, imageOut: 30, textOut: 10 },
  { prefix: "gpt-image-1.5", textIn: 5, imageIn: 8, cachedIn: 1.25, imageOut: 32, textOut: 10 },
];
const OPENAI_DEAREST = OPENAI[OPENAI.length - 1]!;

export function openaiUsd(model: string, u: ImageUsage): number {
  const p = OPENAI.find((x) => model.startsWith(x.prefix)) ?? OPENAI_DEAREST;
  return (u.textIn * p.textIn + u.imageIn * p.imageIn + u.cachedIn * p.cachedIn + u.imageOut * p.imageOut + u.textOut * p.textOut) / 1_000_000;
}

/**
 * US dollars an ElevenLabs credit, when the service is not told its plan's own: the rate of
 * credits bought past a plan's allowance, the dearest a credit is sold at.
 */
export const ELEVENLABS_USD_PER_CREDIT = 0.0003;

/** A sound generation whose response did not say what it charged: about what a few seconds of sound costs, set a little high. */
export const SOUND_UNMETERED_USD = 0.05;
