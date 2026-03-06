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

function makePromotion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "PRM-20260305-aaa",
    ts: "2026-03-05T00:00:00Z",
    finding_ids: ["LRN-20260305-abc"],
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
      findingsPath: path.join(sivDir, "findings.jsonl"),
      promotionsPath: path.join(sivDir, "promotions.jsonl"),
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

  function writePromotion(promo: Record<string, unknown>): void {
    const sivDir = path.join(tmpDir, ".siv");
    fs.appendFileSync(
      path.join(sivDir, "promotions.jsonl"),
      JSON.stringify(promo) + "\n",
      "utf-8"
    );
  }

  it("reads project promotions from promotions.jsonl", () => {
    writePromotion(makePromotion());

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "text" },
      tmpDir
    );

    expect(result).toContain("Always read before write");
    expect(result).toContain("## learning");
  });

  it("reads global promotions", () => {
    writePromotion(makePromotion({ scope: "global", project_path: "" }));

    const result = executeRetrieve(
      { global: true, format: "text" },
      tmpDir
    );

    expect(result).toContain("Always read before write");
  });

  it("filters by project path", () => {
    writePromotion(makePromotion({ project_path: "/Users/me/work/project" }));
    writePromotion(makePromotion({ id: "PRM-20260305-bbb", project_path: "/Users/me/work/other" }));

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "text" },
      tmpDir
    );

    expect(result).toContain("Always read before write");
    // Only one promotion should match
    const bulletCount = (result.match(/^- /gm) || []).length;
    expect(bulletCount).toBe(1);
  });

  it("excludes superseded promotions", () => {
    writePromotion(makePromotion({ status: "superseded", rule: "Old rule" }));
    writePromotion(makePromotion({ id: "PRM-20260305-bbb", rule: "New rule" }));

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "text" },
      tmpDir
    );

    expect(result).not.toContain("Old rule");
    expect(result).toContain("New rule");
  });

  it("includes both project and global promotions", () => {
    writePromotion(makePromotion({ rule: "Project rule" }));
    writePromotion(
      makePromotion({
        id: "PRM-20260305-bbb",
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

  it("returns empty string when no promotions exist", () => {
    const result = executeRetrieve(
      { projectPath: "/Users/me/nonexistent", global: false, format: "text" },
      tmpDir
    );

    expect(result).toBe("");
  });

  it("returns empty string when promotions.jsonl missing", () => {
    // Don't write any promotions file
    const sivDir = path.join(tmpDir, ".siv");
    const promotionsPath = path.join(sivDir, "promotions.jsonl");
    if (fs.existsSync(promotionsPath)) {
      fs.unlinkSync(promotionsPath);
    }

    const result = executeRetrieve(
      { global: true, format: "text" },
      tmpDir
    );

    expect(result).toBe("");
  });

  it("returns JSON format with promotion details", () => {
    writePromotion(makePromotion());

    const result = executeRetrieve(
      { projectPath: "/Users/me/work/project", global: false, format: "json" },
      tmpDir
    );

    const parsed = JSON.parse(result);
    expect(parsed.project).toBe("/Users/me/work/project");
    expect(parsed.global).toBe(false);
    expect(parsed.promotions).toHaveLength(1);
    expect(parsed.promotions[0].id).toBe("PRM-20260305-aaa");
    expect(parsed.promotions[0].rule).toBe("Always read before write");
  });

  it("returns JSON with null project when no projectPath", () => {
    const result = executeRetrieve(
      { global: true, format: "json" },
      tmpDir
    );

    const parsed = JSON.parse(result);
    expect(parsed.project).toBeNull();
    expect(parsed.promotions).toHaveLength(0);
  });

  it("groups by category in text format", () => {
    writePromotion(makePromotion({ category: "learning", rule: "Learn this" }));
    writePromotion(
      makePromotion({
        id: "PRM-20260305-bbb",
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
    writePromotion(makePromotion({ rule: "Project rule" }));
    writePromotion(
      makePromotion({
        id: "PRM-20260305-bbb",
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
