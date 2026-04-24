import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getUploadsDir } from "@/lib/app-paths";
import { chunkCode } from "@/lib/chunker";
import { embedTexts } from "@/lib/embeddings";
import { listIndexedFiles, upsertChunks } from "@/lib/vectorstore";

export const runtime = "nodejs";

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".md",
]);

export async function GET() {
  const index = await listIndexedFiles();
  return NextResponse.json(index);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (!files.length) {
      return NextResponse.json(
        { error: "No files were uploaded." },
        { status: 400 },
      );
    }

    const indexedFiles: Array<{
      fileName: string;
      filePath: string;
      chunks: number;
    }> = [];
    const skippedFiles: Array<{ fileName: string; reason: string }> = [];

    for (const file of files) {
      const filePath = getFilePath(file);
      const extension = path.extname(filePath).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        skippedFiles.push({
          fileName: file.name,
          reason: "unsupported file type",
        });
        continue;
      }

      const content = await file.text();
      await persistUploadedFile(filePath, content);
      const chunks = chunkCode(filePath, content);

      if (!chunks.length) {
        skippedFiles.push({
          fileName: file.name,
          reason: "empty file after normalization",
        });
        continue;
      }

      const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
      const inserted = await upsertChunks(filePath, chunks, embeddings);

      indexedFiles.push({
        fileName: path.basename(filePath),
        filePath,
        chunks: inserted,
      });
    }

    const index = await listIndexedFiles();

    return NextResponse.json({
      message: `Indexed ${indexedFiles.length} file${indexedFiles.length === 1 ? "" : "s"} into LanceDB.`,
      indexedFiles,
      skippedFiles,
      index,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Ingestion failed.",
      },
      { status: 500 },
    );
  }
}

function getFilePath(file: File) {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return withRelativePath.webkitRelativePath?.trim() || file.name;
}

async function persistUploadedFile(filePath: string, content: string) {
  const uploadsDir = getUploadsDir();
  const destination = path.join(uploadsDir, sanitizeRelativePath(filePath));

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

function sanitizeRelativePath(filePath: string) {
  return filePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}
