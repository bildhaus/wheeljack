export interface ProjectFileMentionRange {
  start: number;
  end: number;
  query: string;
}

export function activeProjectFileMention(value: string, caret: number): ProjectFileMentionRange | undefined {
  if (caret < 0 || caret > value.length) return undefined;
  let start = caret;
  while (start > 0 && !/\s/.test(value[start - 1])) start -= 1;
  if (value[start] !== "@") return undefined;
  let end = caret;
  while (end < value.length && !/\s/.test(value[end])) end += 1;
  return { start, end, query: value.slice(start + 1, caret) };
}

export function filterProjectFiles(files: string[], query: string, limit = 50): string[] {
  const normalized = query.trim().toLowerCase().replaceAll("\\", "/");
  if (!normalized) return files.slice(0, limit);
  return files
    .map((path) => ({ path, score: projectFileScore(path, normalized) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((item) => item.path);
}

function projectFileScore(path: string, query: string): number {
  const normalized = path.toLowerCase().replaceAll("\\", "/");
  const segments = normalized.split("/");
  const name = segments.at(-1) ?? normalized;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (segments.some((segment) => segment.startsWith(query))) return 2;
  if (name.includes(query)) return 3;
  if (normalized.includes(query)) return 4;

  let queryIndex = 0;
  let gaps = 0;
  for (let index = 0; index < normalized.length && queryIndex < query.length; index += 1) {
    if (normalized[index] === query[queryIndex]) queryIndex += 1;
    else if (queryIndex > 0) gaps += 1;
  }
  return queryIndex === query.length ? 5 + gaps / Math.max(1, normalized.length) : Number.POSITIVE_INFINITY;
}

export function insertProjectFileMention(value: string, range: ProjectFileMentionRange, path: string): { value: string; caret: number } {
  const mention = /\s/.test(path) ? `@"${path.replaceAll('"', '\\"')}"` : `@${path}`;
  const trailingSpace = range.end >= value.length || !/\s/.test(value[range.end]) ? " " : "";
  const inserted = `${mention}${trailingSpace}`;
  return {
    value: `${value.slice(0, range.start)}${inserted}${value.slice(range.end)}`,
    caret: range.start + inserted.length,
  };
}

export function projectFileParts(path: string): { name: string; directory: string } {
  const separator = path.lastIndexOf("/");
  return separator < 0
    ? { name: path, directory: "Project root" }
    : { name: path.slice(separator + 1), directory: path.slice(0, separator) };
}
