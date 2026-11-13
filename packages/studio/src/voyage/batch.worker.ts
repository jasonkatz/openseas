/**
 * Flies a batch off the page's thread: a voyage with a boarding melee takes a few hundred
 * milliseconds, and a batch is dozens of them. It loads content itself and resolves the scenario
 * with the same checks as the page, so it flies exactly what the page validated.
 */

import { loadContent } from "@openseas/content";
import { resolveScenario, type VoyageScenario } from "./scenario.js";
import { runBatch, type RunSummary } from "./batch.js";

export type BatchRequest = { readonly scenario: VoyageScenario; readonly runs: number };
export type BatchReply = { readonly type: "progress"; readonly done: number } | { readonly type: "done"; readonly runs: readonly RunSummary[] } | { readonly type: "error"; readonly message: string };

const port = self as unknown as { postMessage(m: BatchReply): void; onmessage: ((e: MessageEvent<BatchRequest>) => void) | null };
const content = loadContent();

port.onmessage = (e) => {
  const r = resolveScenario(content, e.data.scenario);
  if (!r.ok) {
    port.postMessage({ type: "error", message: r.errors.join("\n") });
    return;
  }
  void runBatch(r.setup, e.data.runs, (done) => port.postMessage({ type: "progress", done }))
    .then((runs) => port.postMessage({ type: "done", runs }))
    .catch((err: unknown) => port.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) }));
};
