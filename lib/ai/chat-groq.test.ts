import { test, assert, expect } from "vitest";
import { GroqChatProvider } from "./chat-groq";

function makeProvider(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ["GROQ_API_KEY", "GROQ_API_KEYS", "GROQ_MODEL", "GROQ_FALLBACK_MODEL"]) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k]!;
  }
  try {
    return new GroqChatProvider();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Stub client whose create() replays the given outcomes in order. */
function stubClient(outcomes: Array<"ok" | number>, calls: string[], tag: string) {
  return {
    chat: {
      completions: {
        create: async ({ model }: { model: string }) => {
          calls.push(`${tag}:${model}`);
          const next = outcomes.shift();
          if (next === "ok") return { choices: [{ message: { content: `{"from":"${tag}"}` } }] };
          const err: any = new Error("rate limited");
          err.status = next;
          throw err;
        },
      },
    },
  };
}

test("GROQ_API_KEYS parses a comma-separated pool", () => {
  const p: any = makeProvider({ GROQ_API_KEYS: "k1, k2 ,k3", GROQ_API_KEY: undefined });
  assert.equal(p.clients.length, 3);
});

test("falls back to single GROQ_API_KEY when pool unset", () => {
  const p: any = makeProvider({ GROQ_API_KEYS: undefined, GROQ_API_KEY: "solo" });
  assert.equal(p.clients.length, 1);
});

test("model list = [primary, fallback]; empty fallback disables it", () => {
  const p: any = makeProvider({ GROQ_API_KEY: "k", GROQ_MODEL: "m1", GROQ_FALLBACK_MODEL: "m2" });
  assert.deepEqual(p.models, ["m1", "m2"]);
  const p2: any = makeProvider({ GROQ_API_KEY: "k", GROQ_MODEL: "m1", GROQ_FALLBACK_MODEL: "" });
  assert.deepEqual(p2.models, ["m1"]);
});

test("429 rotates to the next key, then the fallback model", async () => {
  const p: any = makeProvider({ GROQ_API_KEYS: "a,b", GROQ_MODEL: "big", GROQ_FALLBACK_MODEL: "small" });
  const calls: string[] = [];
  // key a: 429 on big AND small; key b: 429 on big, ok on small.
  p.clients = [stubClient([429, 429], calls, "a"), stubClient([429, "ok"], calls, "b")];
  const out = await p.complete("sys", "usr");
  assert.equal(out, `{"from":"b"}`);
  assert.deepEqual(calls, ["a:big", "b:big", "a:small", "b:small"]);
});

test("non-429 errors are NOT swallowed", async () => {
  const p: any = makeProvider({ GROQ_API_KEYS: "a,b", GROQ_MODEL: "m", GROQ_FALLBACK_MODEL: "" });
  const calls: string[] = [];
  p.clients = [stubClient([500], calls, "a"), stubClient(["ok"], calls, "b")];
  await expect(p.complete("s", "u")).rejects.toThrow();
  assert.deepEqual(calls, ["a:m"]); // no rotation on a real failure
});

test("exhausted combos are skipped via cooldown on subsequent calls", async () => {
  const p: any = makeProvider({ GROQ_API_KEYS: "x1,x2", GROQ_MODEL: "mdl", GROQ_FALLBACK_MODEL: "" });
  const calls: string[] = [];
  p.clients = [stubClient([429, "ok"], calls, "x1"), stubClient(["ok", "ok"], calls, "x2")];
  await p.complete("s", "u"); // x1 429s → cooldown; x2 serves
  const before = calls.length;
  await p.complete("s", "u"); // x1 must be skipped without a probe
  assert.deepEqual(calls.slice(before), ["x2:mdl"]);
});
