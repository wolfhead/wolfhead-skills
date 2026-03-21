import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const mockCallLLM = vi.fn();
vi.mock("../../src/llm.js", () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
  getConsolidateConfig: (config: unknown) => config,
}));

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from "../../src/config.js";
import { executeGroup } from "../../src/commands/group.js";
import type { Insight } from "../../src/types.js";
import type { GroupEntry } from "../../src/storage.js";

const mockedLoadConfig = vi.mocked(loadConfig);

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "INS-20260321-abc",
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

describe("executeGroup", () => {
  let tmpDir: string;
  let insightsPath: string;
  let groupsPath: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-group-test-"));
    const sivDir = path.join(tmpDir, ".siv");
    fs.mkdirSync(sivDir, { recursive: true });
    insightsPath = path.join(sivDir, "insights.jsonl");
    groupsPath = path.join(sivDir, "groups.jsonl");

    mockedLoadConfig.mockReturnValue({
      sivDir,
      apiKey: "test-key",
      apiBase: "https://api.test.com",
      model: "test-model",
      scansPath: path.join(sivDir, "scans.jsonl"),
      insightsPath,
      rulesPath: path.join(sivDir, "rules.jsonl"),
      groupsPath,
      backupsDir: path.join(sivDir, "backups"),
      promotionThreshold: { minSessions: 2, minOccurrences: 3, crossProjectMinProjects: 2 },
      promotionScoreThreshold: 6,
    });

    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeInsight(insight: Insight): void {
    fs.appendFileSync(insightsPath, JSON.stringify(insight) + "\n", "utf-8");
  }

  function writeGroup(group: GroupEntry): void {
    fs.appendFileSync(groupsPath, JSON.stringify(group) + "\n", "utf-8");
  }

  it("assigns new insights to groups and updates groups.jsonl", async () => {
    writeInsight(makeInsight({ id: "INS-1", summary: "ask user before coding" }));
    writeInsight(makeInsight({ id: "INS-2", summary: "get approval before implementing" }));

    mockCallLLM.mockResolvedValue({
      result: {
        assignments: [
          { insight_id: "INS-1", label: "ask_before_coding", is_new: true, merged_summary: "Ask user before writing code" },
          { insight_id: "INS-2", label: "ask_before_coding", is_new: false, merged_summary: "Present approach and get approval before writing code" },
        ],
      },
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await executeGroup({ yes: true }, tmpDir);

    // Check insights got group labels
    const insights = fs.readFileSync(insightsPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(insights[0].group).toBe("ask_before_coding");
    expect(insights[1].group).toBe("ask_before_coding");

    // Check groups.jsonl was written
    const groups = fs.readFileSync(groupsPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("ask_before_coding");
    expect(groups[0].count).toBe(2);
    expect(groups[0].insight_ids).toEqual(["INS-1", "INS-2"]);
  });

  it("passes existing groups to the LLM prompt", async () => {
    // Pre-existing group
    writeGroup({
      label: "ask_before_coding",
      merged_summary: "Ask user before writing code",
      insight_ids: ["INS-OLD"],
      count: 1,
    });
    // Pre-existing insight (already grouped)
    writeInsight(makeInsight({ id: "INS-OLD", group: "ask_before_coding" }));
    // New ungrouped insight
    writeInsight(makeInsight({ id: "INS-NEW", summary: "get approval first" }));

    mockCallLLM.mockResolvedValue({
      result: {
        assignments: [
          { insight_id: "INS-NEW", label: "ask_before_coding", is_new: false, merged_summary: "Present approach and get approval before writing code" },
        ],
      },
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    await executeGroup({ yes: true }, tmpDir);

    // LLM should have been called with only the ungrouped insight
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const [, , userPrompt] = mockCallLLM.mock.calls[0];
    expect(userPrompt).toContain("INS-NEW");
    expect(userPrompt).not.toContain("INS-OLD");
    // Existing group should be in context
    expect(userPrompt).toContain("ask_before_coding");

    // groups.jsonl should be updated
    const groups = fs.readFileSync(groupsPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const g = groups.find((g: GroupEntry) => g.label === "ask_before_coding");
    expect(g.count).toBe(2);
    expect(g.insight_ids).toContain("INS-OLD");
    expect(g.insight_ids).toContain("INS-NEW");
  });

  it("skips when no ungrouped insights", async () => {
    writeInsight(makeInsight({ id: "INS-1", group: "existing_group" }));

    await executeGroup({ yes: true }, tmpDir);

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No ungrouped insights"));
  });

  it("processes in batches of BATCH_SIZE", async () => {
    // Write 15 insights — should result in 2 batches (10 + 5)
    for (let i = 1; i <= 15; i++) {
      writeInsight(makeInsight({ id: `INS-${i}`, summary: `insight ${i}` }));
    }

    // First batch: 10 insights
    mockCallLLM.mockResolvedValueOnce({
      result: {
        assignments: Array.from({ length: 10 }, (_, i) => ({
          insight_id: `INS-${i + 1}`,
          label: `group_${(i % 3) + 1}`,
          is_new: i < 3,
          merged_summary: `Summary for group ${(i % 3) + 1}`,
        })),
      },
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    // Second batch: 5 insights, with existing groups from first batch
    mockCallLLM.mockResolvedValueOnce({
      result: {
        assignments: Array.from({ length: 5 }, (_, i) => ({
          insight_id: `INS-${i + 11}`,
          label: `group_${(i % 3) + 1}`,
          is_new: false,
          merged_summary: `Updated summary for group ${(i % 3) + 1}`,
        })),
      },
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    await executeGroup({ yes: true }, tmpDir);

    expect(mockCallLLM).toHaveBeenCalledTimes(2);

    // Second call should include existing groups from first batch
    const [, , secondUserPrompt] = mockCallLLM.mock.calls[1];
    expect(secondUserPrompt).toContain("group_1");
    expect(secondUserPrompt).toContain("group_2");
    expect(secondUserPrompt).toContain("group_3");
  });
});
