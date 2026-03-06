/**
 * Group command: use LLM to semantically group similar findings.
 *
 * Reads all findings (regardless of status), asks LLM to group by
 * same actionable advice, then writes the group key back to each
 * finding in findings.jsonl.
 */

import fs from "fs";
import { loadConfig } from "../config.js";
import { readJsonl, updateFindingField } from "../storage.js";
import { callLLM, getPromoteConfig } from "../llm.js";
import { buildGroupPrompt, type GroupOutput } from "../prompts/group.js";
import type { Finding } from "../types.js";

export interface GroupOptions {
  dryRun?: boolean;
  reset?: boolean;
  yes?: boolean;
}

/**
 * Remove the group field from all findings by rewriting the file.
 */
function resetGroups(findingsPath: string): void {
  if (!fs.existsSync(findingsPath)) return;

  const content = fs.readFileSync(findingsPath, "utf-8");
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

  fs.writeFileSync(findingsPath, updated.join("\n") + "\n", "utf-8");
}

export async function executeGroup(
  options: GroupOptions = {},
  homeDir?: string
): Promise<void> {
  const config = loadConfig(homeDir);
  const allFindings = readJsonl<Finding>(config.findingsPath);

  if (options.reset) {
    const grouped = allFindings.filter((f) => f.group).length;
    console.log(`Clearing group field from ${grouped} findings.`);

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

    resetGroups(config.findingsPath);
    console.log("Reset complete.");
  }

  if (allFindings.length === 0) {
    console.log("No findings to group.");
    return;
  }

  // Build LLM input — just the fields needed for grouping
  // Include current_group for already-grouped findings so the LLM preserves them
  const input = allFindings.map((f) => ({
    id: f.id,
    category: f.category,
    summary: f.summary,
    details: f.details,
    project: f.project,
    ...(f.group ? { current_group: f.group } : {}),
  }));

  const { system, user } = buildGroupPrompt(input);
  const promoteConfig = getPromoteConfig(config);
  const { result } = await callLLM<GroupOutput>(promoteConfig, system, user);

  // Invert: finding_id -> group_key
  const idToGroup = new Map<string, string>();
  for (const [groupKey, findingIds] of Object.entries(result.groups)) {
    for (const id of findingIds) {
      idToGroup.set(id, groupKey);
    }
  }

  // Print results sorted by group size
  const groupEntries = Object.entries(result.groups)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [groupKey, findingIds] of groupEntries) {
    console.log(`\n[${groupKey}] (${findingIds.length} findings)`);
    for (const id of findingIds) {
      const f = allFindings.find((f) => f.id === id);
      const status = f?.status ?? "?";
      const summary = f?.summary ?? "?";
      console.log(`  ${id} (${status}) ${summary.slice(0, 80)}${summary.length > 80 ? "..." : ""}`);
    }
  }

  if (options.dryRun) {
    console.log(`\nDry run — findings.jsonl not updated.`);
    return;
  }

  // Write group keys back to findings.jsonl
  updateFindingField(config.findingsPath, idToGroup, "group");

  const ungrouped = allFindings.length - idToGroup.size;
  console.log(`\nGrouped ${idToGroup.size} findings into ${groupEntries.length} groups.`);
  if (ungrouped > 0) {
    console.log(`Warning: ${ungrouped} findings not in LLM output.`);
  }
}
