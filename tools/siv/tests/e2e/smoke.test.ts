/**
 * End-to-end smoke test for the siv data pipeline.
 *
 * Tests the full flow: log -> findings.jsonl -> group -> threshold ->
 * promote -> retrieve, without any LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { executeLog } from "../../src/commands/log.js";
import { readJsonl } from "../../src/storage.js";
import {
  groupFindings,
  applyThresholds,
} from "../../src/commands/run-promotion.js";
import { applyPromotion } from "../../src/commands/promote-finding.js";
import { executeRetrieve } from "../../src/commands/retrieve.js";
import type { Finding } from "../../src/types.js";
import type { PromoteWriterOutput } from "../../src/prompts/promote.js";

describe("E2E smoke test", () => {
  let tmpDir: string;
  let sivDir: string;
  let findingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-e2e-"));
    sivDir = path.join(tmpDir, ".siv");
    findingsPath = path.join(sivDir, "findings.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full data pipeline: log -> group -> threshold -> promote -> retrieve", () => {
    // ─── Step 1: Log 3 findings for same project from 2 sessions ───

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
    expect(log1.id).toMatch(/^LRN-/);

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
    expect(log2.status).toBe("logged");

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
    expect(log3.status).toBe("logged");

    // ─── Step 2: Verify findings.jsonl has 3 entries ───

    const findings = readJsonl<Finding>(findingsPath);
    expect(findings).toHaveLength(3);
    expect(findings[0].summary).toBe("Always Read before Write");
    expect(findings[1].session).toBe("session-bbb");
    expect(findings[2].category).toBe("correction");

    // All should be pending
    for (const f of findings) {
      expect(f.status).toBe("pending");
      expect(f.project).toBe("wolfhead_skills");
    }

    // ─── Step 3: Group and apply thresholds ───

    const groups = groupFindings(findings);
    expect(groups).toHaveLength(1); // all same project + category
    expect(groups[0].findings).toHaveLength(3);
    expect(groups[0].project).toBe("wolfhead_skills");
    expect(groups[0].category).toBe("correction");

    // With minSessions=2, minOccurrences=3 — we have 2 sessions AND 3 occurrences
    const candidates = applyThresholds(groups, {
      minSessions: 2,
      minOccurrences: 3,
      crossProjectMinProjects: 2,
    });
    expect(candidates).toHaveLength(1);

    // ─── Step 4: Retrieve returns empty initially ───

    const projectPath = "/Users/me/work/wolfhead_skills";
    const emptyResult = executeRetrieve(
      { projectPath, global: false, format: "text" },
      tmpDir
    );
    expect(emptyResult).toBe("");

    // ─── Step 5: Apply a promotion (no LLM, direct file write) ───

    // Build the memory path the same way retrieve will look for it
    // key = path with / replaced by -
    const projectKey = "-Users-me-work-wolfhead-skills";
    const memoryDir = path.join(
      tmpDir,
      ".claude",
      "projects",
      projectKey,
      "memory"
    );
    const memoryPath = path.join(memoryDir, "MEMORY.md");

    const writerOutput: PromoteWriterOutput = {
      action: "create",
      section: "## Session Learnings",
      entry:
        "- Always Read a file before Write or Edit, even for new files — the tool requires a prior Read in the session before allowing writes",
      reason: "New learning from repeated corrections",
    };

    applyPromotion(memoryPath, writerOutput);

    // Verify the file was written
    expect(fs.existsSync(memoryPath)).toBe(true);
    const memoryContent = fs.readFileSync(memoryPath, "utf-8");
    expect(memoryContent).toContain("## Session Learnings");
    expect(memoryContent).toContain("Always Read a file before Write");

    // ─── Step 6: Retrieve returns the promoted content ───

    const retrieved = executeRetrieve(
      { projectPath, global: false, format: "text" },
      tmpDir
    );
    expect(retrieved).toContain("Always Read a file before Write");
    expect(retrieved).toContain("## Session Learnings");

    // Also test JSON format
    const jsonResult = executeRetrieve(
      { projectPath, global: false, format: "json" },
      tmpDir
    );
    const parsed = JSON.parse(jsonResult);
    expect(parsed.content).toContain("Always Read a file before Write");
    expect(parsed.project).toBe(projectPath);
  });

  it("threshold rejects findings from single session below occurrence count", () => {
    // Log 2 findings from a single session — should NOT meet threshold
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

    const findings = readJsonl<Finding>(findingsPath);
    expect(findings).toHaveLength(2);

    const groups = groupFindings(findings);
    const candidates = applyThresholds(groups, {
      minSessions: 2,
      minOccurrences: 3,
      crossProjectMinProjects: 2,
    });

    // 1 session, 2 occurrences — below both thresholds
    expect(candidates).toHaveLength(0);
  });

  it("multiple applyPromotion calls append to same file", () => {
    const memoryPath = path.join(tmpDir, "MEMORY.md");

    applyPromotion(memoryPath, {
      action: "create",
      section: "## Session Learnings",
      entry: "- First rule",
      reason: "first",
    });

    applyPromotion(memoryPath, {
      action: "create",
      section: "## Session Learnings",
      entry: "- Second rule",
      reason: "second",
    });

    const content = fs.readFileSync(memoryPath, "utf-8");
    expect(content).toContain("- First rule");
    expect(content).toContain("- Second rule");
    // Section heading should appear only once
    const sectionCount = (content.match(/## Session Learnings/g) || []).length;
    expect(sectionCount).toBe(1);
  });
});
