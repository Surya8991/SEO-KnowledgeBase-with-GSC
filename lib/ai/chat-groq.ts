import Groq from "groq-sdk";
import { BaseChatProvider } from "./chat-base";
import { log } from "@/lib/logger";

/**
 * Groq chat provider with key rotation + model fallback (Session 11).
 *
 * The free tier caps tokens-per-day PER KEY PER MODEL, so a single key dies
 * mid-day with a 429 TPD error. Mitigations, both env-driven:
 *
 *   GROQ_API_KEYS=key1,key2,key3   comma-separated pool; falls back to the
 *                                  single GROQ_API_KEY when unset.
 *   GROQ_MODEL                     primary model (llama-3.3-70b-versatile).
 *   GROQ_FALLBACK_MODEL            tried after every key 429s on the primary -
 *                                  each model has its own TPD bucket, so the
 *                                  same keys usually still work on it.
 *                                  Default llama-3.1-8b-instant; set to ""
 *                                  to disable model fallback.
 *
 * Order on 429: primary model across all keys → fallback model across all
 * keys → throw the last 429. Rate-limited key+model combos are remembered
 * with a cooldown (from the retry-after header when present) so subsequent
 * calls in the same warm instance skip dead combos instead of re-probing.
 */

/** key+model combos on cooldown after a 429 → epoch-ms when retryable. */
const cooldownUntil = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 15 * 60_000;

function retryAfterMs(err: unknown): number {
  const h = (err as { headers?: Record<string, string> })?.headers;
  const s = Number(h?.["retry-after"]);
  if (Number.isFinite(s) && s > 0) return Math.min(s * 1000, MAX_COOLDOWN_MS);
  return DEFAULT_COOLDOWN_MS;
}

export class GroqChatProvider extends BaseChatProvider {
  readonly name = "groq";
  private clients: Groq[];
  private models: string[];

  constructor() {
    super();
    const keys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keys.length === 0) throw new Error("GROQ_API_KEY / GROQ_API_KEYS is not set.");
    this.clients = keys.map((apiKey) => new Groq({ apiKey }));

    const primary = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    const fallbackRaw = process.env.GROQ_FALLBACK_MODEL;
    const fallback = fallbackRaw === undefined ? "llama-3.1-8b-instant" : fallbackRaw.trim();
    this.models = fallback && fallback !== primary ? [primary, fallback] : [primary];
  }

  protected async complete(system: string, user: string): Promise<string> {
    let lastErr: unknown;
    for (const model of this.models) {
      for (let i = 0; i < this.clients.length; i++) {
        const comboKey = `${i}:${model}`;
        const until = cooldownUntil.get(comboKey);
        if (until && Date.now() < until) continue; // known-exhausted, skip
        try {
          const res = await this.clients[i].chat.completions.create({
            model,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          });
          return res.choices[0]?.message?.content ?? "";
        } catch (e) {
          const status = (e as { status?: number })?.status;
          if (status === 429) {
            cooldownUntil.set(comboKey, Date.now() + retryAfterMs(e));
            log.warn("groq 429 - rotating", { key: i + 1, of: this.clients.length, model });
            lastErr = e;
            continue; // next key, then next model
          }
          throw e; // non-rate-limit errors are real failures
        }
      }
    }
    throw lastErr ?? new Error("All Groq keys/models are rate-limited.");
  }
}
