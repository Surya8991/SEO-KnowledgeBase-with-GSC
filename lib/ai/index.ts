import type { ChatProvider, EmbeddingProvider } from "./types";
import { LocalEmbeddingProvider } from "./embed-local";
import { OpenAIEmbeddingProvider } from "./embed-openai";
import { GroqChatProvider } from "./chat-groq";
import { ClaudeChatProvider } from "./chat-claude";
import { OpenAIChatProvider } from "./chat-openai";

let embedder: EmbeddingProvider | null = null;
let chat: ChatProvider | null = null;

export function getEmbedder(): EmbeddingProvider {
  if (embedder) return embedder;
  const which = (process.env.AI_EMBED_PROVIDER || "local").toLowerCase();
  embedder = which === "openai" ? new OpenAIEmbeddingProvider() : new LocalEmbeddingProvider();
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
