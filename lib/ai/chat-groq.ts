import Groq from "groq-sdk";
import { BaseChatProvider } from "./chat-base";

export class GroqChatProvider extends BaseChatProvider {
  readonly name = "groq";
  private client: Groq;
  private model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  constructor() {
    super();
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY is not set.");
    this.client = new Groq({ apiKey: key });
  }

  protected async complete(system: string, user: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return res.choices[0]?.message?.content ?? "";
  }
}
