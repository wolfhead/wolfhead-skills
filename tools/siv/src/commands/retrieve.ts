/**
 * Retrieve command: reads consolidated rules from rules.jsonl.
 *
 * Filters by project path and/or global scope, returns only active
 * rules, formatted as text or JSON.
 */

import { loadConfig } from "../config.js";
import { readJsonl } from "../storage.js";
import type { Rule } from "../types.js";

export interface RetrieveOptions {
  projectPath?: string;
  global: boolean;
  format: "text" | "json";
}

/**
 * Retrieve consolidated rules from rules.jsonl.
 *
 * Returns active rules filtered by project/global scope,
 * grouped by category, as text bullets or JSON.
 */
export function executeRetrieve(
  options: RetrieveOptions,
  homeDir?: string
): string {
  const config = loadConfig(homeDir);
  const allRules = readJsonl<Rule>(config.rulesPath);

  // Filter to active only
  const active = allRules.filter((p) => p.status === "active");

  // Filter by scope
  const matching: Rule[] = [];

  if (options.projectPath) {
    for (const p of active) {
      if (p.scope === "project" && p.project_path === options.projectPath) {
        matching.push(p);
      }
    }
  }

  if (options.global) {
    for (const p of active) {
      if (p.scope === "global") {
        matching.push(p);
      }
    }
  }

  if (options.format === "json") {
    return JSON.stringify({
      project: options.projectPath ?? null,
      global: options.global,
      rules: matching.map((p) => ({
        id: p.id,
        category: p.category,
        rule: p.rule,
        insight_ids: p.insight_ids,
        ts: p.ts,
      })),
    });
  }

  // Text format: group by category
  if (matching.length === 0) {
    return "";
  }

  const byCategory = new Map<string, Rule[]>();
  for (const p of matching) {
    const arr = byCategory.get(p.category) ?? [];
    arr.push(p);
    byCategory.set(p.category, arr);
  }

  const sections: string[] = [];
  for (const [category, rules] of byCategory) {
    const lines = [`## ${category}`, ""];
    for (const p of rules) {
      lines.push(`- ${p.rule}`);
    }
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n") + "\n";
}
