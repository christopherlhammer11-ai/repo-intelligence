import { embed, embedMany } from "ai";
import { createOllama } from "ollama-ai-provider-v2";

export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/api";
export const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? "llama3.2:latest";
export const EMBEDDING_MODEL =
  process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
export const CHAT_CONTEXT_WINDOW = Number(process.env.OLLAMA_NUM_CTX ?? "4096");

export const ollama = createOllama({
  baseURL: OLLAMA_BASE_URL,
});

export async function embedText(value: string) {
  const { embedding } = await embed({
    model: ollama.textEmbeddingModel(EMBEDDING_MODEL, {
      keepAlive: "20m",
    }),
    value,
  });

  return embedding;
}

export async function embedTexts(values: string[]) {
  if (!values.length) {
    return [];
  }

  const { embeddings } = await embedMany({
    model: ollama.textEmbeddingModel(EMBEDDING_MODEL, {
      keepAlive: "20m",
    }),
    values,
  });

  return embeddings;
}
