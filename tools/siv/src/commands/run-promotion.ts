/**
 * Run promotion: scan pending findings, group them, distill into rules,
 * and promote to memory files.
 */

import fs from "fs";
import { loadConfig, type SivConfig } from "../config.js";
import { readJsonl } from "../storage.js";
import { callLLM } from "../llm.js";
import {
  buildDistillPrompt,
  type FindingGroup,
  type DistillOutput,
} from "../prompts/distill.js";
import { executePromoteFinding } from "./promote-finding.js";
import type { Finding } from "../types.js";

export interface RunPromotionOptions {
  dryRun?: boolean;
  window?: number; // days to look back, default 3
}

/**
 * Group findings by (project, category).
 *
 * Each group gets a sequential group_id starting at 1.
 * Scope is always "project" (per-project grouping).
 */
export function groupFindings(findings: Finding[]): FindingGroup[] {
  const map = new Map<string, Finding[]>();

  for (const f of findings) {
    const key = `${f.project}::${f.category}`;
    const arr = map.get(key) ?? [];
    arr.push(f);
    map.set(key, arr);
  }

  const groups: FindingGroup[] = [];
  let groupId = 1;

  for (const [, items] of map) {
    const first = items[0];
    groups.push({
      group_id: groupId++,
      project: first.project,
      project_path: first.project_path,
      scope: "project",
      category: first.category,
      findings: items.map((f) => ({
        id: f.id,
        summary: f.summary,
        details: f.details,
        session: f.session,
      })),
    });
  }

  return groups;
}

/**
 * Filter groups that meet promotion thresholds.
 *
 * A group qualifies if:
 * - It has findings from >= minSessions unique sessions, OR
 * - It has >= minOccurrences total findings
 */
export function applyThresholds(
  groups: FindingGroup[],
  thresholds: SivConfig["promotionThreshold"]
): FindingGroup[] {
  return groups.filter((g) => {
    const uniqueSessions = new Set(g.findings.map((f) => f.session)).size;
    const totalFindings = g.findings.length;

    return (
      uniqueSessions >= thresholds.minSessions ||
      totalFindings >= thresholds.minOccurrences
    );
  });
}

/**
 * Execute the run_promotion command.
 *
 * Flow:
 * 1. Read findings.jsonl, filter pending within time window
 * 2. Group by (project, category)
 * 3. Apply thresholds
 * 4. If no candidates, print message and return
 * 5. If dry run, print candidates and return
 * 6. Call LLM with distill prompt
 * 7. For each promotion, call executePromoteFinding
 * 8. Print summary
 */
export async function executeRunPromotion(
  options: RunPromotionOptions = {},
  homeDir?: string
): Promise<void> {
  const config = loadConfig(homeDir);
  const windowDays = options.window ?? 3;

  // 1. Read and filter findings
  const allFindings = readJsonl<Finding>(config.findingsPath);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffIso = cutoff.toISOString();

  const pending = allFindings.filter(
    (f) => f.status === "pending" && f.ts >= cutoffIso
  );

  if (pending.length === 0) {
    console.log("Nothing to promote.");
    return;
  }

  // 2. Group
  const groups = groupFindings(pending);

  // 3. Apply thresholds
  const candidates = applyThresholds(groups, config.promotionThreshold);

  if (candidates.length === 0) {
    console.log("Nothing to promote.");
    return;
  }

  // 4/5. Dry run
  if (options.dryRun) {
    console.log("Candidates for promotion:");
    for (const g of candidates) {
      const sessions = new Set(g.findings.map((f) => f.session)).size;
      console.log(
        `  [${g.category}] ${g.project}: ${g.findings.length} findings from ${sessions} sessions`
      );
      for (const f of g.findings) {
        console.log(`    - ${f.id}: ${f.summary}`);
      }
    }
    return;
  }

  // 6. Call LLM to distill
  const { system, user } = buildDistillPrompt(candidates);
  const { result: distilled } = await callLLM<DistillOutput>(
    config,
    system,
    user
  );

  // 7. Promote each
  let promotedCount = 0;
  for (const p of distilled.promotions) {
    const result = await executePromoteFinding(
      {
        findingIds: p.finding_ids,
        scope: p.scope,
        project: p.project,
        projectPath: p.project_path,
        category: p.category,
        rule: p.rule,
      },
      homeDir
    );
    if (result.action !== "skip") {
      promotedCount++;
    }
    console.log(
      `  [${result.action}] ${p.category} → ${p.rule.slice(0, 60)}${p.rule.length > 60 ? "..." : ""}`
    );
  }

  // 8. Summary
  console.log(
    `\nPromotion complete: ${promotedCount} rules promoted from ${pending.length} findings.`
  );
}
