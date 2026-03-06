/**
 * Status command: report finding and promotion statistics.
 *
 * Pure data reporting, no LLM calls.
 */

import { loadConfig } from "../config.js";
import { readJsonl } from "../storage.js";
import type { Finding, Promotion } from "../types.js";

export interface StatusOptions {
  projectPath?: string;
}

export interface StatusResult {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byProject: Record<string, number>;
  recentPromotions: Array<{ ts: string; project: string; rule: string }>;
  pendingAge: { lt7: number; d7to14: number; d14to30: number; gt30: number };
}

/**
 * Compute status statistics from findings and promotions.
 */
export function computeStatus(
  findings: Finding[],
  promotions: Promotion[],
  options: StatusOptions = {}
): StatusResult {
  // Filter by project path if specified
  let filtered = findings;
  if (options.projectPath) {
    filtered = findings.filter((f) => f.project_path === options.projectPath);
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

  // Recent promotions (last 10)
  let filteredPromotions = promotions;
  if (options.projectPath) {
    filteredPromotions = promotions.filter(
      (p) => p.project_path === options.projectPath
    );
  }
  const sorted = [...filteredPromotions].sort((a, b) =>
    b.ts.localeCompare(a.ts)
  );
  const recentPromotions = sorted.slice(0, 10).map((p) => ({
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
    recentPromotions,
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

  lines.push(`Findings: ${status.total} total`);
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
  if (status.recentPromotions.length > 0) {
    lines.push(`Recent promotions (last ${status.recentPromotions.length}):`);
    for (const p of status.recentPromotions) {
      const truncated =
        p.rule.length > 60 ? p.rule.slice(0, 57) + "..." : p.rule;
      lines.push(`  ${p.ts} | ${p.project} | "${truncated}"`);
    }
  } else {
    lines.push("Recent promotions:");
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
  const findings = readJsonl<Finding>(config.findingsPath);
  const promotions = readJsonl<Promotion>(config.promotionsPath);
  const status = computeStatus(findings, promotions, options);
  return formatStatus(status);
}
