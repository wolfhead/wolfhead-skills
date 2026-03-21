/**
 * Group command: incrementally assign insights to semantic groups.
 *
 * Processes ungrouped insights in batches. Each batch is sent to the LLM
 * along with existing group summaries. The LLM assigns each insight to
 * an existing group or creates a new one.
 *
 * State is persisted in groups.jsonl (accumulated group summaries)
 * and the `group` field on each insight in insights.jsonl.
 */

import fs from "fs";
import { loadConfig } from "../config.js";
import {
  readJsonl,
  updateInsightField,
  readGroups,
  writeGroups,
  type GroupEntry,
} from "../storage.js";
import { callLLM, getConsolidateConfig } from "../llm.js";
import {
  buildAssignMergePrompt,
  type AssignMergeOutput,
} from "../prompts/group.js";
import type { Insight } from "../types.js";

export const BATCH_SIZE = 10;

export interface GroupOptions {
  dryRun?: boolean;
  reset?: boolean;
  yes?: boolean;
}

/**
 * Reset groups: clear group field from all insights and delete groups.jsonl.
 */
function resetGroups(insightsPath: string, groupsPath: string): void {
  // Clear group field from insights
  if (fs.existsSync(insightsPath)) {
    const content = fs.readFileSync(insightsPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    const updated = lines.map((line) => {
      try {
        const obj = JSON.parse(line);
        delete obj.group;
        return JSON.stringify(obj);
      } catch {
        return line;
      }
    });
    fs.writeFileSync(insightsPath, updated.join("\n") + "\n", "utf-8");
  }

  // Delete groups.jsonl
  if (fs.existsSync(groupsPath)) {
    fs.unlinkSync(groupsPath);
  }
}

export async function executeGroup(
  options: GroupOptions = {},
  homeDir?: string
): Promise<void> {
  const config = loadConfig(homeDir);

  if (options.reset) {
    const allInsights = readJsonl<Insight>(config.insightsPath);
    const grouped = allInsights.filter((f) => f.group).length;
    console.log(`Clearing group field from ${grouped} insights and deleting groups.jsonl.`);

    if (!options.yes) {
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ok = await new Promise<boolean>((resolve) => {
        rl.question("Continue? [y/N] ", (answer) => {
          rl.close();
          resolve(answer.trim().toLowerCase() === "y");
        });
      });
      if (!ok) {
        console.log("Aborted.");
        return;
      }
    }

    resetGroups(config.insightsPath, config.groupsPath);
    console.log("Reset complete.");
  }

  // Read current state
  const allInsights = readJsonl<Insight>(config.insightsPath);
  const ungrouped = allInsights.filter((f) => !f.group);

  if (ungrouped.length === 0) {
    console.log("No ungrouped insights to process.");
    return;
  }

  // Load existing groups
  let groups = readGroups(config.groupsPath);
  const consolidateConfig = getConsolidateConfig(config);

  // Process in batches
  for (let i = 0; i < ungrouped.length; i += BATCH_SIZE) {
    const batch = ungrouped.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(ungrouped.length / BATCH_SIZE);

    if (totalBatches > 1) {
      console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} insights)...`);
    }

    const { system, user } = buildAssignMergePrompt(
      batch.map((f) => ({ id: f.id, summary: f.summary, details: f.details })),
      groups.map((g) => ({ label: g.label, merged_summary: g.merged_summary, count: g.count }))
    );

    const { result } = await callLLM<AssignMergeOutput>(consolidateConfig, system, user);

    // Apply assignments: update groups state and collect insight->label mapping
    const idToGroup = new Map<string, string>();

    for (const assignment of result.assignments) {
      idToGroup.set(assignment.insight_id, assignment.label);

      const existing = groups.find((g) => g.label === assignment.label);
      if (existing) {
        // Update existing group
        existing.insight_ids.push(assignment.insight_id);
        existing.count = existing.insight_ids.length;
        existing.merged_summary = assignment.merged_summary;
      } else {
        // Create new group
        groups.push({
          label: assignment.label,
          merged_summary: assignment.merged_summary,
          insight_ids: [assignment.insight_id],
          count: 1,
        });
      }
    }

    // Write group labels back to insights.jsonl
    if (!options.dryRun) {
      updateInsightField(config.insightsPath, idToGroup, "group");
    }
  }

  // Write updated groups.jsonl
  if (!options.dryRun) {
    writeGroups(config.groupsPath, groups);
  }

  // Print results
  const sorted = [...groups].sort((a, b) => b.count - a.count);
  for (const g of sorted) {
    console.log(`\n[${g.label}] (${g.count} insights)`);
    console.log(`  ${g.merged_summary}`);
  }

  console.log(`\nGrouped ${ungrouped.length} insights into ${groups.length} groups.`);

  if (options.dryRun) {
    console.log("Dry run — no files updated.");
  }
}
