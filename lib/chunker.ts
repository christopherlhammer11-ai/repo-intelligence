import path from "node:path";

export type CodeChunk = {
  chunkIndex: number;
  filePath: string;
  fileName: string;
  language: string;
  title: string;
  startLine: number;
  endLine: number;
  content: string;
  preview: string;
};

const MAX_CHARS = 2200;
const MIN_CHARS = 350;

export function chunkCode(filePath: string, source: string): CodeChunk[] {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\0/g, "").trim();

  if (!normalized) {
    return [];
  }

  const fileName = path.basename(filePath);
  const language = detectLanguage(fileName);
  const lines = normalized.split("\n");
  const units = buildLogicalUnits(lines, language, fileName);
  const merged = mergeUnits(units, fileName);

  return merged.map((unit, index) => ({
    chunkIndex: index,
    filePath,
    fileName,
    language,
    title: unit.title,
    startLine: unit.startLine,
    endLine: unit.endLine,
    content: unit.content,
    preview: unit.content
      .replace(/\s+/g, " ")
      .slice(0, 180)
      .trim(),
  }));
}

function detectLanguage(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();

  switch (extension) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
      return "javascript";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".md":
      return "markdown";
    default:
      return "text";
  }
}

type LogicalUnit = {
  title: string;
  startLine: number;
  endLine: number;
  content: string;
};

function buildLogicalUnits(
  lines: string[],
  language: string,
  fileName: string,
): LogicalUnit[] {
  const boundaries = new Set<number>([0]);
  const matchers = getBoundaryMatchers(language);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (matchers.some((matcher) => matcher.test(line))) {
      boundaries.add(index);
    }
  }

  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const units: LogicalUnit[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const start = sorted[i];
    const end = (sorted[i + 1] ?? lines.length) - 1;
    const slice = lines.slice(start, end + 1).join("\n").trim();

    if (!slice) {
      continue;
    }

    if (slice.length > MAX_CHARS) {
      units.push(...splitOversizedUnit(start, lines.slice(start, end + 1), fileName));
      continue;
    }

    units.push({
      title: deriveTitle(lines[start], fileName),
      startLine: start + 1,
      endLine: end + 1,
      content: slice,
    });
  }

  return units.length
    ? units
    : [
        {
          title: fileName,
          startLine: 1,
          endLine: lines.length,
          content: lines.join("\n"),
        },
      ];
}

function getBoundaryMatchers(language: string) {
  switch (language) {
    case "typescript":
    case "javascript":
      return [
        /^\s*export\s+(async\s+)?function\s+\w+/,
        /^\s*(async\s+)?function\s+\w+/,
        /^\s*export\s+default\s+function\s+\w+/,
        /^\s*export\s+(class|interface|type|enum)\s+\w+/,
        /^\s*(class|interface|type|enum)\s+\w+/,
        /^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/,
        /^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?[\w<>\[\],:\s]+\s*=>/,
      ];
    case "python":
      return [/^\s*(async\s+def|def|class)\s+\w+/];
    case "go":
      return [/^\s*func\s+\(/, /^\s*func\s+\w+/, /^\s*type\s+\w+\s+(struct|interface)/];
    case "rust":
      return [
        /^\s*(pub\s+)?fn\s+\w+/,
        /^\s*(pub\s+)?(struct|enum|trait)\s+\w+/,
        /^\s*impl(\s*<.*>)?\s+\w+/,
      ];
    case "markdown":
      return [/^#{1,6}\s+/];
    default:
      return [/^\S/];
  }
}

function splitOversizedUnit(
  baseIndex: number,
  lines: string[],
  fileName: string,
): LogicalUnit[] {
  const units: LogicalUnit[] = [];
  let start = 0;

  while (start < lines.length) {
    let end = start;
    let chunk = lines[start] ?? "";

    while (end + 1 < lines.length) {
      const next = `${chunk}\n${lines[end + 1]}`;

      if (next.length > MAX_CHARS) {
        break;
      }

      end += 1;
      chunk = next;

      if (chunk.length >= MIN_CHARS && lines[end].trim() === "") {
        break;
      }
    }

    const content = lines.slice(start, end + 1).join("\n").trim();

    if (content) {
      units.push({
        title:
          start === 0
            ? deriveTitle(lines[start], fileName)
            : `${deriveTitle(lines[start], fileName)} (part ${units.length + 1})`,
        startLine: baseIndex + start + 1,
        endLine: baseIndex + end + 1,
        content,
      });
    }

    start = end + 1;
  }

  return units;
}

function mergeUnits(units: LogicalUnit[], fileName: string) {
  const merged: LogicalUnit[] = [];

  for (const unit of units) {
    const previous = merged.at(-1);

    if (
      previous &&
      previous.content.length < MIN_CHARS &&
      `${previous.content}\n\n${unit.content}`.length <= MAX_CHARS
    ) {
      previous.content = `${previous.content}\n\n${unit.content}`;
      previous.endLine = unit.endLine;
      previous.title = previous.title === fileName ? unit.title : previous.title;
      continue;
    }

    merged.push({ ...unit });
  }

  return merged;
}

function deriveTitle(firstLine: string | undefined, fileName: string) {
  const cleaned = (firstLine ?? "").trim().replace(/[({].*$/, "");
  return cleaned || fileName;
}
