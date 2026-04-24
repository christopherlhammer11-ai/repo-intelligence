import { mkdir } from "node:fs/promises";

import { connect, type Table } from "@lancedb/lancedb";

import { getVectorDbDir } from "@/lib/app-paths";
import type { CodeChunk } from "@/lib/chunker";

const DB_DIR = getVectorDbDir();
const TABLE_NAME = "repo_chunks";

export type StoredChunk = CodeChunk & {
  id: string;
  vector: number[];
  distance?: number;
};

type StoredRow = StoredChunk & {
  _distance?: number;
};

export async function upsertChunks(
  filePath: string,
  chunks: CodeChunk[],
  embeddings: number[][],
) {
  if (!chunks.length) {
    return 0;
  }

  const table = await getOrCreateTable(
    chunks.map((chunk, index) => ({
      ...chunk,
      id: `${filePath}:${chunk.chunkIndex}:${Date.now()}:${index}`,
      vector: embeddings[index] ?? [],
    })),
  );

  await table.delete(`filePath = '${escapeSqlString(filePath)}'`);
  await table.add(
    chunks.map((chunk, index) => ({
      ...chunk,
      id: `${filePath}:${chunk.chunkIndex}:${Date.now()}:${index}`,
      vector: embeddings[index] ?? [],
    })),
  );

  return chunks.length;
}

export async function searchChunks(queryEmbedding: number[], query: string, limit = 6) {
  const table = await openTable();

  if (!table) {
    return [];
  }

  const preferredFiles = await findMentionedFiles(table, query);
  const preferredMatches = preferredFiles.length
    ? ((await table
        .search(queryEmbedding)
        .where(buildFilePredicate(preferredFiles))
        .limit(limit)
        .toArray()) as StoredRow[])
    : [];
  const fallbackMatches =
    preferredMatches.length < limit
      ? ((await table
          .search(queryEmbedding)
          .limit(Math.max(limit * 3, limit))
          .toArray()) as StoredRow[])
      : [];

  return dedupeMatches([...preferredMatches, ...fallbackMatches])
    .slice(0, limit)
    .map((match) => ({
      ...match,
      distance: match._distance,
    }));
}

export async function listIndexedFiles(limit = 200) {
  const table = await openTable();

  if (!table) {
    return {
      fileCount: 0,
      chunkCount: 0,
      files: [] as Array<{ fileName: string; filePath: string; chunks: number }>,
    };
  }

  const rows = (await table
    .query()
    .select(["fileName", "filePath", "chunkIndex"])
    .limit(limit * 200)
    .toArray()) as Array<{
    fileName: string;
    filePath: string;
    chunkIndex: number;
  }>;
  const chunkCount = await table.countRows();
  const byFile = new Map<string, { fileName: string; filePath: string; chunks: number }>();

  for (const row of rows) {
    const current = byFile.get(row.filePath);

    if (current) {
      current.chunks += 1;
      continue;
    }

    byFile.set(row.filePath, {
      fileName: row.fileName,
      filePath: row.filePath,
      chunks: 1,
    });
  }

  const files = Array.from(byFile.values())
    .sort((a, b) => a.fileName.localeCompare(b.fileName))
    .slice(0, limit);

  return {
    fileCount: files.length,
    chunkCount,
    files,
  };
}

async function getOrCreateTable(seedRows: StoredChunk[]) {
  await mkdir(DB_DIR, { recursive: true });
  const db = await connect(DB_DIR);
  const tableNames = await db.tableNames();

  if (!tableNames.includes(TABLE_NAME)) {
    return db.createTable(TABLE_NAME, seedRows);
  }

  return db.openTable(TABLE_NAME);
}

async function openTable() {
  await mkdir(DB_DIR, { recursive: true });
  const db = await connect(DB_DIR);
  const tableNames = await db.tableNames();

  if (!tableNames.includes(TABLE_NAME)) {
    return null;
  }

  return db.openTable(TABLE_NAME);
}

async function findMentionedFiles(table: Table, query: string) {
  const normalized = query.toLowerCase();
  const rows = (await table
    .query()
    .select(["fileName"])
    .limit(1000)
    .toArray()) as Array<{ fileName: string }>;
  const fileNames = Array.from(new Set(rows.map((row) => row.fileName)));

  return fileNames.filter((fileName) => normalized.includes(fileName.toLowerCase()));
}

function buildFilePredicate(fileNames: string[]) {
  return fileNames
    .map((fileName) => `fileName = '${escapeSqlString(fileName)}'`)
    .join(" OR ");
}

function dedupeMatches(matches: StoredRow[]) {
  const deduped = new Map<string, StoredRow>();

  for (const match of matches) {
    const key = `${match.filePath}:${match.chunkIndex}`;

    if (!deduped.has(key)) {
      deduped.set(key, match);
    }
  }

  return Array.from(deduped.values());
}

function escapeSqlString(value: string) {
  return value.replaceAll("'", "''");
}
