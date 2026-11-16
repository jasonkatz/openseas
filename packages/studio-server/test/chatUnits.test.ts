import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { context, withNumbers } from "../src/chat/chat.js";
import { anthropicUsd, openaiUsd } from "../src/chat/prices.js";
import { createModelProxy, fieldOf, meterBody, meterImages } from "../src/chat/proxy.js";
import { mayWrite, ownFile, repoPath } from "../src/chat/scope.js";
import { summarize } from "../src/chat/sdkRunner.js";
import { createLogger } from "../src/log.js";

describe("the puzzle's own files", () => {
  it("are the ones that carry its id, under the packages a puzzle is made of", () => {
    for (const path of [
      "packages/engine/src/cooling/reduce.ts",
      "packages/engine/test/cooling.test.ts",
      "packages/protocol/src/cooling.ts",
      "packages/content/data/puzzles/cooling.json",
      "packages/boards/src/cooling/CoolingBoard.tsx",
      "packages/boards/src/sprites/cooling.webp",
      "packages/boards/briefs/sprites/cooling.json",
      "packages/docs/src/guides/cooling.ts",
      "packages/docs/capture/cooling.capture.ts",
      "packages/docs/public/media/cooling/cascade.mp4",
      "packages/studio/src/pages/CoolingPractice.tsx",
      "packages/boards/src/sprites/frames/cooling/cog.webp",
      "packages/studio/src/tuning/groups/cooling.ts",
      "docs/puzzles/cooling.md",
      // Two files every puzzle shares: its strings and its frames are in them.
      "packages/content/data/messages/en.json",
      "packages/boards/src/sprites/frames.json",
    ])
      expect(ownFile("cooling", path), path).toBe(true);
    for (const path of [
      "packages/engine/src/engines/reduce.ts",
      "packages/engine/src/index.ts",
      "packages/boards/src/kit/board.ts",
      "packages/server/src/cooling.ts",
      "packages/studio-server/src/http.ts",
      "docs/DESIGN.md",
      "CLAUDE.md",
      ".claude/skills/puzzles/SKILL.md",
      ".github/workflows/ci.yml",
      "package.json",
      "packages/content/data/puzzles/coolingtower.json",
    ])
      expect(ownFile("cooling", path), path).toBe(false);
    // An id is not the start of a longer word, and a prototype's files are its own too.
    expect(ownFile("tug", "packages/engine/src/tugboat/index.ts")).toBe(false);
    expect(ownFile("tug", "packages/content/data/messages/prototypes/tug.json")).toBe(true);
    expect(ownFile("tug", "docs/prototypes/tug.md")).toBe(true);
  });

  it("grow by what the owner allows for the draft, and never reach the repository's own machinery", () => {
    expect(mayWrite("cooling", "docs/DESIGN.md", [])).toBe(false);
    expect(mayWrite("cooling", "docs/DESIGN.md", ["docs/DESIGN.md"])).toBe(true);
    expect(mayWrite("cooling", "packages/boards/src/kit/board.ts", ["packages/boards/src/kit"])).toBe(true);
    expect(mayWrite("cooling", "packages/boards/src/kitten.ts", ["packages/boards/src/kit"])).toBe(false);
    expect(mayWrite("cooling", ".git/hooks/pre-commit", [".git", ""])).toBe(false);
  });

  it("are named from the worktree, and nothing outside it has a name", () => {
    expect(repoPath("/data/worktrees/abc", "/data/worktrees/abc/docs/puzzles/cooling.md")).toBe("docs/puzzles/cooling.md");
    expect(repoPath("/data/worktrees/abc", "docs/../docs/puzzles/cooling.md")).toBe("docs/puzzles/cooling.md");
    expect(repoPath("/data/worktrees/abc", "/data/worktrees/abcd/x")).toBeNull();
    expect(repoPath("/data/worktrees/abc", "/etc/passwd")).toBeNull();
    expect(repoPath("/data/worktrees/abc", "../../repo/.git/config")).toBeNull();
    expect(repoPath("/data/worktrees/abc", "/data/worktrees/abc")).toBeNull();
  });
});

describe("the agent's tool for numbers", () => {
  const base = { seed: "keg-3", overrides: { pieceKinds: 5 }, roundSeconds: 90, paceSeconds: null, thresholds: null };
  it("sets and puts back by the content file's keys", () => {
    expect(withNumbers(base, { "config.specialChancePerMille.charge": 40, paceSeconds: 12 }, ["config.pieceKinds", "roundSeconds"])).toEqual({ seed: "keg-3", overrides: { "specialChancePerMille.charge": 40 }, roundSeconds: null, paceSeconds: 12, thresholds: null });
    expect(withNumbers(base, { thresholds: [{ score: 1, rating: 1000 }] }, [])).toMatchObject({ thresholds: [{ score: 1, rating: 1000 }] });
  });
  it("refuses a key that is not a number's", () => {
    expect(() => withNumbers(base, { seed: "x" }, [])).toThrow(/not a number/);
    expect(() => withNumbers(base, { "config.": 1 }, [])).toThrow();
    expect(() => withNumbers(base, {}, ["pieces"])).toThrow();
  });
});

describe("what a message carries under the owner's words", () => {
  it("gives the numbers, what the build refuses, the rounds and the allowed paths", () => {
    const text = context({ seed: "keg-3", overrides: { pieceKinds: 5 }, roundSeconds: 90, paceSeconds: null, thresholds: null }, ["config.width: too small"], [{ seed: "a1", score: 420, tier: "able", seconds: 150.2, moves: 61, tuned: true }], ["docs/DESIGN.md"]);
    expect(text).toContain('"config":{"pieceKinds":5},"roundSeconds":90');
    expect(text).toContain("Pinned seed: keg-3");
    expect(text).toContain("- config.width: too small");
    expect(text).toContain("- seed a1: score 420, tier able, 150s, 61 moves, on the draft's numbers");
    expect(text).toContain("docs/DESIGN.md");
    const bare = context({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null }, [], [], []);
    expect(bare).toContain("none changed");
    expect(bare).toContain("No round has been played");
    expect(bare).not.toContain("Draft picks");
  });
  it("gives the draft's picks, and keeps them when a number is set", () => {
    const picked = { seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, picks: { sprites: { cog: `abcdef012345${"0".repeat(52)}` }, sounds: { clear: "synth" } } };
    const text = context(picked, [], [], []);
    expect(text).toContain("cog: abcdef012345");
    expect(text).toContain("clear: the synthesized cue");
    expect(withNumbers(picked, { paceSeconds: 12 }, []).picks).toEqual(picked.picks);
  });
  it("gives the draft's words, and keeps them when a number is set (ADR 0057)", () => {
    const worded = { seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, words: { texts: { "cooling.multi_2": "Twofer!" }, category: "crafting" as const } };
    const text = context(worded, [], [], []);
    expect(text).toContain('"cooling.multi_2":"Twofer!"');
    expect(text).toContain("Draft category: crafting");
    expect(withNumbers(worded, { paceSeconds: 12 }, []).words).toEqual(worded.words);
    expect(context({ ...worded, words: { texts: {}, category: null } }, [], [], [])).not.toContain("Draft words");
  });
});

describe("the meter", () => {
  it("reads usage from a streamed response: the input side at the start, the output as its last word", () => {
    const sse = [
      "event: message_start",
      'data: {"type":"message_start","message":{"usage":{"input_tokens":1200,"cache_read_input_tokens":8000,"cache_creation_input_tokens":300,"output_tokens":1}}}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","usage":{"output_tokens":90}}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","usage":{"output_tokens":450}}',
      "",
    ].join("\n");
    expect(meterBody(sse, true)).toEqual({ input: 1200, output: 450, cacheRead: 8000, cacheWrite: 300 });
    expect(meterBody('{"usage":{"input_tokens":10,"output_tokens":20}}', false)).toEqual({ input: 10, output: 20, cacheRead: 0, cacheWrite: 0 });
    expect(meterBody("not json", false)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });
  it("prices a model it knows, and one it does not as the dearest", () => {
    const u = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 };
    expect(anthropicUsd("claude-sonnet-5-5", u)).toBeCloseTo(12.1, 6);
    // Two million tokens of prompt is past Haiku 5.5's 100K: five times its rates.
    expect(anthropicUsd("claude-haiku-5-5", u)).toBeCloseTo(3.05, 6);
    expect(anthropicUsd("claude-opus-5-5", u)).toBeCloseTo(24.2, 6);
    expect(anthropicUsd("something-new", u)).toBe(anthropicUsd("claude-opus-5-5", u));
    expect(anthropicUsd("claude-sonnet-5-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 })).toBeCloseTo(2.5, 6);
  });
  it("prices by what the response says: the model that answered, the hour's cache writes, fast mode, Haiku's long prompts", () => {
    const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(anthropicUsd("claude-opus-5-5", { ...none, model: "claude-haiku-5-5", output: 1_000_000 })).toBeCloseTo(0.5, 6);
    expect(anthropicUsd("claude-sonnet-5-5", { ...none, cacheWrite1h: 1_000_000 })).toBeCloseTo(4, 6);
    expect(anthropicUsd("claude-opus-5-5", { ...none, output: 1_000_000, speed: "fast" })).toBeCloseTo(40, 6);
    expect(anthropicUsd("claude-haiku-5-5", { ...none, input: 200_000 })).toBeCloseTo(0.1, 6);
    expect(anthropicUsd("claude-haiku-5-5", { ...none, input: 50_000 })).toBeCloseTo(0.005, 6);
  });
  it("reads the model, the cache writes by lifetime and the speed from a response", () => {
    const body = JSON.stringify({ model: "claude-haiku-5-5", usage: { input_tokens: 3, output_tokens: 4, cache_creation_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 }, speed: "fast" } });
    expect(meterBody(body, false)).toEqual({ model: "claude-haiku-5-5", input: 3, output: 4, cacheRead: 0, cacheWrite: 10, cacheWrite1h: 20, speed: "fast" });
  });
  it("reads an image response's usage, and prices it by the image model's rates", () => {
    const u = meterImages(JSON.stringify({ data: [], usage: { input_tokens: 1100, output_tokens: 8320, input_tokens_details: { text_tokens: 100, image_tokens: 1000 } } }));
    expect(u).toEqual({ textIn: 100, imageIn: 1000, cachedIn: 0, imageOut: 8320, textOut: 0 });
    expect(openaiUsd("gpt-image-1.5", u!)).toBeCloseTo((100 * 5 + 1000 * 8 + 8320 * 32) / 1e6, 9);
    expect(openaiUsd("gpt-image-1-mini", u!)).toBeCloseTo((100 * 2 + 1000 * 2.5 + 8320 * 8) / 1e6, 9);
    expect(openaiUsd("gpt-image-9", u!)).toBe(openaiUsd("gpt-image-1.5", u!));
    expect(meterImages('{"data":[]}')).toBeNull();
  });
  it("reads a request's fields from JSON or a multipart form", () => {
    expect(fieldOf(Buffer.from('{"model":"gpt-image-1.5","n":2}'), "model")).toBe("gpt-image-1.5");
    const form = Buffer.from('--b\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-image-1-mini\r\n--b\r\nContent-Disposition: form-data; name="n"\r\n\r\n3\r\n--b--\r\n');
    expect(fieldOf(form, "model")).toBe("gpt-image-1-mini");
    expect(fieldOf(form, "n")).toBe("3");
  });
});

describe("the proxy, for the generation scripts", () => {
  it("passes OpenAI and ElevenLabs requests on with the real keys, and meters each from its response", async () => {
    const seen: Array<{ url: string; auth: string; xi: string }> = [];
    const upstream = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        seen.push({ url: req.url ?? "", auth: String(req.headers.authorization ?? ""), xi: String(req.headers["xi-api-key"] ?? "") });
        if ((req.url ?? "").startsWith("/v1/images/")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: [{ b64_json: "AAAA" }], usage: { input_tokens: 50, output_tokens: 4160, input_tokens_details: { text_tokens: 50, image_tokens: 0 } } }));
        } else if ((req.url ?? "").startsWith("/v1/sound-generation")) {
          res.writeHead(200, { "content-type": "audio/mpeg", "character-cost": "100" });
          res.end(Buffer.from([1, 2, 3]));
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
        }
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const at = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const proxy = await createModelProxy({ apiKey: "sk-ant", openai: { key: "sk-openai", upstream: at }, elevenlabs: { key: "el-real", upstream: at, usdPerCredit: 0.0002 }, log: createLogger("silent", false) });
    const bare = await createModelProxy({ apiKey: "sk-ant", log: createLogger("silent", false) });
    try {
      const spends: number[] = [];
      const gate = proxy.admit({ open: () => true, spend: (usd) => void spends.push(usd) });
      const img = await fetch(`${proxy.url}/openai/v1/images/generations`, { method: "POST", headers: { authorization: `Bearer ${gate.token}`, "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-image-1.5", prompt: "a cog", n: 1 }) });
      expect(img.status).toBe(200);
      expect(((await img.json()) as { data: unknown[] }).data).toHaveLength(1);
      const snd = await fetch(`${proxy.url}/elevenlabs/v1/sound-generation?output_format=mp3_44100_128`, { method: "POST", headers: { "xi-api-key": gate.token, "content-type": "application/json" }, body: "{}" });
      expect(snd.status).toBe(200);
      expect(Buffer.from(await snd.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
      // Unbilled requests pass unmetered.
      await (await fetch(`${proxy.url}/openai/v1/models`, { headers: { authorization: `Bearer ${gate.token}` } })).text();
      await expect.poll(() => spends.length).toBe(2);
      expect(spends[0]).toBeCloseTo((50 * 5 + 4160 * 32) / 1e6, 9);
      expect(spends[1]).toBeCloseTo(100 * 0.0002, 9);
      // The real keys went upstream, the turn's token never did, and the paths lost their prefix.
      expect(seen.map((s) => s.url)).toEqual(["/v1/images/generations", "/v1/sound-generation?output_format=mp3_44100_128", "/v1/models"]);
      expect(seen[0]!.auth).toBe("Bearer sk-openai");
      expect(seen[1]!.xi).toBe("el-real");
      expect(JSON.stringify(seen)).not.toContain(gate.token);
      // A wrong token, a closed gate, and a provider the service holds no key for are each refused.
      expect((await fetch(`${proxy.url}/openai/v1/images/generations`, { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" })).status).toBe(401);
      const shut = proxy.admit({ open: () => false, spend: () => undefined });
      expect((await fetch(`${proxy.url}/elevenlabs/v1/sound-generation`, { method: "POST", headers: { "xi-api-key": shut.token }, body: "{}" })).status).toBe(403);
      const elsewhere = bare.admit({ open: () => true, spend: () => undefined });
      expect((await fetch(`${bare.url}/openai/v1/images/generations`, { method: "POST", headers: { authorization: `Bearer ${elsewhere.token}` }, body: "{}" })).status).toBe(404);
      gate.close();
      shut.close();
      elsewhere.close();
    } finally {
      await proxy.close();
      await bare.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});

describe("a step's line", () => {
  it("is the file, the command or the pattern, on one line", () => {
    expect(summarize("Edit", { file_path: "/w/docs/puzzles/cooling.md", old_string: "a" })).toBe("/w/docs/puzzles/cooling.md");
    expect(summarize("Edit", { file_path: "/w/docs/puzzles/cooling.md" }, "/w")).toBe("docs/puzzles/cooling.md");
    expect(summarize("Edit", { file_path: "/www/docs/x.md" }, "/w")).toBe("/www/docs/x.md");
    expect(summarize("Bash", { command: "pnpm test\necho done" })).toBe("pnpm test");
    expect(summarize("Grep", { pattern: "heatRow" })).toBe("heatRow");
    expect(summarize("mcp__studio__set_numbers", { set: { "config.pieceKinds": 5 } })).toBe('{"set":{"config.pieceKinds":5}}');
    expect(summarize("TodoWrite", {})).toBe("");
  });
});

describe("the model proxy, when the agent hangs up", () => {
  it("stops the model too, and still counts what had arrived", async () => {
    let dropped = false;
    const upstream = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1000, output_tokens: 1 } } })}\n\n`);
      // It would write for a long while yet.
      req.on("close", () => (dropped = true));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await createModelProxy({ apiKey: "sk-real", upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, log: createLogger("silent", false) });
    try {
      let spent = 0;
      const gate = proxy.admit({ open: () => true, spend: (usd) => void (spent += usd) });
      const stop = new AbortController();
      const r = await fetch(`${proxy.url}/v1/messages`, { method: "POST", headers: { "x-api-key": gate.token, "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-5-5", stream: true }), signal: stop.signal });
      expect(r.status).toBe(200);
      const reader = r.body!.getReader();
      await reader.read();
      expect(dropped).toBe(false);
      stop.abort();
      await expect.poll(() => dropped, { timeout: 5000 }).toBe(true);
      await expect.poll(() => spent, { timeout: 5000 }).toBeGreaterThan(0);
      gate.close();
    } finally {
      await proxy.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
