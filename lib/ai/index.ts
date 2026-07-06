import type { ChatProvider, EmbeddingProvider } from "./types";
import { LocalEmbeddingProvider } from "./embed-local";
import { OpenAIEmbeddingProvider } from "./embed-openai";
import { GroqChatProvider } from "./chat-groq";
import { ClaudeChatProvider } from "./chat-claude";
import { OpenAIChatProvider } from "./chat-openai";
import { EMBED_DIM } from "@/lib/db/schema";

let embedder: EmbeddingProvider | null = null;
let chat: ChatProvider | null = null;

export function getEmbedder(): EmbeddingProvider {
  if (embedder) return embedder;
  const which = (process.env.AI_EMBED_PROVIDER || "local").toLowerCase();
  const selected: EmbeddingProvider =
    which === "openai" ? new OpenAIEmbeddingProvider() : new LocalEmbeddingProvider();
  // Audit (Session 11): the embedding column is `vector(EMBED_DIM)`. If the
  // selected provider emits a different width (e.g. OpenAI = 1536 vs the
  // default 384), every INSERT silently fails at the DB with a dimension
  // mismatch. Fail fast here with an actionable message instead — switching
  // models means widening the column AND updating EMBED_DIM in lockstep.
  if (selected.dimensions !== EMBED_DIM) {
    throw new Error(
      `Embedding provider "${selected.name}" emits ${selected.dimensions}-dim vectors ` +
        `but the schema column is vector(${EMBED_DIM}). Update EMBED_DIM (lib/db/schema.ts) ` +
        `+ the drizzle migration and re-embed the corpus before switching providers.`,
    );
  }
  embedder = selected;
  return embedder;
}

export function getChat(): ChatProvider {
  if (chat) return chat;
  const which = (process.env.AI_CHAT_PROVIDER || "groq").toLowerCase();
  if (which === "claude") chat = new ClaudeChatProvider();
  else if (which === "openai") chat = new OpenAIChatProvider();
  else chat = new GroqChatProvider();
  return chat;
}

// Allow tests/scripts to reset memoized singletons after env changes.
export function resetAi() {
  embedder = null;
  chat = null;
}

export * from "./types";
