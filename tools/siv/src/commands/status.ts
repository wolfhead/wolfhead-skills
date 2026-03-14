/**
 * Status command: report insight and rule statistics.
 *
 * Pure data reporting, no LLM calls.
 */

import { loadConfig } from "../config.js";
import { readJsonl } from "../storage.js";
import type { Insight, Rule } from "../types.js";

export interface StatusOptions {
  projectPath?: string;
}

export interface StatusResult {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byProject: Record<string, number>;
  recentRules: Array<{ ts: string; project: string; rule: string }>;
  pendingAge: { lt7: number; d7to14: number; d14to30: number; gt30: number };
}

/**
 * Compute status statistics from insights and rules.
 */
export function computeStatus(
  insights: Insight[],
  rules: Rule[],
  options: StatusOptions = {}
): StatusResult {
  // Filter by project path if specified
  let filtered = insights;
  if (options.projectPath) {
    filtered = insights.filter((f) => f.project_path === options.projectPath);
  }

  // By status
  const byStatus: Record<string, number> = {};
  for (const f of filtered) {
    byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
  }

  // By category
  const byCategory: Record<string, number> = {};
  for (const f of filtered) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }

  // By project
  const byProject: Record<string, number> = {};
  for (const f of filtered) {
    const proj = f.project || "(unknown)";
    byProject[proj] = (byProject[proj] ?? 0) + 1;
  }

  // Recent rules (last 10)
  let filteredRules = rules;
  if (options.projectPath) {
    filteredRules = rules.filter(
      (p) => p.project_path === options.projectPath
    );
  }
  const sorted = [...filteredRules].sort((a, b) =>
    b.ts.localeCompare(a.ts)
  );
  const recentRules = sorted.slice(0, 10).map((p) => ({
    ts: p.ts.slice(0, 10),
    project: p.project || "(unknown)",
    rule: p.rule,
  }));

  // Pending age
  const now = Date.now();
  const DAY = 86400000;
  const pending = filtered.filter((f) => f.status === "pending");
  let lt7 = 0;
  let d7to14 = 0;
  let d14to30 = 0;
  let gt30 = 0;
  for (const f of pending) {
    const age = now - new Date(f.ts).getTime();
    if (age < 7 * DAY) lt7++;
    else if (age < 14 * DAY) d7to14++;
    else if (age < 30 * DAY) d14to30++;
    else gt30++;
  }

  return {
    total: filtered.length,
    byStatus,
    byCategory,
    byProject,
    recentRules,
    pendingAge: { lt7, d7to14, d14to30, gt30 },
  };
}

/**
 * Format a record as "key: value | key: value" pairs.
 */
function formatPairs(record: Record<string, number>): string {
  return Object.entries(record)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");
}

/**
 * Format the status result as a human-readable string.
 */
export function formatStatus(status: StatusResult): string {
  const lines: string[] = [];

  lines.push("siv status");
  lines.push("\u2500".repeat(25));

  lines.push(`Insights: ${status.total} total`);
  if (Object.keys(status.byStatus).length > 0) {
    lines.push(`  ${formatPairs(status.byStatus)}`);
  }

  lines.push("");
  lines.push("By category:");
  if (Object.keys(status.byCategory).length > 0) {
    lines.push(`  ${formatPairs(status.byCategory)}`);
  } else {
    lines.push("  (none)");
  }

  lines.push("");
  lines.push("By project:");
  if (Object.keys(status.byProject).length > 0) {
    lines.push(`  ${formatPairs(status.byProject)}`);
  } else {
    lines.push("  (none)");
  }

  lines.push("");
  if (status.recentRules.length > 0) {
    lines.push(`Recent rules (last ${status.recentRules.length}):`);
    for (const p of status.recentRules) {
      const truncated =
        p.rule.length > 60 ? p.rule.slice(0, 57) + "..." : p.rule;
      lines.push(`  ${p.ts} | ${p.project} | "${truncated}"`);
    }
  } else {
    lines.push("Recent rules:");
    lines.push("  (none)");
  }

  lines.push("");
  lines.push("Pending age:");
  lines.push(
    `  < 7 days: ${status.pendingAge.lt7} | 7-14 days: ${status.pendingAge.d7to14} | 14-30 days: ${status.pendingAge.d14to30} | > 30 days: ${status.pendingAge.gt30}`
  );

  return lines.join("\n");
}

/**
 * Execute the status command.
 */
export function executeStatus(
  options: StatusOptions = {},
  homeDir?: string
): string {
  const config = loadConfig(homeDir);
  const insights = readJsonl<Insight>(config.insightsPath);
  const rules = readJsonl<Rule>(config.rulesPath);
  const status = computeStatus(insights, rules, options);
  return formatStatus(status);
}
