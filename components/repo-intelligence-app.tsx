"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  Braces,
  Database,
  FileCode2,
  FolderUp,
  LoaderCircle,
  MessageSquareText,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

type IndexedFile = {
  fileName: string;
  filePath: string;
  chunks: number;
};

type SourceRef = {
  fileName: string;
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  title: string;
  preview: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: SourceRef[];
};

type IndexPayload = {
  fileCount: number;
  chunkCount: number;
  files: IndexedFile[];
};

type RepoIntelligenceAppProps = {
  initialIndex: IndexPayload;
};

const starterPrompts = [
  "Map the main architecture in this codebase.",
  "What files are the riskiest to change first?",
  "Trace the data flow for the primary user action.",
];

const CHAT_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 45_000;

export default function RepoIntelligenceApp({
  initialIndex,
}: RepoIntelligenceAppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Drop in a repo slice and I’ll answer from indexed code, not vibes. Start with a folder upload, then ask about ownership, architecture, flows, or risky refactors.",
    },
  ]);
  const [files, setFiles] = useState<IndexedFile[]>(initialIndex.files);
  const [chunkCount, setChunkCount] = useState(initialIndex.chunkCount);
  const [prompt, setPrompt] = useState("");
  const [uploadState, setUploadState] = useState(
    "Upload files or a repo folder to build the local index.",
  );
  const [chatState, setChatState] = useState(
    initialIndex.fileCount
      ? "Ready to answer questions about the indexed files."
      : "No code indexed yet. Upload a folder to get started.",
  );
  const [selectedSource, setSelectedSource] = useState<SourceRef | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isChatPending, startChatTransition] = useTransition();
  const [isUploadPending, startUploadTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const fileCountLabel = `${files.length} file${files.length === 1 ? "" : "s"}`;
  const hasIndex = files.length > 0;
  const indexedFiles = useMemo(
    () => [...files].sort((a, b) => b.chunks - a.chunks || a.fileName.localeCompare(b.fileName)),
    [files],
  );

  useEffect(() => {
    const folderInput = folderInputRef.current;

    if (!folderInput) {
      return;
    }

    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  function handleUpload(fileList: FileList | null) {
    if (!fileList?.length || isUploadPending) {
      return;
    }

    startUploadTransition(async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

      try {
        const formData = new FormData();

        for (const file of Array.from(fileList)) {
          formData.append("files", file);
        }

        setUploadState(`Indexing ${fileList.length} item${fileList.length === 1 ? "" : "s"}...`);

        const response = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        const result = (await response.json()) as
          | {
              message: string;
              skippedFiles?: Array<{ fileName: string; reason: string }>;
              index?: IndexPayload;
            }
          | { error: string };

        if (!response.ok || "error" in result) {
          setUploadState(
            "error" in result ? result.error : "The local indexer could not process those files.",
          );
          return;
        }

        if (result.index) {
          setFiles(result.index.files);
          setChunkCount(result.index.chunkCount);
          setChatState("Index updated. Ask about architecture, ownership, flows, or refactors.");
        }

        const skipped =
          result.skippedFiles?.length
            ? ` Skipped ${result.skippedFiles.length}: ${result.skippedFiles
                .slice(0, 3)
                .map((file) => `${file.fileName} (${file.reason})`)
                .join(", ")}${result.skippedFiles.length > 3 ? ", ..." : ""}.`
            : "";

        setUploadState(`${result.message}${skipped}`);
      } catch (error) {
        setUploadState(
          error instanceof DOMException && error.name === "AbortError"
            ? "Upload timed out. Try a smaller folder first, then add more files."
            : "The upload failed before the local app server could respond.",
        );
      } finally {
        window.clearTimeout(timeout);
      }
    });
  }

  function handleChat(nextPrompt?: string) {
    const userPrompt = (nextPrompt ?? prompt).trim();

    if (!userPrompt || isChatPending) {
      return;
    }

    if (!hasIndex) {
      setChatState("Upload code first. There’s no local index to retrieve from yet.");
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: userPrompt }];
    setMessages(nextMessages);
    setPrompt("");
    setChatState("Searching the local index and asking Ollama for a grounded answer...");

    startChatTransition(async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messages: nextMessages }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const result = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;

          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              content:
                result?.error ??
                "I couldn’t answer that yet. Check Ollama, then try again.",
            },
          ]);
          setChatState("Chat request failed.");
          return;
        }

        const sources = parseSourcesHeader(response.headers.get("x-repo-sources"));
        const assistantIndex = nextMessages.length;
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: "",
            sources,
          },
        ]);
        setSelectedSource(sources[0] ?? null);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          fullText += decoder.decode(value, { stream: true });
          setMessages((current) =>
            current.map((message, index) =>
              index === assistantIndex ? { ...message, content: fullText } : message,
            ),
          );
        }

        setChatState("Answer complete.");
      } catch (error) {
        const content =
          error instanceof DOMException && error.name === "AbortError"
            ? "This is taking too long. Ollama is probably cold-starting or overloaded. Try a shorter question, a smaller model, or ask again in a moment."
            : "I couldn’t reach the local app server for chat. Check the desktop app and Ollama, then try again.";

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content,
          },
        ]);
        setChatState("Chat request timed out.");
      } finally {
        window.clearTimeout(timeout);
      }
    });
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#08111f_0%,_#0b1322_45%,_#070b13_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-4 md:px-6">
        <header className="mb-4 rounded-[2.25rem] border border-white/8 bg-[linear-gradient(135deg,rgba(18,30,48,0.96),rgba(8,14,24,0.92))] px-5 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                  Desktop
                </Badge>
                <Badge className="border-amber-300/20 bg-amber-300/10 text-amber-100">
                  Local-first
                </Badge>
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                Repo Intelligence
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Index a codebase locally, search real chunks, and ask grounded questions without
                sending the repo to the cloud.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <StatTile icon={FileCode2} label="Indexed files" value={fileCountLabel} />
              <StatTile icon={Database} label="Stored chunks" value={String(chunkCount)} />
              <StatTile icon={Bot} label="Chat model" value="llama3.2" />
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
          <section className="min-h-0">
            <Card className="h-full gap-0 rounded-[1.75rem] border-white/8 bg-[linear-gradient(180deg,rgba(13,21,34,0.96),rgba(8,13,22,0.92))] py-0 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
              <CardHeader className="gap-5 border-b border-white/8 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Badge className="border-white/10 bg-white/6 text-slate-200">
                      Workspace
                    </Badge>
                    <CardTitle className="mt-3 text-xl font-semibold text-white">
                      Local index
                    </CardTitle>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Bring in a folder, then inspect the indexed file list and ask from there.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3 text-cyan-100">
                    <Sparkles className="h-5 w-5" />
                  </div>
                </div>

                <div
                  className={`rounded-[1.9rem] border border-dashed p-4 transition ${
                    isDragging
                      ? "border-cyan-300/60 bg-cyan-400/10"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();

                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      return;
                    }

                    setIsDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    handleUpload(event.dataTransfer.files);
                  }}
                >
                  <div className="flex items-center gap-3 text-slate-100">
                    <Upload className="h-4 w-4 text-cyan-200" />
                    <p className="text-sm font-medium">Upload code files or a whole repo folder</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{uploadState}</p>
                  <p className="mt-3 text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    ts tsx js jsx py go rs md
                  </p>

                  <div className="mt-4 grid gap-2">
                    <Button
                      className="h-10 justify-start rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadPending}
                    >
                      {isUploadPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Upload files
                    </Button>
                    <Button
                      variant="secondary"
                      className="h-10 justify-start rounded-xl border-white/10 bg-white/7 text-white hover:bg-white/12"
                      onClick={() => folderInputRef.current?.click()}
                      disabled={isUploadPending}
                    >
                      <FolderUp className="h-4 w-4" />
                      Upload folder
                    </Button>
                  </div>

                  <input
                    ref={fileInputRef}
                    className="hidden"
                    type="file"
                    multiple
                    accept=".ts,.tsx,.js,.jsx,.py,.go,.rs,.md"
                    onChange={(event) => {
                      handleUpload(event.target.files);
                      event.target.value = "";
                    }}
                  />
                  <input
                    ref={folderInputRef}
                    className="hidden"
                    type="file"
                    multiple
                    onChange={(event) => {
                      handleUpload(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </div>

                <div className="rounded-[1.9rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    Status
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-100">{fileCountLabel}</p>
                      <p className="mt-1 text-sm text-slate-400">{chunkCount} stored chunks</p>
                    </div>
                    <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-100">
                      LanceDB
                    </Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="min-h-0 flex-1 px-0">
                <ScrollArea className="h-[calc(100vh-24rem)] px-4 py-4 xl:h-[calc(100vh-17rem)]">
                  <div className="space-y-2 px-1">
                    {indexedFiles.length ? (
                      indexedFiles.map((file) => (
                        <button
                          key={file.filePath}
                          className="w-full rounded-[1.55rem] border border-white/8 bg-white/[0.03] p-3 text-left transition hover:border-cyan-300/30 hover:bg-cyan-400/8"
                          onClick={() =>
                            setSelectedSource({
                              fileName: file.fileName,
                              filePath: file.filePath,
                              chunkIndex: 0,
                              startLine: 1,
                              endLine: 1,
                              title: file.fileName,
                              preview:
                                "This file is indexed. Ask a question to inspect the specific chunk retrieved for the answer.",
                            })
                          }
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-100">
                                {file.fileName}
                              </p>
                              <p className="mt-1 truncate text-xs text-slate-500">
                                {file.filePath}
                              </p>
                            </div>
                            <Badge className="border-white/10 bg-white/8 text-slate-200">
                              {file.chunks}
                            </Badge>
                          </div>
                        </button>
                      ))
                    ) : (
                      <EmptyRail />
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </section>

          <section className="min-h-0">
            <Card className="h-full gap-0 rounded-[1.75rem] border-white/8 bg-[linear-gradient(180deg,rgba(13,21,34,0.96),rgba(8,13,22,0.92))] py-0 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
              <CardHeader className="gap-4 border-b border-white/8 px-5 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <Badge className="border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-100">
                      Codebase Q&A
                    </Badge>
                    <CardTitle className="mt-3 flex items-center gap-3 text-2xl font-semibold text-white">
                      <MessageSquareText className="h-6 w-6 text-fuchsia-200" />
                      Ask the repo
                    </CardTitle>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                      Answers are grounded in retrieved chunks and cite the files they came from.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {starterPrompts.map((idea) => (
                      <button
                        key={idea}
                        className="rounded-full border border-white/10 bg-white/6 px-3 py-2 text-left text-xs font-medium text-slate-200 transition hover:border-fuchsia-300/30 hover:bg-fuchsia-400/8 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => handleChat(idea)}
                        disabled={!hasIndex || isChatPending}
                      >
                        {idea}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-5">
                <ScrollArea className="min-h-0 flex-1 rounded-[2rem] border border-white/8 bg-[#08101a] p-4">
                  <div className="space-y-4">
                    {messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`max-w-4xl rounded-[1.9rem] px-5 py-4 ${
                          message.role === "user"
                            ? "ml-auto bg-cyan-300 text-slate-950"
                            : "border border-white/8 bg-white/[0.04] text-slate-100"
                        }`}
                      >
                        <p className="mb-2 text-[11px] uppercase tracking-[0.22em] opacity-65">
                          {message.role === "user" ? "You" : "Assistant"}
                        </p>
                        <p className="whitespace-pre-wrap text-sm leading-7">
                          {message.content || "Streaming answer..."}
                        </p>

                        {message.role === "assistant" && message.sources?.length ? (
                          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/8 pt-4">
                            {message.sources.map((source) => (
                              <button
                                key={`${source.filePath}-${source.chunkIndex}-${source.startLine}`}
                                className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs text-slate-100 transition hover:border-fuchsia-300/30 hover:bg-fuchsia-400/10"
                                onClick={() => setSelectedSource(source)}
                              >
                                {source.fileName}:{source.startLine}-{source.endLine}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="rounded-[2rem] border border-white/8 bg-[#09121d] p-3">
                  <Textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Ask about architecture, ownership, data flow, risky refactors, entry points, or code smells."
                    className="min-h-28 border-0 bg-transparent px-2 py-3 text-base text-slate-100 shadow-none focus-visible:ring-0"
                  />
                  <div className="mt-3 flex flex-col gap-3 border-t border-white/8 px-2 pt-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2 text-xs tracking-[0.16em] text-slate-500 uppercase">
                      {chatState.includes("timed out") || chatState.includes("failed") ? (
                        <AlertCircle className="h-3.5 w-3.5 text-amber-300" />
                      ) : (
                        <Search className="h-3.5 w-3.5 text-slate-500" />
                      )}
                      <span>{chatState}</span>
                    </div>

                    <Button
                      className="h-10 rounded-xl bg-fuchsia-300 px-4 text-slate-950 hover:bg-fuchsia-200"
                      onClick={() => handleChat()}
                      disabled={isChatPending || !prompt.trim()}
                    >
                      {isChatPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4" />
                      )}
                      Ask question
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="min-h-0">
            <Card className="h-full gap-0 rounded-[1.75rem] border-white/8 bg-[linear-gradient(180deg,rgba(13,21,34,0.96),rgba(8,13,22,0.92))] py-0 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
              <CardHeader className="gap-4 border-b border-white/8 px-5 py-5">
                <Badge className="border-amber-300/20 bg-amber-300/10 text-amber-100">
                  Inspector
                </Badge>
                <CardTitle className="flex items-center gap-3 text-2xl font-semibold text-white">
                  <Braces className="h-6 w-6 text-amber-200" />
                  Retrieved chunk
                </CardTitle>
                <p className="text-sm leading-6 text-slate-400">
                  Click a cited source after a response to inspect the chunk that informed it.
                </p>
              </CardHeader>

              <CardContent className="min-h-0 flex-1 px-5 py-5">
                {selectedSource ? (
                  <div className="flex h-full min-h-0 flex-col gap-4">
                    <div className="rounded-[1.9rem] border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                        Selected source
                      </p>
                      <p className="mt-3 text-lg font-semibold text-slate-100">
                        {selectedSource.fileName}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">{selectedSource.title}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Badge className="border-white/10 bg-white/7 text-slate-200">
                          chunk {selectedSource.chunkIndex}
                        </Badge>
                        <Badge className="border-white/10 bg-white/7 text-slate-200">
                          lines {selectedSource.startLine}-{selectedSource.endLine}
                        </Badge>
                      </div>
                      <p className="mt-4 break-all text-sm leading-6 text-slate-500">
                        {selectedSource.filePath}
                      </p>
                    </div>

                    <div className="min-h-0 flex-1 rounded-[1.9rem] border border-white/8 bg-[#08101a] p-4">
                      <ScrollArea className="h-full pr-3">
                        <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-slate-200">
                          {selectedSource.preview}
                        </pre>
                      </ScrollArea>
                    </div>
                  </div>
                ) : (
                  <EmptyInspector />
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </main>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileCode2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.04] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-white/8 bg-white/6 p-2 text-cyan-100">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-1 text-sm font-semibold text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

function EmptyRail() {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.03] p-4">
      <p className="text-sm font-medium text-slate-200">Nothing indexed yet</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        Start with a smaller folder or a couple of key files if Ollama feels slow on first pass.
      </p>
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="flex h-full flex-col items-start justify-center rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.03] p-6">
      <div className="rounded-2xl border border-white/8 bg-white/6 p-3 text-amber-100">
        <Braces className="h-5 w-5" />
      </div>
      <p className="mt-4 text-base font-semibold text-slate-100">No source selected</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        After a response comes back, click one of its source chips to inspect the retrieved
        evidence here.
      </p>
    </div>
  );
}

function parseSourcesHeader(raw: string | null): SourceRef[] {
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(decodeURIComponent(raw)) as SourceRef[];
  } catch {
    return [];
  }
}
