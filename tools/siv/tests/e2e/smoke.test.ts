/**
 * End-to-end smoke test for the siv data pipeline.
 *
 * Tests the full flow: log -> insights.jsonl -> group -> rules.jsonl
 * -> retrieve, without any LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { executeLog } from "../../src/commands/log.js";
import { readJsonl, appendJsonl, updateInsightField } from "../../src/storage.js";
import { buildGroupsFromInsights } from "../../src/commands/run.js";
import { executeRetrieve } from "../../src/commands/retrieve.js";
import type { Insight, Rule } from "../../src/types.js";

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from "../../src/config.js";

const mockedLoadConfig = vi.mocked(loadConfig);

describe("E2E smoke test", () => {
  let tmpDir: string;
  let sivDir: string;
  let insightsPath: string;
  let rulesPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-e2e-"));
    sivDir = path.join(tmpDir, ".siv");
    insightsPath = path.join(sivDir, "insights.jsonl");
    rulesPath = path.join(sivDir, "rules.jsonl");
    fs.mkdirSync(sivDir, { recursive: true });

    mockedLoadConfig.mockReturnValue({
      sivDir,
      apiKey: "test-key",
      apiBase: "https://api.test.com",
      model: "test-model",
      insightsPath,
      rulesPath,
      backupsDir: path.join(sivDir, "backups"),
      promotionThreshold: {
        minSessions: 2,
        minOccurrences: 3,
        crossProjectMinProjects: 2,
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("full data pipeline: log -> group -> consolidate -> retrieve", () => {
    // ─── Step 1: Log insights ───

    const log1 = executeLog(
      {
        category: "correction",
        summary: "Always Read before Write",
        details: "The tool requires a prior Read in the session",
        project: "wolfhead_skills",
        projectPath: "/Users/me/work/wolfhead_skills",
        session: "session-aaa",
      },
      tmpDir
    );
    expect(log1.status).toBe("logged");

    const log2 = executeLog(
      {
        category: "correction",
        summary: "Always Read before Write (again)",
        details: "Encountered same issue in different context",
        project: "wolfhead_skills",
        projectPath: "/Users/me/work/wolfhead_skills",
        session: "session-bbb",
      },
      tmpDir
    );

    const log3 = executeLog(
      {
        category: "correction",
        summary: "Check file existence before Read",
        details: "Avoid sibling tool call cascade",
        project: "wolfhead_skills",
        projectPath: "/Users/me/work/wolfhead_skills",
        session: "session-bbb",
      },
      tmpDir
    );

    // ─── Step 2: Simulate semantic grouping (normally done by LLM) ───

    const groupAssignments = new Map<string, string>();
    groupAssignments.set(log1.id, "read_before_write");
    groupAssignments.set(log2.id, "read_before_write");
    groupAssignments.set(log3.id, "check_file_existence"); // different advice -> different group
    updateInsightField(insightsPath, groupAssignments, "group");

    // ─── Step 3: Build groups — only read_before_write has 2+ ───

    const insights = readJsonl<Insight>(insightsPath);
    const candidates = buildGroupsFromInsights(insights);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].insights).toHaveLength(2);

    // ─── Step 4: Retrieve returns empty initially ───

    const projectPath = "/Users/me/work/wolfhead_skills";
    const emptyResult = executeRetrieve(
      { projectPath, global: false, format: "text" },
      tmpDir
    );
    expect(emptyResult).toBe("");

    // ─── Step 5: Write a rule directly to rules.jsonl ───

    const rule: Rule = {
      id: "RUL-20260305-abc",
      ts: new Date().toISOString(),
      insight_ids: [log1.id, log2.id],
      scope: "project",
      project: "wolfhead_skills",
      project_path: projectPath,
      category: "correction",
      rule: "Always Read a file before Write or Edit — the tool requires a prior Read in the session",
      action_taken: "create",
      status: "active",
    };
    appendJsonl(rulesPath, rule as unknown as Record<string, unknown>);

    // ─── Step 6: Retrieve returns the consolidated content ───

    const retrieved = executeRetrieve(
      { projectPath, global: false, format: "text" },
      tmpDir
    );
    expect(retrieved).toContain("Always Read a file before Write");
    expect(retrieved).toContain("## correction");

    // JSON format
    const jsonResult = executeRetrieve(
      { projectPath, global: false, format: "json" },
      tmpDir
    );
    const parsed = JSON.parse(jsonResult);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0].rule).toContain("Always Read a file before Write");
  });

  it("singleton groups are not consolidated", () => {
    executeLog(
      {
        category: "error",
        summary: "Command failed",
        project: "small-proj",
        projectPath: "/Users/me/small-proj",
        session: "session-only",
      },
      tmpDir
    );
    executeLog(
      {
        category: "error",
        summary: "Another command failed",
        project: "small-proj",
        projectPath: "/Users/me/small-proj",
        session: "session-only",
      },
      tmpDir
    );

    // Each insight gets its own group (different advice)
    const insights = readJsonl<Insight>(insightsPath);
    const groupAssignments = new Map<string, string>();
    groupAssignments.set(insights[0].id, "group_a");
    groupAssignments.set(insights[1].id, "group_b");
    updateInsightField(insightsPath, groupAssignments, "group");

    const refreshed = readJsonl<Insight>(insightsPath);
    const candidates = buildGroupsFromInsights(refreshed);

    expect(candidates).toHaveLength(0);
  });

  it("superseded rules are excluded from retrieve", () => {
    const projectPath = "/Users/me/work/project";

    appendJsonl(rulesPath, {
      id: "RUL-20260305-old",
      ts: "2026-03-05T00:00:00Z",
      insight_ids: ["INS-1"],
      scope: "project",
      project: "project",
      project_path: projectPath,
      category: "learning",
      rule: "Old superseded rule",
      action_taken: "create",
      status: "superseded",
    });

    appendJsonl(rulesPath, {
      id: "RUL-20260305-new",
      ts: "2026-03-05T01:00:00Z",
      insight_ids: ["INS-2"],
      scope: "project",
      project: "project",
      project_path: projectPath,
      category: "learning",
      rule: "New active rule",
      action_taken: "supersede",
      status: "active",
    });

    const result = executeRetrieve(
      { projectPath, global: false, format: "text" },
      tmpDir
    );

    expect(result).not.toContain("Old superseded rule");
    expect(result).toContain("New active rule");
  });
});
