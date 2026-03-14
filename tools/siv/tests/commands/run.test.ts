import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  buildGroupsFromInsights,
  executeRun,
} from "../../src/commands/run.js";
import type { Insight } from "../../src/types.js";

// ─── buildGroupsFromInsights (pure logic) ─────────────────────────────────

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "INS-20260305-abc",
    ts: new Date().toISOString(),
    category: "correction",
    summary: "test summary",
    details: "test details",
    priority: "medium",
    project: "test-project",
    project_path: "/Users/me/test-project",
    session: "session-1",
    tags: [],
    related_files: [],
    source: "analyze",
    status: "pending",
    ...overrides,
  };
}

describe("buildGroupsFromInsights", () => {
  it("groups insights by group field", () => {
    const insights = [
      makeInsight({ id: "INS-1", group: "read_before_write" }),
      makeInsight({ id: "INS-2", group: "read_before_write" }),
      makeInsight({ id: "INS-3", group: "check_existence" }),
      makeInsight({ id: "INS-4", group: "check_existence" }),
    ];

    const groups = buildGroupsFromInsights(insights);

    expect(groups).toHaveLength(2);
    const ids = groups.map((g) => g.insights.map((f) => f.id));
    expect(ids).toContainEqual(["INS-1", "INS-2"]);
    expect(ids).toContainEqual(["INS-3", "INS-4"]);
  });

  it("excludes groups with fewer than 2 insights", () => {
    const insights = [
      makeInsight({ id: "INS-1", group: "read_before_write" }),
      makeInsight({ id: "INS-2", group: "read_before_write" }),
      makeInsight({ id: "INS-3", group: "singleton" }),
    ];

    const groups = buildGroupsFromInsights(insights);

    expect(groups).toHaveLength(1);
    expect(groups[0].insights.map((f) => f.id)).toEqual(["INS-1", "INS-2"]);
  });

  it("skips insights without a group field", () => {
    const insights = [
      makeInsight({ id: "INS-1", group: "read_before_write" }),
      makeInsight({ id: "INS-2", group: "read_before_write" }),
      makeInsight({ id: "INS-3" }), // no group
    ];

    const groups = buildGroupsFromInsights(insights);

    expect(groups).toHaveLength(1);
    expect(groups[0].insights).toHaveLength(2);
  });

  it("returns empty when all groups are singletons", () => {
    const insights = [
      makeInsight({ id: "INS-1", group: "a" }),
      makeInsight({ id: "INS-2", group: "b" }),
      makeInsight({ id: "INS-3", group: "c" }),
    ];

    const groups = buildGroupsFromInsights(insights);

    expect(groups).toHaveLength(0);
  });

  it("respects custom minSize", () => {
    const insights = [
      makeInsight({ id: "INS-1", group: "a" }),
      makeInsight({ id: "INS-2", group: "a" }),
      makeInsight({ id: "INS-3", group: "a" }),
      makeInsight({ id: "INS-4", group: "b" }),
      makeInsight({ id: "INS-5", group: "b" }),
    ];

    const groups = buildGroupsFromInsights(insights, 3);

    expect(groups).toHaveLength(1);
    expect(groups[0].insights).toHaveLength(3);
  });
});

// ─── executeRun (mock LLM + storage) ─────────────────────────────

vi.mock("../../src/llm.js", () => ({
  callLLM: vi.fn(),
  getConsolidateConfig: vi.fn((config: unknown) => config),
}));

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

// Mock executeConsolidate to avoid nested LLM calls
vi.mock("../../src/commands/consolidate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/consolidate.js")>();
  return {
    ...actual,
    executeConsolidate: vi.fn(),
  };
});

// Mock executeGroup to avoid LLM calls for grouping
vi.mock("../../src/commands/group.js", () => ({
  executeGroup: vi.fn(),
}));

import { callLLM } from "../../src/llm.js";
import { loadConfig } from "../../src/config.js";
import { executeConsolidate } from "../../src/commands/consolidate.js";

const mockedCallLLM = vi.mocked(callLLM);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedExecuteConsolidate = vi.mocked(executeConsolidate);

describe("executeRun", () => {
  let tmpDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-run-test-"));
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
      promotionScoreThreshold: 6,
    });

    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeInsight(insight: Insight): void {
    const sivDir = path.join(tmpDir, ".siv");
    fs.appendFileSync(
      path.join(sivDir, "insights.jsonl"),
      JSON.stringify(insight) + "\n",
      "utf-8"
    );
  }

  it("prints 'nothing' when no pending insights", async () => {
    await executeRun({}, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Nothing to consolidate.");
  });

  it("prints 'nothing' when no groups with 2+ and score below threshold", async () => {
    // best_practice + medium = score 2, below threshold 6
    writeInsight(makeInsight({
      id: "INS-1",
      group: "solo_group",
      category: "best_practice",
      priority: "medium",
    }));

    await executeRun({ window: 30 }, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Nothing to consolidate.");
  });

  it("dry run prints candidates without calling distill LLM", async () => {
    writeInsight(makeInsight({ id: "INS-1", group: "read_before_write" }));
    writeInsight(makeInsight({ id: "INS-2", group: "read_before_write" }));

    await executeRun({ dryRun: true, window: 30 }, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Candidates for consolidation:");
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("full flow: distills groups then consolidates", async () => {
    writeInsight(makeInsight({ id: "INS-1", group: "read_before_write", project: "proj" }));
    writeInsight(makeInsight({ id: "INS-2", group: "read_before_write", project: "proj" }));

    // Mock distill LLM
    mockedCallLLM.mockResolvedValue({
      result: {
        rules: [
          {
            insight_ids: ["INS-1", "INS-2"],
            scope: "project" as const,
            project: "proj",
            project_path: "/Users/me/test-project",
            category: "correction",
            rule: "Always read before write",
          },
        ],
      },
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    mockedExecuteConsolidate.mockResolvedValue({
      action: "create",
      entry: "Always read before write",
      reason: "new rule",
      insight_ids: ["INS-1", "INS-2"],
    });

    await executeRun({ window: 30 }, tmpDir);

    // Verify distill LLM was called
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);

    // Verify executeConsolidate was called with distilled rule
    expect(mockedExecuteConsolidate).toHaveBeenCalledTimes(1);
    expect(mockedExecuteConsolidate).toHaveBeenCalledWith(
      expect.objectContaining({
        insightIds: ["INS-1", "INS-2"],
        rule: "Always read before write",
      }),
      tmpDir,
      expect.anything()
    );

    // Verify summary
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Consolidation complete: 1 rules consolidated")
    );
  });

  it("consolidates high-score singleton (correction + high = 9)", async () => {
    writeInsight(makeInsight({
      id: "INS-1",
      group: "get_approval_first",
      category: "correction",
      priority: "high",
      project: "proj",
    }));

    // Mock distill LLM
    mockedCallLLM.mockResolvedValue({
      result: {
        rules: [
          {
            insight_ids: ["INS-1"],
            scope: "project" as const,
            project: "proj",
            project_path: "/Users/me/test-project",
            category: "correction",
            rule: "Always ask before implementing",
          },
        ],
      },
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    mockedExecuteConsolidate.mockResolvedValue({
      action: "create",
      entry: "Always ask before implementing",
      reason: "high-score singleton",
      insight_ids: ["INS-1"],
    });

    await executeRun({ window: 30 }, tmpDir);

    expect(mockedExecuteConsolidate).toHaveBeenCalledWith(
      expect.objectContaining({
        insightIds: ["INS-1"],
        rule: "Always ask before implementing",
      }),
      tmpDir,
      expect.anything()
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Consolidation complete: 1 rules consolidated")
    );
  });

  it("dry run shows both group and score candidates", async () => {
    // Group candidate (2 insights)
    writeInsight(makeInsight({ id: "INS-1", group: "read_before_write" }));
    writeInsight(makeInsight({ id: "INS-2", group: "read_before_write" }));
    // Score candidate (singleton, correction + high = 9)
    writeInsight(makeInsight({
      id: "INS-3",
      group: "get_approval",
      category: "correction",
      priority: "high",
    }));

    await executeRun({ dryRun: true, window: 30 }, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Candidates for consolidation:");
    // Should show group candidate
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[group: read_before_write]")
    );
    // Should show score candidate
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[score: 9]")
    );
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });
});
