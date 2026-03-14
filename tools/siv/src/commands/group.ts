/**
 * Group command: use LLM to semantically group similar insights.
 *
 * Reads all insights (regardless of status), asks LLM to group by
 * same actionable advice, then writes the group key back to each
 * insight in insights.jsonl.
 */

import fs from "fs";
import { loadConfig } from "../config.js";
import { readJsonl, updateInsightField } from "../storage.js";
import { callLLM, getConsolidateConfig } from "../llm.js";
import { buildGroupPrompt, type GroupOutput } from "../prompts/group.js";
import type { Insight } from "../types.js";

export interface GroupOptions {
  dryRun?: boolean;
  reset?: boolean;
  yes?: boolean;
}

/**
 * Remove the group field from all insights by rewriting the file.
 */
function resetGroups(insightsPath: string): void {
  if (!fs.existsSync(insightsPath)) return;

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

export async function executeGroup(
  options: GroupOptions = {},
  homeDir?: string
): Promise<void> {
  const config = loadConfig(homeDir);
  const allInsights = readJsonl<Insight>(config.insightsPath);

  if (options.reset) {
    const grouped = allInsights.filter((f) => f.group).length;
    console.log(`Clearing group field from ${grouped} insights.`);

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

    resetGroups(config.insightsPath);
    console.log("Reset complete.");
  }

  if (allInsights.length === 0) {
    console.log("No insights to group.");
    return;
  }

  // Build LLM input — just the fields needed for grouping
  // Include current_group for already-grouped insights so the LLM preserves them
  const input = allInsights.map((f) => ({
    id: f.id,
    category: f.category,
    summary: f.summary,
    details: f.details,
    project: f.project,
    ...(f.group ? { current_group: f.group } : {}),
  }));

  const { system, user } = buildGroupPrompt(input);
  const consolidateConfig = getConsolidateConfig(config);
  const { result } = await callLLM<GroupOutput>(consolidateConfig, system, user);

  // Invert: insight_id -> group_key
  const idToGroup = new Map<string, string>();
  for (const [groupKey, insightIds] of Object.entries(result.groups)) {
    for (const id of insightIds) {
      idToGroup.set(id, groupKey);
    }
  }

  // Print results sorted by group size
  const groupEntries = Object.entries(result.groups)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [groupKey, insightIds] of groupEntries) {
    console.log(`\n[${groupKey}] (${insightIds.length} insights)`);
    for (const id of insightIds) {
      const f = allInsights.find((f) => f.id === id);
      const status = f?.status ?? "?";
      const summary = f?.summary ?? "?";
      console.log(`  ${id} (${status}) ${summary.slice(0, 80)}${summary.length > 80 ? "..." : ""}`);
    }
  }

  if (options.dryRun) {
    console.log(`\nDry run — insights.jsonl not updated.`);
    return;
  }

  // Write group keys back to insights.jsonl
  updateInsightField(config.insightsPath, idToGroup, "group");

  const ungrouped = allInsights.length - idToGroup.size;
  console.log(`\nGrouped ${idToGroup.size} insights into ${groupEntries.length} groups.`);
  if (ungrouped > 0) {
    console.log(`Warning: ${ungrouped} insights not in LLM output.`);
  }
}
