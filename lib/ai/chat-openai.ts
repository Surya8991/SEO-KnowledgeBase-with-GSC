import { BaseChatProvider } from "./chat-base";

// Inert until OPENAI_API_KEY is set. Uses fetch (no SDK dependency required).
export class OpenAIChatProvider extends BaseChatProvider {
  readonly name = "openai";
  private model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

  protected async complete(system: string, user: string): Promise<string> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not set. Use AI_CHAT_PROVIDER=groq or claude until you add a key.",
      );
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      // Audit 10C polish (Session 8): include the response body in the
      // error so debugging doesn't require opening the OpenAI dashboard.
      // Truncated to 500 chars so an HTML 5xx page doesn't blow the log line.
      const body = await res.text().catch(() => "");
      throw new Error(
        `OpenAI chat failed: ${res.status} ${res.statusText} ${body.slice(0, 500)}`,
      );
    }
    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return json.choices[0]?.message?.content ?? "";
  }
}
