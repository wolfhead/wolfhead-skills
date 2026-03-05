/**
 * Search for Claude Code session files by project, date, and recency.
 *
 * Searches ~/.claude/projects/ for main session JSONL files.
 * Filters by project directory, date range, turn count, and recency.
 */

import fs from "fs";
import path from "path";
import os from "os";

export const MAX_SESSIONS = 20;
export const DEFAULT_LATEST = 5;
export const DEFAULT_MIN_TURNS = 3;

export interface SearchOptions {
  projectPath?: string;
  since?: string; // YYYY-MM-DD
  date?: string; // YYYY-MM-DD
  latest?: number;
  minTurns?: number;
  homeDir?: string; // override for testing
}

export interface SessionInfo {
  path: string;
  session_id: string;
  modified: string; // ISO-ish YYYY-MM-DDTHH:MM:SS
  size_bytes: number;
  turn_count: number;
}

/**
 * Convert a project directory path to Claude's project key format.
 *
 * /Users/me/work/my_project -> -Users-me-work-my-project
 * Claude replaces both / and _ with - in project keys.
 */
export function pathToProjectKey(projectPath: string): string {
  const normalized = projectPath.replace(/\/+$/, "");
  return normalized.replace(/\//g, "-").replace(/_/g, "-");
}

/**
 * Quick-scan a JSONL file to count human message turns.
 *
 * Counts records where type="user" and content is a string (not tool_result).
 * Returns 0 for missing or unreadable files.
 */
export function countTurns(jsonlPath: string): number {
  let content: string;
  try {
    content = fs.readFileSync(jsonlPath, "utf-8");
  } catch {
    return 0;
  }

  let count = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (rec.type !== "user") continue;

    const message = rec.message as Record<string, unknown> | undefined;
    const msgContent = message?.content;

    // Skip tool_result records (content is an array with tool_result items)
    if (Array.isArray(msgContent)) {
      const hasToolResult = msgContent.some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>).type === "tool_result"
      );
      if (hasToolResult) continue;
    }

    count++;
  }

  return count;
}

/**
 * Search for session JSONL files matching the given criteria.
 *
 * Returns list sorted by modification time (most recent first).
 */
export function searchSessions(options: SearchOptions = {}): SessionInfo[] {
  const {
    projectPath,
    since,
    date,
    latest = DEFAULT_LATEST,
    minTurns = DEFAULT_MIN_TURNS,
    homeDir,
  } = options;

  const home = homeDir ?? os.homedir();
  const projectsDir = path.join(home, ".claude", "projects");

  if (!fs.existsSync(projectsDir) || !fs.statSync(projectsDir).isDirectory()) {
    return [];
  }

  // Determine which project directories to search
  let searchDirs: string[];
  if (projectPath) {
    const key = pathToProjectKey(projectPath);
    searchDirs = [path.join(projectsDir, key)];
  } else {
    searchDirs = fs
      .readdirSync(projectsDir)
      .map((name) => path.join(projectsDir, name))
      .filter((p) => fs.statSync(p).isDirectory());
  }

  // Collect candidate session files
  interface Candidate {
    filePath: string;
    stat: fs.Stats;
  }

  const candidates: Candidate[] = [];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;

    const entries = fs.readdirSync(dir, { recursive: false }) as string[];
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const fullPath = path.join(dir, entry);
      // Skip files inside subagent directories
      if (fullPath.split(path.sep).includes("subagents")) continue;
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        candidates.push({ filePath: fullPath, stat });
      }
    }

    // Also check for jsonl files in subdirectories (but not subagents)
    if (fs.existsSync(dir)) {
      const walkDir = (d: string) => {
        const items = fs.readdirSync(d);
        for (const item of items) {
          const fullPath = path.join(d, item);
          const s = fs.statSync(fullPath);
          if (s.isDirectory()) {
            if (item === "subagents") continue;
            walkDir(fullPath);
          } else if (item.endsWith(".jsonl")) {
            if (!fullPath.split(path.sep).includes("subagents")) {
              // Avoid duplicates from the top-level scan
              if (d !== dir) {
                candidates.push({ filePath: fullPath, stat: s });
              }
            }
          }
        }
      };
      walkDir(dir);
    }
  }

  // Filter by date
  let filtered = candidates;

  if (since) {
    const sinceMs = new Date(since + "T00:00:00Z").getTime();
    filtered = filtered.filter((c) => c.stat.mtimeMs >= sinceMs);
  }

  if (date) {
    const dateMs = new Date(date + "T00:00:00Z").getTime();
    const dateEndMs = dateMs + 24 * 60 * 60 * 1000;
    filtered = filtered.filter(
      (c) => c.stat.mtimeMs >= dateMs && c.stat.mtimeMs < dateEndMs
    );
  }

  // Sort by modification time (most recent first)
  filtered.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  // Build results with turn count filter
  const cap = Math.min(latest, MAX_SESSIONS);
  const results: SessionInfo[] = [];

  for (const c of filtered) {
    if (results.length >= cap) break;

    const turns = countTurns(c.filePath);
    if (turns < minTurns) continue;

    const mtime = new Date(c.stat.mtimeMs);
    const modified = formatDateTime(mtime);

    results.push({
      path: c.filePath,
      session_id: path.basename(c.filePath, ".jsonl"),
      modified,
      size_bytes: c.stat.size,
      turn_count: turns,
    });
  }

  if (filtered.length > MAX_SESSIONS) {
    process.stderr.write(
      `Warning: ${filtered.length} sessions matched, returning ${results.length} most recent\n`
    );
  }

  return results;
}

/** Format a Date as YYYY-MM-DDTHH:MM:SS in UTC. */
function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
