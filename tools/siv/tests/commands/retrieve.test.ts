import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { executeRetrieve } from "../../src/commands/retrieve.js";

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from "../../src/config.js";

const mockedLoadConfig = vi.mocked(loadConfig);

function makeRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "RUL-20260305-aaa",
    ts: "2026-03-05T00:00:00Z",
    insight_ids: ["INS-20260305-abc"],
    scope: "project",
    project: "test-project",
    project_path: "/Users/me/work/project",
    category: "learning",
    rule: "Always read before write",
    action_taken: "create",
    status: "active",
    ...overrides,
  };
}

describe("executeRetrieve", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-retrieve-test-"));
    const sivDir = path.join(tmpDir, ".siv");
    fs.mkdirSync(sivDir, { recursive: true });

    mockedLoadConfig.mockReturnValue({
      sivDir,
      apiKey: "test-key",
      apiBase: "https://api.test.com",
      model: "test-model",
      insightsPath: path.join(sivDir, "insights.jsonl"),
      rulesPath: path.join(sivDir, "rules.jsonl"),
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

  function writeRule(rule: Record<string, unknown>): void {
    const sivDir = path.join(tmpDir, ".siv");
    fs.appendFileSync(
      path.join(sivDir, "rules.jsonl"),
      JSON.stringify(rule) + "\n",
      "utf-8"
    );
  }

  it("reads project rules from rules.jsonl", () => {
    writeRule(makeRule());

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "text" },
      tmpDir
    );

    expect(result).toContain("Always read before write");
    expect(result).toContain("## learning");
  });

  it("reads global rules", () => {
    writeRule(makeRule({ scope: "global", project_path: "" }));

    const result = executeRetrieve(
      { global: true, format: "text" },
      tmpDir
    );

    expect(result).toContain("Always read before write");
  });

  it("filters by project path", () => {
    writeRule(makeRule({ project_path: "/Users/me/work/project" }));
    writeRule(makeRule({ id: "RUL-20260305-bbb", project_path: "/Users/me/work/other" }));

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "text" },
      tmpDir
    );

    expect(result).toContain("Always read before write");
    // Only one rule should match
    const bulletCount = (result.match(/^- /gm) || []).length;
    expect(bulletCount).toBe(1);
  });

  it("excludes superseded rules", () => {
    writeRule(makeRule({ status: "superseded", rule: "Old rule" }));
    writeRule(makeRule({ id: "RUL-20260305-bbb", rule: "New rule" }));

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "text" },
      tmpDir
    );

    expect(result).not.toContain("Old rule");
    expect(result).toContain("New rule");
  });

  it("includes both project and global rules", () => {
    writeRule(makeRule({ rule: "Project rule" }));
    writeRule(
      makeRule({
        id: "RUL-20260305-bbb",
        scope: "global",
        project_path: "",
        rule: "Global rule",
      })
    );

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: true, format: "text" },
      tmpDir
    );

    expect(result).toContain("Project rule");
    expect(result).toContain("Global rule");
  });

  it("returns empty string when no rules exist", () => {
    const result = executeRetrieve(
      { projectPath: "/Users/me/nonexistent", global: false, format: "text" },
      tmpDir
    );

    expect(result).toBe("");
  });

  it("returns empty string when rules.jsonl missing", () => {
    // Don't write any rules file
    const sivDir = path.join(tmpDir, ".siv");
    const rulesPath = path.join(sivDir, "rules.jsonl");
    if (fs.existsSync(rulesPath)) {
      fs.unlinkSync(rulesPath);
    }

    const result = executeRetrieve(
      { global: true, format: "text" },
      tmpDir
    );

    expect(result).toBe("");
  });

  it("returns JSON format with rule details", () => {
    writeRule(makeRule());

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "json" },
      tmpDir
    );

    const parsed = JSON.parse(result);
    expect(parsed.project).toBe("/Users/me/work/project");
    expect(parsed.global).toBe(false);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0].id).toBe("RUL-20260305-aaa");
    expect(parsed.rules[0].rule).toBe("Always read before write");
  });

  it("returns JSON with null project when no projectPath", () => {
    const result = executeRetrieve(
      { global: true, format: "json" },
      tmpDir
    );

    const parsed = JSON.parse(result);
    expect(parsed.project).toBeNull();
    expect(parsed.rules).toHaveLength(0);
  });

  it("groups by category in text format", () => {
    writeRule(makeRule({ category: "learning", rule: "Learn this" }));
    writeRule(
      makeRule({
        id: "RUL-20260305-bbb",
        category: "error",
        rule: "Avoid that",
      })
    );

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "text" },
      tmpDir
    );

    expect(result).toContain("## learning");
    expect(result).toContain("## error");
    expect(result).toContain("- Learn this");
    expect(result).toContain("- Avoid that");
  });

  it("only reads project when global is false", () => {
    writeRule(makeRule({ rule: "Project rule" }));
    writeRule(
      makeRule({
        id: "RUL-20260305-bbb",
        scope: "global",
        project_path: "",
        rule: "Global rule",
      })
    );

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "text" },
      tmpDir
    );

    expect(result).toContain("Project rule");
    expect(result).not.toContain("Global rule");
  });
});
