/**
 * Consolidate insights into rules.jsonl.
 *
 * Uses an LLM to decide how to integrate the rule (create, merge,
 * supersede, or skip) against existing rules, then writes to
 * rules.jsonl as the sole storage.
 */

import { loadConfig, type SivConfig } from "../config.js";
import { callLLM } from "../llm.js";
import {
  appendJsonl,
  readJsonl,
  updateInsightStatus,
  updateRuleStatus,
  generateRuleId,
} from "../storage.js";
import {
  buildConsolidatePrompt,
  type ConsolidateWriterOutput,
} from "../prompts/consolidate.js";
import type { Rule } from "../types.js";

export interface ConsolidateOptions {
  insightIds: string[];
  scope: "project" | "global";
  project?: string;
  projectPath?: string;
  category: string;
  rule: string;
}

export interface ConsolidateResult {
  action: string;
  entry: string;
  reason: string;
  insight_ids: string[];
}

/**
 * Execute the consolidate command.
 *
 * Flow:
 * 1. Read existing active rules from rules.jsonl
 * 2. Call LLM with consolidate prompt
 * 3. Write result to rules.jsonl (handling merge/supersede)
 * 4. Mark source insights as consolidated
 * 5. Return result
 */
export async function executeConsolidate(
  options: ConsolidateOptions,
  homeDir?: string,
  configOverride?: SivConfig
): Promise<ConsolidateResult> {
  const config = configOverride ?? loadConfig(homeDir);

  // 1. Read existing active rules for same project/scope
  const allRules = readJsonl<Rule>(config.rulesPath);
  const existingActive = allRules.filter((p) => {
    if (p.status !== "active") return false;
    if (options.scope === "project") {
      return p.scope === "project" && p.project_path === (options.projectPath ?? "");
    }
    return p.scope === "global";
  });

  // 2. Call LLM
  const { system, user } = buildConsolidatePrompt({
    rule: options.rule,
    category: options.category,
    scope: options.scope,
    existingRules: existingActive.map((p) => ({
      id: p.id,
      rule: p.rule,
      category: p.category,
      insight_ids: p.insight_ids,
      ts: p.ts,
    })),
    insightIds: options.insightIds,
  });

  const { result: writerOutput } = await callLLM<ConsolidateWriterOutput>(
    config,
    system,
    user
  );

  // 3. Handle result
  if (writerOutput.action === "skip") {
    return {
      action: "skip",
      entry: "",
      reason: writerOutput.reason,
      insight_ids: options.insightIds,
    };
  }

  // For merge/supersede, mark old rules as superseded
  if (
    (writerOutput.action === "merge" || writerOutput.action === "supersede") &&
    writerOutput.supersedes_ids &&
    writerOutput.supersedes_ids.length > 0
  ) {
    updateRuleStatus(
      config.rulesPath,
      writerOutput.supersedes_ids,
      "superseded"
    );
  }

  // Append new active rule
  const rule: Rule = {
    id: generateRuleId(),
    ts: new Date().toISOString(),
    insight_ids: options.insightIds,
    scope: options.scope,
    project: options.project ?? "",
    project_path: options.projectPath ?? "",
    category: options.category,
    rule: writerOutput.entry,
    action_taken: writerOutput.action,
    status: "active",
  };
  appendJsonl(config.rulesPath, rule as unknown as Record<string, unknown>);

  // 4. Mark source insights as consolidated
  updateInsightStatus(
    config.insightsPath,
    options.insightIds,
    "consolidated"
  );

  // 5. Return result
  return {
    action: writerOutput.action,
    entry: writerOutput.entry ?? "",
    reason: writerOutput.reason,
    insight_ids: options.insightIds,
  };
}
