/**
 * Retrieve command: reads promoted rules from promotions.jsonl.
 *
 * Filters by project path and/or global scope, returns only active
 * promotions, formatted as text or JSON.
 */

import { loadConfig } from "../config.js";
import { readJsonl } from "../storage.js";
import type { Promotion } from "../types.js";

export interface RetrieveOptions {
  projectPath?: string;
  global: boolean;
  format: "text" | "json";
}

/**
 * Retrieve promoted rules from promotions.jsonl.
 *
 * Returns active promotions filtered by project/global scope,
 * grouped by category, as text bullets or JSON.
 */
export function executeRetrieve(
  options: RetrieveOptions,
  homeDir?: string
): string {
  const config = loadConfig(homeDir);
  const allPromotions = readJsonl<Promotion>(config.promotionsPath);

  // Filter to active only
  const active = allPromotions.filter((p) => p.status === "active");

  // Filter by scope
  const matching: Promotion[] = [];

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
      promotions: matching.map((p) => ({
        id: p.id,
        category: p.category,
        rule: p.rule,
        finding_ids: p.finding_ids,
        ts: p.ts,
      })),
    });
  }

  // Text format: group by category
  if (matching.length === 0) {
    return "";
  }

  const byCategory = new Map<string, Promotion[]>();
  for (const p of matching) {
    const arr = byCategory.get(p.category) ?? [];
    arr.push(p);
    byCategory.set(p.category, arr);
  }

  const sections: string[] = [];
  for (const [category, promotions] of byCategory) {
    const lines = [`## ${category}`, ""];
    for (const p of promotions) {
      lines.push(`- ${p.rule}`);
    }
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n") + "\n";
}
