import Anthropic from "@anthropic-ai/sdk";
import { BaseChatProvider } from "./chat-base";

/**
 * Default Anthropic model id.
 *
 * Audit 10C (Session 8): `claude-sonnet-4-6` is the documented public id
 * for Claude Sonnet 4.6 per the claude-api skill reference. If a future
 * model rename breaks calls in prod, override via `ANTHROPIC_MODEL` env
 * (no redeploy needed) and update this default in the same commit.
 *
 * Known-current ids (Jan 2026 cutoff):
 *   - claude-opus-4-8
 *   - claude-sonnet-4-6      ← current default
 *   - claude-haiku-4-5-20251001
 *   - claude-fable-5
 */
const DEFAULT_MODEL = "claude-sonnet-4-6";

export class ClaudeChatProvider extends BaseChatProvider {
  readonly name = "claude";
  private client: Anthropic;
  private model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  constructor() {
    super();
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
    this.client = new Anthropic({ apiKey: key });
  }

  protected async complete(system: string, user: string): Promise<string> {
    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        temperature: 0.2,
        system: `${system} Respond with valid JSON only — no markdown fences.`,
        messages: [{ role: "user", content: user }],
      });
      const block = res.content.find((b) => b.type === "text");
      return block && block.type === "text" ? block.text : "";
    } catch (e) {
      // Audit 10C: surface the model id in 404 / not_found_error so a
      // model-rename outage is debuggable from the log line.
      const msg = (e as Error).message ?? "";
      if (/not_found|model_not_found|404/i.test(msg)) {
        throw new Error(
          `Anthropic model "${this.model}" not found. Override via ANTHROPIC_MODEL env var.`,
        );
      }
      throw e;
    }
  }
}
