"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  BookText,
  Bot,
  ChevronRight,
  Database,
  FileCode2,
  FolderUp,
  LoaderCircle,
  MessageSquareText,
  Sparkles,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  "What architectural patterns show up in this codebase?",
  "Which files would be risky to change first?",
  "Trace the main data flow from input to UI output.",
];

export default function RepoIntelligenceApp({
  initialIndex,
}: RepoIntelligenceAppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Upload a slice of your codebase and ask repo questions. Answers are grounded in local Ollama embeddings stored in LanceDB.",
    },
  ]);
  const [files, setFiles] = useState<IndexedFile[]>(initialIndex.files);
  const [chunkCount, setChunkCount] = useState(initialIndex.chunkCount);
  const [prompt, setPrompt] = useState("");
  const [uploadState, setUploadState] = useState(
    "Drop files here or upload a repo folder to index it.",
  );
  const [chatState, setChatState] = useState(
    "Ready to answer questions about the indexed files.",
  );
  const [selectedSource, setSelectedSource] = useState<SourceRef | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isChatPending, startChatTransition] = useTransition();
  const [isUploadPending, startUploadTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const folderInput = folderInputRef.current;

    if (!folderInput) {
      return;
    }

    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  function handleUpload(fileList: FileList | null) {
    if (!fileList?.length) {
      return;
    }

    startUploadTransition(async () => {
      try {
        const formData = new FormData();

        for (const file of Array.from(fileList)) {
          formData.append("files", file);
        }

        setUploadState(`Indexing ${fileList.length} file${fileList.length === 1 ? "" : "s"}...`);

        const response = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
        });
        const result = (await response.json()) as
          | {
              message: string;
              indexedFiles?: IndexedFile[];
              skippedFiles?: Array<{ fileName: string; reason: string }>;
              index?: IndexPayload;
            }
          | { error: string };

        if (!response.ok || "error" in result) {
          setUploadState(
            "error" in result ? result.error : "Failed to ingest the uploaded files.",
          );
          return;
        }

        if (result.index) {
          setFiles(result.index.files);
          setChunkCount(result.index.chunkCount);
        }

        const skipped =
          result.skippedFiles?.length
            ? ` Skipped: ${result.skippedFiles
                .map((file) => `${file.fileName} (${file.reason})`)
                .join(", ")}.`
            : "";

        setUploadState(`${result.message}${skipped}`);
      } catch {
        setUploadState("The upload failed before the local app server could respond.");
      }
    });
  }

  function handleChat(nextPrompt?: string) {
    const userPrompt = (nextPrompt ?? prompt).trim();

    if (!userPrompt || isChatPending) {
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: userPrompt }];
    setMessages(nextMessages);
    setPrompt("");
    setChatState("Retrieving relevant chunks and streaming an answer...");

    startChatTransition(async () => {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messages: nextMessages }),
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
                "I couldn’t answer that yet. Make sure Ollama is running and files are indexed.",
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
      } catch {
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content:
              "I couldn’t reach the local app server for chat. Check the dev server and Ollama, then try again.",
          },
        ]);
        setChatState("Chat request failed.");
      }
    });
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(75,85,99,0.22),_transparent_35%),linear-gradient(180deg,_#020617_0%,_#08101f_45%,_#0f172a_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6">
        <section className="w-full lg:max-w-[28rem]">
          <Card className="h-full border-white/10 bg-white/6 shadow-2xl backdrop-blur-xl">
            <CardHeader className="gap-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Badge className="border-cyan-400/30 bg-cyan-400/12 text-cyan-100">
                    Local RAG
                  </Badge>
                  <CardTitle className="mt-4 text-3xl font-semibold tracking-tight">
                    Repo Intelligence
                  </CardTitle>
                  <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">
                    Index code files locally with Ollama embeddings and explore the repo with grounded answers.
                  </p>
                </div>
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-100">
                  <Sparkles className="h-6 w-6" />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <StatCard
                  icon={FileCode2}
                  label="Indexed"
                  value={`${files.length} files`}
                />
                <StatCard
                  icon={Database}
                  label="Chunks"
                  value={String(chunkCount)}
                />
                <StatCard icon={Bot} label="Model" value="llama3.2" />
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              <div
                className={`rounded-[1.75rem] border border-dashed p-5 transition ${
                  isDragging
                    ? "border-cyan-300/80 bg-cyan-400/10"
                    : "border-white/15 bg-white/5"
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
                <div className="flex items-center gap-3 text-cyan-100">
                  <Upload className="h-5 w-5" />
                  <p className="text-sm font-medium">Upload code files or a whole folder</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{uploadState}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.24em] text-slate-500">
                  Supports .ts .tsx .js .jsx .py .go .rs .md
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    className="bg-cyan-300 text-slate-950 hover:bg-cyan-200"
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
                    className="border-white/10 bg-white/8 text-white hover:bg-white/12"
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

              <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Index status
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-100">
                      {`${files.length} file${files.length === 1 ? "" : "s"} · ${chunkCount} chunks`}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className="border-emerald-400/25 bg-emerald-400/12 text-emerald-100"
                  >
                    LanceDB
                  </Badge>
                </div>

                <Separator className="my-4 bg-white/10" />

                <ScrollArea className="h-[25rem] pr-4">
                  <div className="space-y-3">
                    {files.length ? (
                      files.map((file) => (
                        <button
                          key={file.filePath}
                          className="w-full rounded-2xl border border-white/8 bg-white/5 p-4 text-left transition hover:border-cyan-300/40 hover:bg-cyan-400/8"
                          onClick={() =>
                            setSelectedSource({
                              fileName: file.fileName,
                              filePath: file.filePath,
                              chunkIndex: 0,
                              startLine: 1,
                              endLine: 1,
                              title: file.fileName,
                              preview: "This file is indexed. Ask a question to retrieve specific chunks.",
                            })
                          }
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white">
                                {file.fileName}
                              </p>
                              <p className="mt-1 truncate text-xs text-slate-400">
                                {file.filePath}
                              </p>
                            </div>
                            <Badge
                              variant="secondary"
                              className="border-white/10 bg-white/10 text-slate-100"
                            >
                              {file.chunks}
                            </Badge>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                        No files indexed yet.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="flex min-h-[70vh] flex-1 flex-col gap-6">
          <Card className="flex min-h-0 flex-1 border-white/10 bg-white/6 shadow-2xl backdrop-blur-xl">
            <CardHeader className="gap-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <Badge className="border-fuchsia-400/25 bg-fuchsia-400/12 text-fuchsia-100">
                    Codebase Q&A
                  </Badge>
                  <CardTitle className="mt-4 flex items-center gap-3 text-3xl tracking-tight">
                    <MessageSquareText className="h-7 w-7" />
                    Ask the repo
                  </CardTitle>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    The answer stream uses retrieved code chunks and cites the source lines it used.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {starterPrompts.map((idea) => (
                    <button
                      key={idea}
                      className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-left text-xs font-medium text-slate-200 transition hover:border-cyan-300/40 hover:bg-cyan-400/10"
                      onClick={() => handleChat(idea)}
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
              <ScrollArea className="min-h-0 flex-1 rounded-[2rem] border border-white/10 bg-slate-950/45 p-4 md:p-6">
                <div className="space-y-4">
                  {messages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`max-w-4xl rounded-[1.75rem] px-5 py-4 ${
                        message.role === "user"
                          ? "ml-auto bg-cyan-300 text-slate-950"
                          : "border border-white/10 bg-white/8 text-white"
                      }`}
                    >
                      <p className="mb-2 text-[11px] uppercase tracking-[0.24em] opacity-65">
                        {message.role === "user" ? "User" : "Assistant"}
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-7">
                        {message.content || "Streaming answer..."}
                      </p>
                      {message.role === "assistant" && message.sources?.length ? (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                          {message.sources.map((source) => (
                            <button
                              key={`${source.filePath}-${source.chunkIndex}-${source.startLine}`}
                              className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs text-slate-100 transition hover:border-fuchsia-300/40 hover:bg-fuchsia-400/12"
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

              <div className="rounded-[2rem] border border-white/10 bg-slate-950/45 p-3">
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask about architecture, ownership, data flow, risky refactors, entry points, or code smells."
                  className="min-h-32 border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
                />
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    {chatState}
                  </p>
                  <Button
                    className="bg-fuchsia-300 text-slate-950 hover:bg-fuchsia-200"
                    onClick={() => handleChat()}
                    disabled={isChatPending || !prompt.trim()}
                  >
                    {isChatPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Ask question
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/6 shadow-2xl backdrop-blur-xl">
            <CardHeader>
              <Badge className="border-amber-300/25 bg-amber-300/12 text-amber-100">
                Evidence
              </Badge>
              <CardTitle className="mt-4 flex items-center gap-3 text-2xl tracking-tight">
                <BookText className="h-6 w-6" />
                Source inspector
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedSource ? (
                <div className="grid gap-4 xl:grid-cols-[18rem,1fr]">
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Selected chunk
                    </p>
                    <p className="mt-2 text-lg font-semibold text-white">
                      {selectedSource.fileName}
                    </p>
                    <p className="mt-2 text-sm text-slate-400">
                      {selectedSource.title}
                    </p>
                    <p className="mt-3 text-sm text-slate-300">
                      Lines {selectedSource.startLine}-{selectedSource.endLine}
                    </p>
                    <p className="mt-3 break-all text-sm text-slate-400">
                      {selectedSource.filePath}
                    </p>
                    <Separator className="my-4 bg-white/10" />
                    <p className="text-sm leading-6 text-slate-300">
                      {selectedSource.preview}
                    </p>
                  </div>

                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/55 p-4 font-mono text-xs leading-6 text-slate-100">
                    <pre className="whitespace-pre-wrap">{selectedSource.preview}</pre>
                  </div>
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-slate-950/35 p-4 text-sm text-slate-400">
                  Ask a question and click a citation chip to inspect the retrieved source chunk.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileCode2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/8 p-2 text-cyan-100">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
          <p className="mt-1 text-sm font-semibold text-white">{value}</p>
        </div>
      </div>
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
