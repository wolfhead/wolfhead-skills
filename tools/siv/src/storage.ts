import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Generate an insight ID with format: INS-YYYYMMDD-xxx
 * where xxx is 3 random hex chars.
 */
export function generateInsightId(): string {
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const hex = crypto.randomBytes(2).toString("hex").slice(0, 3);
  return `INS-${dateStr}-${hex}`;
}

/**
 * Append a single JSON object as one line to a JSONL file.
 * Creates parent directories if they don't exist.
 */
export function appendJsonl(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(data) + "\n", "utf-8");
}

/**
 * Read all lines from a JSONL file, skipping malformed lines.
 * Returns empty array if file doesn't exist.
 */
export function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  const results: T[] = [];

  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as T);
    } catch {
      // Skip malformed lines
    }
  }

  return results;
}

/**
 * Read a file's contents or return empty string if missing.
 */
export function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Generate a rule ID with format: RUL-YYYYMMDD-xxx
 */
export function generateRuleId(): string {
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const hex = crypto.randomBytes(2).toString("hex").slice(0, 3);
  return `RUL-${dateStr}-${hex}`;
}

/**
 * Update the status field of rules matching the given IDs.
 * Reads all lines, updates matching ones, rewrites the file.
 */
export function updateRuleStatus(
  filePath: string,
  ruleIds: string[],
  newStatus: string
): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  const idSet = new Set(ruleIds);

  const updatedLines = lines.map((line) => {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (typeof obj.id === "string" && idSet.has(obj.id)) {
        obj.status = newStatus;
        return JSON.stringify(obj);
      }
      return line;
    } catch {
      return line;
    }
  });

  fs.writeFileSync(filePath, updatedLines.join("\n") + "\n", "utf-8");
}

/**
 * Update a field on insights matching the given IDs.
 * Reads all lines, updates matching ones, rewrites the file.
 */
export function updateInsightField(
  filePath: string,
  updates: Map<string, string>,
  field: string
): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");

  const updatedLines = lines.map((line) => {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (typeof obj.id === "string" && updates.has(obj.id)) {
        obj[field] = updates.get(obj.id);
        return JSON.stringify(obj);
      }
      return line;
    } catch {
      return line;
    }
  });

  fs.writeFileSync(filePath, updatedLines.join("\n") + "\n", "utf-8");
}

export function updateInsightStatus(
  filePath: string,
  insightIds: string[],
  newStatus: string
): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  const idSet = new Set(insightIds);

  const updatedLines = lines.map((line) => {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (typeof obj.id === "string" && idSet.has(obj.id)) {
        obj.status = newStatus;
        return JSON.stringify(obj);
      }
      return line;
    } catch {
      return line;
    }
  });

  fs.writeFileSync(filePath, updatedLines.join("\n") + "\n", "utf-8");
}

export interface GroupEntry {
  label: string;
  merged_summary: string;
  insight_ids: string[];
  count: number;
}

/**
 * Read all group entries from a groups.jsonl file.
 */
export function readGroups(filePath: string): GroupEntry[] {
  return readJsonl<GroupEntry>(filePath);
}

/**
 * Write group entries to a groups.jsonl file, overwriting existing content.
 */
export function writeGroups(filePath: string, groups: GroupEntry[]): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const content = groups.map((g) => JSON.stringify(g)).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf-8");
}
