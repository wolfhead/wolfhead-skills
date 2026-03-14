/**
 * Run: group insights semantically, distill into rules,
 * and consolidate to rules.jsonl.
 */

import fs from "fs";
import readline from "readline";
import { loadConfig } from "../config.js";
import { readJsonl, updateInsightStatus } from "../storage.js";
import { callLLM, getConsolidateConfig } from "../llm.js";
import {
  buildDistillPrompt,
  type InsightGroup,
  type DistillOutput,
} from "../prompts/distill.js";
import { executeConsolidate } from "./consolidate.js";
import { executeGroup } from "./group.js";
import { scoreInsight } from "../scoring.js";
import type { Insight } from "../types.js";

export interface RunOptions {
  dryRun?: boolean;
  reset?: boolean;
  yes?: boolean;
  window?: number; // days to look back, default 3
}

/**
 * Prompt user for confirmation via stdin.
 */
function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

/**
 * Reset all insights to pending and clear rules.jsonl.
 */
export async function resetRules(
  skipConfirm?: boolean,
  homeDir?: string
): Promise<boolean> {
  const config = loadConfig(homeDir);

  const allInsights = readJsonl<Insight>(config.insightsPath);
  const consolidatedIds = allInsights
    .filter((f) => f.status === "consolidated")
    .map((f) => f.id);

  const ruleCount = fs.existsSync(config.rulesPath)
    ? readJsonl(config.rulesPath).length
    : 0;

  console.log(`This will:`);
  console.log(`  - Reset ${consolidatedIds.length} insights from "consolidated" to "pending"`);
  console.log(`  - Delete ${ruleCount} rules from rules.jsonl`);

  if (!skipConfirm) {
    const ok = await confirm("Continue?");
    if (!ok) {
      console.log("Aborted.");
      return false;
    }
  }

  if (consolidatedIds.length > 0) {
    updateInsightStatus(config.insightsPath, consolidatedIds, "pending");
  }

  if (fs.existsSync(config.rulesPath)) {
    fs.unlinkSync(config.rulesPath);
  }

  console.log("Reset complete.");
  return true;
}

/**
 * Build InsightGroups from the semantic `group` field on insights.
 *
 * Only includes groups with 2+ pending insights within the time window.
 */
export function buildGroupsFromInsights(
  insights: Insight[],
  minSize: number = 2
): InsightGroup[] {
  const map = new Map<string, Insight[]>();

  for (const f of insights) {
    if (!f.group) continue;
    const arr = map.get(f.group) ?? [];
    arr.push(f);
    map.set(f.group, arr);
  }

  const groups: InsightGroup[] = [];
  let groupId = 1;

  for (const [, items] of map) {
    if (items.length < minSize) continue;
    const first = items[0];
    groups.push({
      group_id: groupId++,
      project: first.project,
      project_path: first.project_path,
      scope: "project",
      category: first.category,
      insights: items.map((f) => ({
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
 * Execute the run command.
 *
 * Flow:
 * 1. Reset if requested
 * 2. Read insights, filter pending within window
 * 3. Run semantic grouping if any insights lack a group field
 * 4. Build groups from the `group` field, filter to 2+ insights
 * 5. Dry run: print candidates and return
 * 6. Distill each group into a rule via LLM
 * 7. Consolidate each distilled rule via executeConsolidate
 * 8. Print summary
 */
export async function executeRun(
  options: RunOptions = {},
  homeDir?: string
): Promise<void> {
  // 1. Reset if requested
  if (options.reset) {
    const ok = await resetRules(options.yes, homeDir);
    if (!ok) return;
  }

  const config = loadConfig(homeDir);
  const windowDays = options.window ?? 3;

  // 2. Read and filter insights
  const allInsights = readJsonl<Insight>(config.insightsPath);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffIso = cutoff.toISOString();

  const pending = allInsights.filter(
    (f) => f.status === "pending" && f.ts >= cutoffIso
  );

  if (pending.length === 0) {
    console.log("Nothing to consolidate.");
    return;
  }

  // 3. Run semantic grouping if any pending insights lack a group field
  const ungrouped = pending.filter((f) => !f.group);
  if (ungrouped.length > 0) {
    console.log(`Grouping ${ungrouped.length} ungrouped insights...`);
    await executeGroup({ yes: true }, homeDir);
    // Re-read insights after grouping updated the file
    const refreshed = readJsonl<Insight>(config.insightsPath);
    // Update pending array with fresh group values
    for (const p of pending) {
      const fresh = refreshed.find((f) => f.id === p.id);
      if (fresh) {
        p.group = fresh.group;
      }
    }
  }

  // 4. Build candidates from two paths:
  //    Path A: semantic groups with 2+ insights
  //    Path B: high-score singletons (score >= threshold)
  const groupCandidates = buildGroupsFromInsights(pending);

  // Collect IDs already in group candidates
  const groupedIds = new Set<string>();
  for (const g of groupCandidates) {
    for (const f of g.insights) {
      groupedIds.add(f.id);
    }
  }

  // Path B: high-score singletons
  let nextGroupId = groupCandidates.length + 1;
  const scoreCandidates: InsightGroup[] = [];
  for (const f of pending) {
    if (groupedIds.has(f.id)) continue;
    const score = scoreInsight(f.category, f.priority);
    if (score >= config.promotionScoreThreshold) {
      scoreCandidates.push({
        group_id: nextGroupId++,
        project: f.project,
        project_path: f.project_path,
        scope: "project",
        category: f.category,
        insights: [{
          id: f.id,
          summary: f.summary,
          details: f.details,
          session: f.session,
        }],
      });
    }
  }

  const candidates = [...groupCandidates, ...scoreCandidates];

  if (candidates.length === 0) {
    console.log("Nothing to consolidate.");
    return;
  }

  // 5. Dry run
  if (options.dryRun) {
    console.log("Candidates for consolidation:");
    for (const g of groupCandidates) {
      const groupKey = pending.find((f) => f.id === g.insights[0].id)?.group ?? "?";
      console.log(`  [group: ${groupKey}] ${g.insights.length} insights`);
      for (const f of g.insights) {
        console.log(`    - ${f.id}: ${f.summary}`);
      }
    }
    for (const g of scoreCandidates) {
      const f = g.insights[0];
      const insight = pending.find((p) => p.id === f.id)!;
      const score = scoreInsight(insight.category, insight.priority);
      console.log(`  [score: ${score}] ${f.id} (${insight.category}/${insight.priority})`);
      console.log(`    ${f.summary}`);
    }
    return;
  }

  // 6. Distill each group into a rule (using consolidate model if configured)
  const consolidateConfig = getConsolidateConfig(config);
  const { system, user } = buildDistillPrompt(candidates);
  const { result: distilled } = await callLLM<DistillOutput>(
    consolidateConfig,
    system,
    user
  );

  // 7. Consolidate each distilled rule (in parallel)
  const consolidateResults = await Promise.all(
    distilled.rules.map((p) =>
      executeConsolidate(
        {
          insightIds: p.insight_ids,
          scope: p.scope,
          project: p.project,
          projectPath: p.project_path,
          category: p.category,
          rule: p.rule,
        },
        homeDir,
        consolidateConfig
      ).then((result) => ({ result, rule: p }))
    )
  );

  let consolidatedCount = 0;
  for (const { result, rule: p } of consolidateResults) {
    if (result.action !== "skip") {
      consolidatedCount++;
    }
    const rulePreview = p.rule.slice(0, 60) + (p.rule.length > 60 ? "..." : "");
    console.log(`  [${result.action}] ${p.category} -> ${rulePreview}`);
  }

  // 8. Summary
  console.log(
    `\nConsolidation complete: ${consolidatedCount} rules consolidated from ${pending.length} insights.`
  );
}
