/**
 * End-to-end smoke test for the siv data pipeline.
 *
 * Tests the full flow: log -> findings.jsonl -> group -> promotions.jsonl
 * -> retrieve, without any LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { executeLog } from "../../src/commands/log.js";
import { readJsonl, appendJsonl, updateFindingField } from "../../src/storage.js";
import { buildGroupsFromFindings } from "../../src/commands/run-promotion.js";
import { executeRetrieve } from "../../src/commands/retrieve.js";
import type { Finding, Promotion } from "../../src/types.js";

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from "../../src/config.js";

const mockedLoadConfig = vi.mocked(loadConfig);

describe("E2E smoke test", () => {
  let tmpDir: string;
  let sivDir: string;
  let findingsPath: string;
  let promotionsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-e2e-"));
    sivDir = path.join(tmpDir, ".siv");
    findingsPath = path.join(sivDir, "findings.jsonl");
    promotionsPath = path.join(sivDir, "promotions.jsonl");
    fs.mkdirSync(sivDir, { recursive: true });

    mockedLoadConfig.mockReturnValue({
      sivDir,
      apiKey: "test-key",
      apiBase: "https://api.test.com",
      model: "test-model",
      findingsPath,
      promotionsPath,
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

  it("full data pipeline: log -> group -> promote -> retrieve", () => {
    // ─── Step 1: Log findings ───

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
    groupAssignments.set(log3.id, "check_file_existence"); // different advice → different group
    updateFindingField(findingsPath, groupAssignments, "group");

    // ─── Step 3: Build groups — only read_before_write has 2+ ───

    const findings = readJsonl<Finding>(findingsPath);
    const candidates = buildGroupsFromFindings(findings);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].findings).toHaveLength(2);

    // ─── Step 4: Retrieve returns empty initially ───

    const projectPath = "/Users/me/work/wolfhead_skills";
    const emptyResult = executeRetrieve(
      { projectPath, global: false, format: "text" },
      tmpDir
    );
    expect(emptyResult).toBe("");

    // ─── Step 5: Write a promotion directly to promotions.jsonl ───

    const promotion: Promotion = {
      id: "PRM-20260305-abc",
      ts: new Date().toISOString(),
      finding_ids: [log1.id, log2.id],
      scope: "project",
      project: "wolfhead_skills",
      project_path: projectPath,
      category: "correction",
      rule: "Always Read a file before Write or Edit — the tool requires a prior Read in the session",
      action_taken: "create",
      status: "active",
    };
    appendJsonl(promotionsPath, promotion as unknown as Record<string, unknown>);

    // ─── Step 6: Retrieve returns the promoted content ───

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
    expect(parsed.promotions).toHaveLength(1);
    expect(parsed.promotions[0].rule).toContain("Always Read a file before Write");
  });

  it("singleton groups are not promoted", () => {
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

    // Each finding gets its own group (different advice)
    const findings = readJsonl<Finding>(findingsPath);
    const groupAssignments = new Map<string, string>();
    groupAssignments.set(findings[0].id, "group_a");
    groupAssignments.set(findings[1].id, "group_b");
    updateFindingField(findingsPath, groupAssignments, "group");

    const refreshed = readJsonl<Finding>(findingsPath);
    const candidates = buildGroupsFromFindings(refreshed);

    expect(candidates).toHaveLength(0);
  });

  it("superseded promotions are excluded from retrieve", () => {
    const projectPath = "/Users/me/work/project";

    appendJsonl(promotionsPath, {
      id: "PRM-20260305-old",
      ts: "2026-03-05T00:00:00Z",
      finding_ids: ["LRN-1"],
      scope: "project",
      project: "project",
      project_path: projectPath,
      category: "learning",
      rule: "Old superseded rule",
      action_taken: "create",
      status: "superseded",
    });

    appendJsonl(promotionsPath, {
      id: "PRM-20260305-new",
      ts: "2026-03-05T01:00:00Z",
      finding_ids: ["LRN-2"],
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
