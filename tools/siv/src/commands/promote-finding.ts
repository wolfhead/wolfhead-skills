/**
 * Promote a finding to promotions.jsonl.
 *
 * Uses an LLM to decide how to integrate the rule (create, merge,
 * supersede, or skip) against existing promotions, then writes to
 * promotions.jsonl as the sole storage.
 */

import { loadConfig, type SivConfig } from "../config.js";
import { callLLM } from "../llm.js";
import {
  appendJsonl,
  readJsonl,
  updateFindingStatus,
  updatePromotionStatus,
  generatePromotionId,
} from "../storage.js";
import {
  buildPromotePrompt,
  type PromoteWriterOutput,
} from "../prompts/promote.js";
import type { Promotion } from "../types.js";

export interface PromoteFindingOptions {
  findingIds: string[];
  scope: "project" | "global";
  project?: string;
  projectPath?: string;
  category: string;
  rule: string;
}

export interface PromoteFindingResult {
  action: string;
  entry: string;
  reason: string;
  finding_ids: string[];
}

/**
 * Execute the promote_finding command.
 *
 * Flow:
 * 1. Read existing active promotions from promotions.jsonl
 * 2. Call LLM with promote prompt
 * 3. Write result to promotions.jsonl (handling merge/supersede)
 * 4. Mark source findings as promoted
 * 5. Return result
 */
export async function executePromoteFinding(
  options: PromoteFindingOptions,
  homeDir?: string,
  configOverride?: SivConfig
): Promise<PromoteFindingResult> {
  const config = configOverride ?? loadConfig(homeDir);

  // 1. Read existing active promotions for same project/scope
  const allPromotions = readJsonl<Promotion>(config.promotionsPath);
  const existingActive = allPromotions.filter((p) => {
    if (p.status !== "active") return false;
    if (options.scope === "project") {
      return p.scope === "project" && p.project_path === (options.projectPath ?? "");
    }
    return p.scope === "global";
  });

  // 2. Call LLM
  const { system, user } = buildPromotePrompt({
    rule: options.rule,
    category: options.category,
    scope: options.scope,
    existingPromotions: existingActive.map((p) => ({
      id: p.id,
      rule: p.rule,
      category: p.category,
      finding_ids: p.finding_ids,
      ts: p.ts,
    })),
    findingIds: options.findingIds,
  });

  const { result: writerOutput } = await callLLM<PromoteWriterOutput>(
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
      finding_ids: options.findingIds,
    };
  }

  // For merge/supersede, mark old promotions as superseded
  if (
    (writerOutput.action === "merge" || writerOutput.action === "supersede") &&
    writerOutput.supersedes_ids &&
    writerOutput.supersedes_ids.length > 0
  ) {
    updatePromotionStatus(
      config.promotionsPath,
      writerOutput.supersedes_ids,
      "superseded"
    );
  }

  // Append new active promotion
  const promotion: Promotion = {
    id: generatePromotionId(),
    ts: new Date().toISOString(),
    finding_ids: options.findingIds,
    scope: options.scope,
    project: options.project ?? "",
    project_path: options.projectPath ?? "",
    category: options.category,
    rule: writerOutput.entry,
    action_taken: writerOutput.action,
    status: "active",
  };
  appendJsonl(config.promotionsPath, promotion as unknown as Record<string, unknown>);

  // 4. Mark source findings as promoted
  updateFindingStatus(
    config.findingsPath,
    options.findingIds,
    "promoted"
  );

  // 5. Return result
  return {
    action: writerOutput.action,
    entry: writerOutput.entry ?? "",
    reason: writerOutput.reason,
    finding_ids: options.findingIds,
  };
}
