import { streamText } from "ai";
import { NextResponse } from "next/server";

import {
  CHAT_CONTEXT_WINDOW,
  CHAT_MODEL,
  embedText,
  ollama,
} from "@/lib/embeddings";
import { searchChunks } from "@/lib/vectorstore";

export const runtime = "nodejs";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = body.messages?.filter(
      (message): message is ChatMessage =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    );

    if (!messages?.length) {
      return NextResponse.json(
        { error: "No valid chat messages were provided." },
        { status: 400 },
      );
    }

    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");

    if (!latestUserMessage) {
      return NextResponse.json(
        { error: "A user question is required." },
        { status: 400 },
      );
    }

    const queryEmbedding = await embedText(latestUserMessage.content);
    const matches = await searchChunks(queryEmbedding, latestUserMessage.content, 6);

    if (!matches.length) {
      return NextResponse.json(
        { error: "No indexed context found yet. Upload some supported code files first." },
        { status: 400 },
      );
    }

    const context = matches
      .map(
        (match) =>
          [
            `File: ${match.fileName}`,
            `Path: ${match.filePath}`,
            `Lines: ${match.startLine}-${match.endLine}`,
            `Chunk: ${match.chunkIndex}`,
            match.content,
          ].join("\n"),
      )
      .join("\n\n---\n\n");
    const sources = matches.map((match) => ({
      fileName: match.fileName,
      filePath: match.filePath,
      chunkIndex: match.chunkIndex,
      startLine: match.startLine,
      endLine: match.endLine,
      title: match.title,
      preview: match.preview,
      content: match.content,
    }));

    const result = streamText({
      model: ollama.chat(CHAT_MODEL, {
        options: {
          num_ctx: CHAT_CONTEXT_WINDOW,
        },
      }),
      system: [
        "You are Repo Intelligence, a repository Q&A assistant.",
        "Answer using the retrieved code context first.",
        "If the context is incomplete, say so plainly.",
        "Cite evidence inline using the format [fileName:start-end].",
        "When useful, mention the chunk title or symbol name in plain English.",
        "",
        "Retrieved code context:",
        context,
      ].join("\n"),
      messages,
    });

    return result.toTextStreamResponse({
      headers: {
        "x-repo-sources": encodeURIComponent(JSON.stringify(sources)),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate a chat response.",
      },
      { status: 500 },
    );
  }
}
