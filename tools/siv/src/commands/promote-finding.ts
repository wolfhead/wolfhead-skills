/**
 * Promote a finding to memory by writing to MEMORY.md.
 *
 * Uses an LLM to decide how to integrate the rule (create, merge,
 * supersede, or skip), then applies the edit to the target file.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { loadConfig } from "../config.js";
import { callLLM } from "../llm.js";
import { appendJsonl, updateFindingStatus, readFileOrEmpty } from "../storage.js";
import {
  projectPathToMemoryPath,
  globalMemoryPath,
} from "./retrieve.js";
import {
  buildPromotePrompt,
  type PromoteWriterOutput,
} from "../prompts/promote.js";
import { pathToProjectKey } from "../sessions/search.js";
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
  target_file: string;
  entry: string;
  reason: string;
  finding_ids: string[];
}

/**
 * Apply a promotion writer output to a target file.
 *
 * Pure file manipulation, no LLM calls.
 * - create: find section (or create it), append entry after section heading
 * - merge / supersede: find target_line, replace with entry
 * - skip: do nothing
 */
export function applyPromotion(
  targetFile: string,
  writerOutput: PromoteWriterOutput
): void {
  if (writerOutput.action === "skip") {
    return;
  }

  // Read existing content or create with header
  let content: string;
  if (fs.existsSync(targetFile)) {
    content = fs.readFileSync(targetFile, "utf-8");
  } else {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    content = "# Project Memory\n\n";
  }

  if (writerOutput.action === "create") {
    // Find section or create it
    const sectionIndex = content.indexOf(writerOutput.section);
    if (sectionIndex !== -1) {
      // Find end of section heading line
      const afterHeading = content.indexOf("\n", sectionIndex);
      if (afterHeading !== -1) {
        // Insert entry after section heading, preserving blank line
        const before = content.slice(0, afterHeading + 1);
        const after = content.slice(afterHeading + 1);
        content = before + "\n" + writerOutput.entry + "\n" + after;
      } else {
        // Section heading is at end of file
        content += "\n" + writerOutput.entry + "\n";
      }
    } else {
      // Create section at end of file
      const trailing = content.endsWith("\n") ? "" : "\n";
      content +=
        trailing + "\n" + writerOutput.section + "\n\n" + writerOutput.entry + "\n";
    }
  } else if (
    writerOutput.action === "merge" ||
    writerOutput.action === "supersede"
  ) {
    if (writerOutput.target_line) {
      content = content.replace(writerOutput.target_line, writerOutput.entry);
    }
  }

  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, content, "utf-8");
}

/**
 * Get the path to the CLAUDE.md file for a given scope.
 */
function getClaudeMdPath(
  scope: "project" | "global",
  projectPath?: string,
  homeDir?: string
): string {
  const home = homeDir ?? os.homedir();
  if (scope === "project" && projectPath) {
    const key = pathToProjectKey(projectPath);
    return path.join(home, ".claude", "projects", key, "CLAUDE.md");
  }
  return path.join(home, ".claude", "CLAUDE.md");
}

/**
 * Execute the promote_finding command.
 *
 * Flow:
 * 1. Determine target file path
 * 2. Read current MEMORY.md and CLAUDE.md
 * 3. Call LLM with promote prompt
 * 4. Back up target file
 * 5. Apply promotion
 * 6. Mark source findings as promoted
 * 7. Append to promotions.jsonl
 * 8. Return result
 */
export async function executePromoteFinding(
  options: PromoteFindingOptions,
  homeDir?: string
): Promise<PromoteFindingResult> {
  const config = loadConfig(homeDir);

  // 1. Determine target file
  const targetFile =
    options.scope === "global"
      ? globalMemoryPath(homeDir)
      : options.projectPath
        ? projectPathToMemoryPath(options.projectPath, homeDir)
        : globalMemoryPath(homeDir);

  // 2. Read current files
  const currentMemoryMd = readFileOrEmpty(targetFile);
  const claudeMdPath = getClaudeMdPath(
    options.scope,
    options.projectPath,
    homeDir
  );
  const currentClaudeMd = readFileOrEmpty(claudeMdPath);

  // 3. Call LLM
  const { system, user } = buildPromotePrompt({
    rule: options.rule,
    category: options.category,
    scope: options.scope,
    currentMemoryMd,
    currentClaudeMd,
    findingIds: options.findingIds,
  });

  const { result: writerOutput } = await callLLM<PromoteWriterOutput>(
    config,
    system,
    user
  );

  // 4. Back up target file (if it exists)
  if (writerOutput.action !== "skip" && fs.existsSync(targetFile)) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const backupName = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-MEMORY.md`;
    const backupPath = path.join(config.backupsDir, backupName);
    fs.mkdirSync(config.backupsDir, { recursive: true });
    fs.copyFileSync(targetFile, backupPath);
  }

  // 5. Apply promotion
  applyPromotion(targetFile, writerOutput);

  // 6. Mark findings as promoted
  if (writerOutput.action !== "skip") {
    updateFindingStatus(
      config.findingsPath,
      options.findingIds,
      "promoted"
    );
  }

  // 7. Append to promotions.jsonl
  if (writerOutput.action !== "skip") {
    const promotion: Promotion = {
      ts: new Date().toISOString(),
      finding_ids: options.findingIds,
      scope: options.scope,
      project: options.project ?? "",
      project_path: options.projectPath ?? "",
      category: options.category,
      rule: options.rule,
      action_taken: writerOutput.action,
      target_file: targetFile,
    };
    appendJsonl(config.promotionsPath, promotion as unknown as Record<string, unknown>);
  }

  // 8. Return result
  return {
    action: writerOutput.action,
    target_file: targetFile,
    entry: writerOutput.entry ?? "",
    reason: writerOutput.reason,
    finding_ids: options.findingIds,
  };
}
