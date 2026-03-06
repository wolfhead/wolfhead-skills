/**
 * Run promotion: group findings semantically, distill into rules,
 * and promote to promotions.jsonl.
 */

import fs from "fs";
import readline from "readline";
import { loadConfig } from "../config.js";
import { readJsonl, updateFindingStatus } from "../storage.js";
import { callLLM, getPromoteConfig } from "../llm.js";
import {
  buildDistillPrompt,
  type FindingGroup,
  type DistillOutput,
} from "../prompts/distill.js";
import { executePromoteFinding } from "./promote-finding.js";
import { executeGroup } from "./group.js";
import { scoreFinding } from "../scoring.js";
import type { Finding } from "../types.js";

export interface RunPromotionOptions {
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
 * Reset all findings to pending and clear promotions.jsonl.
 */
export async function resetPromotions(
  skipConfirm?: boolean,
  homeDir?: string
): Promise<boolean> {
  const config = loadConfig(homeDir);

  const allFindings = readJsonl<Finding>(config.findingsPath);
  const promotedIds = allFindings
    .filter((f) => f.status === "promoted")
    .map((f) => f.id);

  const promotionCount = fs.existsSync(config.promotionsPath)
    ? readJsonl(config.promotionsPath).length
    : 0;

  console.log(`This will:`);
  console.log(`  - Reset ${promotedIds.length} findings from "promoted" → "pending"`);
  console.log(`  - Delete ${promotionCount} promotions from promotions.jsonl`);

  if (!skipConfirm) {
    const ok = await confirm("Continue?");
    if (!ok) {
      console.log("Aborted.");
      return false;
    }
  }

  if (promotedIds.length > 0) {
    updateFindingStatus(config.findingsPath, promotedIds, "pending");
  }

  if (fs.existsSync(config.promotionsPath)) {
    fs.unlinkSync(config.promotionsPath);
  }

  console.log("Reset complete.");
  return true;
}

/**
 * Build FindingGroups from the semantic `group` field on findings.
 *
 * Only includes groups with 2+ pending findings within the time window.
 */
export function buildGroupsFromFindings(
  findings: Finding[],
  minSize: number = 2
): FindingGroup[] {
  const map = new Map<string, Finding[]>();

  for (const f of findings) {
    if (!f.group) continue;
    const arr = map.get(f.group) ?? [];
    arr.push(f);
    map.set(f.group, arr);
  }

  const groups: FindingGroup[] = [];
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
 * Execute the run_promotion command.
 *
 * Flow:
 * 1. Reset if requested
 * 2. Read findings, filter pending within window
 * 3. Run semantic grouping if any findings lack a group field
 * 4. Build groups from the `group` field, filter to 2+ findings
 * 5. Dry run: print candidates and return
 * 6. Distill each group into a rule via LLM
 * 7. Promote each distilled rule via executePromoteFinding
 * 8. Print summary
 */
export async function executeRunPromotion(
  options: RunPromotionOptions = {},
  homeDir?: string
): Promise<void> {
  // 1. Reset if requested
  if (options.reset) {
    const ok = await resetPromotions(options.yes, homeDir);
    if (!ok) return;
  }

  const config = loadConfig(homeDir);
  const windowDays = options.window ?? 3;

  // 2. Read and filter findings
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

  // 3. Run semantic grouping if any pending findings lack a group field
  const ungrouped = pending.filter((f) => !f.group);
  if (ungrouped.length > 0) {
    console.log(`Grouping ${ungrouped.length} ungrouped findings...`);
    await executeGroup({ yes: true }, homeDir);
    // Re-read findings after grouping updated the file
    const refreshed = readJsonl<Finding>(config.findingsPath);
    // Update pending array with fresh group values
    for (const p of pending) {
      const fresh = refreshed.find((f) => f.id === p.id);
      if (fresh) {
        p.group = fresh.group;
      }
    }
  }

  // 4. Build candidates from two paths:
  //    Path A: semantic groups with 2+ findings
  //    Path B: high-score singletons (score >= threshold)
  const groupCandidates = buildGroupsFromFindings(pending);

  // Collect IDs already in group candidates
  const groupedIds = new Set<string>();
  for (const g of groupCandidates) {
    for (const f of g.findings) {
      groupedIds.add(f.id);
    }
  }

  // Path B: high-score singletons
  let nextGroupId = groupCandidates.length + 1;
  const scoreCandidates: FindingGroup[] = [];
  for (const f of pending) {
    if (groupedIds.has(f.id)) continue;
    const score = scoreFinding(f.category, f.priority);
    if (score >= config.promotionScoreThreshold) {
      scoreCandidates.push({
        group_id: nextGroupId++,
        project: f.project,
        project_path: f.project_path,
        scope: "project",
        category: f.category,
        findings: [{
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
    console.log("Nothing to promote.");
    return;
  }

  // 5. Dry run
  if (options.dryRun) {
    console.log("Candidates for promotion:");
    for (const g of groupCandidates) {
      const groupKey = pending.find((f) => f.id === g.findings[0].id)?.group ?? "?";
      console.log(`  [group: ${groupKey}] ${g.findings.length} findings`);
      for (const f of g.findings) {
        console.log(`    - ${f.id}: ${f.summary}`);
      }
    }
    for (const g of scoreCandidates) {
      const f = g.findings[0];
      const finding = pending.find((p) => p.id === f.id)!;
      const score = scoreFinding(finding.category, finding.priority);
      console.log(`  [score: ${score}] ${f.id} (${finding.category}/${finding.priority})`);
      console.log(`    ${f.summary}`);
    }
    return;
  }

  // 6. Distill each group into a rule (using promote model if configured)
  const promoteConfig = getPromoteConfig(config);
  const { system, user } = buildDistillPrompt(candidates);
  const { result: distilled } = await callLLM<DistillOutput>(
    promoteConfig,
    system,
    user
  );

  // 7. Promote each distilled rule (in parallel)
  const promoteResults = await Promise.all(
    distilled.promotions.map((p) =>
      executePromoteFinding(
        {
          findingIds: p.finding_ids,
          scope: p.scope,
          project: p.project,
          projectPath: p.project_path,
          category: p.category,
          rule: p.rule,
        },
        homeDir,
        promoteConfig
      ).then((result) => ({ result, promotion: p }))
    )
  );

  let promotedCount = 0;
  for (const { result, promotion: p } of promoteResults) {
    if (result.action !== "skip") {
      promotedCount++;
    }
    const rulePreview = p.rule.slice(0, 60) + (p.rule.length > 60 ? "..." : "");
    console.log(`  [${result.action}] ${p.category} → ${rulePreview}`);
  }

  // 8. Summary
  console.log(
    `\nPromotion complete: ${promotedCount} rules promoted from ${pending.length} findings.`
  );
}
