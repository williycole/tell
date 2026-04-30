#!/usr/bin/env ts-node
/**
 * tell-parse — unified diff → structured JSON skeleton
 *
 * Usage:
 *   git diff origin/<base>...HEAD | ts-node tell-parse.ts
 *   git diff origin/<base>...HEAD -- path/to/file | ts-node tell-parse.ts
 *
 * Outputs a JSON array of DiffFile objects to stdout.
 * Line numbers (oldNum / newNum) are computed deterministically from the
 * @@ header — the model never touches them.
 */

import { createInterface } from 'readline';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  oldNum: number | null;
  newNum: number | null;
  text: string;
}

export interface Hunk {
  /** e.g. "@@ -18,6 +22,9 @@" */
  header: string;
  hunkStartOld: number;
  hunkStartNew: number;
  hunkLinesOld: number;
  hunkLinesNew: number;
  lines: DiffLine[];
}

export interface DiffFile {
  /** Current file path (new path for renames) */
  name: string;
  /** Previous path — non-null only for renames */
  oldName: string | null;
  /** A = added, D = deleted, M = modified, R = renamed */
  status: 'A' | 'D' | 'M' | 'R';
  additions: number;
  deletions: number;
  hunks: Hunk[];
}

// ── Hunk header parser ─────────────────────────────────────────────────────

/** Parse "@@ -X[,Y] +A[,B] @@[ optional context]" */
export function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} | null {
  const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!m) return null;
  return {
    oldStart: parseInt(m[1], 10),
    // If Y is omitted the hunk is exactly 1 line (except when X=0 which means 0 lines)
    oldLines: m[2] !== undefined ? parseInt(m[2], 10) : 1,
    newStart: parseInt(m[3], 10),
    newLines: m[4] !== undefined ? parseInt(m[4], 10) : 1,
  };
}

// ── Core parser ────────────────────────────────────────────────────────────

export function parseDiff(input: string): DiffFile[] {
  const lines = input.split('\n');
  const files: DiffFile[] = [];

  let current: DiffFile | null = null;
  let currentHunk: Hunk | null = null;
  let oldCursor = 0;
  let newCursor = 0;

  const flush = () => {
    if (!current) return;
    // Deleted files: name was never set from +++ (it was /dev/null), fall back to oldName
    if (!current.name && current.oldName) current.name = current.oldName;
    files.push(current);
  };

  for (const line of lines) {
    // ── New file in diff ──────────────────────────────────────────────────
    if (line.startsWith('diff --git ')) {
      flush();
      current = { name: '', oldName: null, status: 'M', additions: 0, deletions: 0, hunks: [] };
      currentHunk = null;
      continue;
    }

    if (!current) continue;

    // ── Mode / rename metadata ────────────────────────────────────────────
    if (line.startsWith('new file mode'))      { current.status = 'A'; continue; }
    if (line.startsWith('deleted file mode'))  { current.status = 'D'; continue; }
    if (line.startsWith('rename from '))       { current.oldName = line.slice('rename from '.length); continue; }
    if (line.startsWith('rename to '))         { current.status = 'R'; continue; }

    // Skip non-content metadata lines
    if (
      line.startsWith('index ')            ||
      line.startsWith('similarity index ') ||
      line.startsWith('old mode ')         ||
      line.startsWith('new mode ')
    ) continue;

    // ── Old file path (--- line) ──────────────────────────────────────────
    if (line.startsWith('--- ')) {
      const path = line.slice(4);
      if (path === '/dev/null') {
        current.status = 'A';
      } else {
        current.oldName = path.replace(/^a\//, '');
      }
      continue;
    }

    // ── New file path (+++ line) ──────────────────────────────────────────
    if (line.startsWith('+++ ')) {
      const path = line.slice(4);
      if (path === '/dev/null') {
        current.status = 'D';
        // name will be filled from oldName in flush()
      } else {
        current.name = path.replace(/^b\//, '');
      }
      continue;
    }

    // ── Hunk header ───────────────────────────────────────────────────────
    if (line.startsWith('@@ ')) {
      const parsed = parseHunkHeader(line);
      if (!parsed) continue;

      oldCursor = parsed.oldStart;
      newCursor = parsed.newStart;

      // Keep only "@@ -X,Y +A,B @@" — strip any trailing context text for the
      // stored header (the viewer shows it; trailing text is informational only)
      const headerMatch = line.match(/^(@@ [^@]+ @@)/);
      const header = headerMatch ? headerMatch[1].trimEnd() : line;

      currentHunk = {
        header,
        hunkStartOld: parsed.oldStart,
        hunkStartNew: parsed.newStart,
        hunkLinesOld: parsed.oldLines,
        hunkLinesNew: parsed.newLines,
        lines: [],
      };
      current.hunks.push(currentHunk);
      continue;
    }

    // ── Hunk content lines ────────────────────────────────────────────────
    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', oldNum: null, newNum: newCursor++, text: line.slice(1) });
      current.additions++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', oldNum: oldCursor++, newNum: null, text: line.slice(1) });
      current.deletions++;
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({ type: 'ctx', oldNum: oldCursor++, newNum: newCursor++, text: line.slice(1) });
    }
    // '\' = "No newline at end of file" — intentionally skipped
  }

  flush();
  return files;
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (require.main === module) {
  const rl = createInterface({ input: process.stdin });
  const chunks: string[] = [];
  rl.on('line', (line) => chunks.push(line));
  rl.on('close', () => {
    const result = parseDiff(chunks.join('\n'));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  });
}
