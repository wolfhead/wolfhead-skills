import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  buildGroupsFromFindings,
  executeRunPromotion,
} from "../../src/commands/run-promotion.js";
import type { Finding } from "../../src/types.js";

// ─── buildGroupsFromFindings (pure logic) ─────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "LRN-20260305-abc",
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

describe("buildGroupsFromFindings", () => {
  it("groups findings by group field", () => {
    const findings = [
      makeFinding({ id: "LRN-1", group: "read_before_write" }),
      makeFinding({ id: "LRN-2", group: "read_before_write" }),
      makeFinding({ id: "LRN-3", group: "check_existence" }),
      makeFinding({ id: "LRN-4", group: "check_existence" }),
    ];

    const groups = buildGroupsFromFindings(findings);

    expect(groups).toHaveLength(2);
    const ids = groups.map((g) => g.findings.map((f) => f.id));
    expect(ids).toContainEqual(["LRN-1", "LRN-2"]);
    expect(ids).toContainEqual(["LRN-3", "LRN-4"]);
  });

  it("excludes groups with fewer than 2 findings", () => {
    const findings = [
      makeFinding({ id: "LRN-1", group: "read_before_write" }),
      makeFinding({ id: "LRN-2", group: "read_before_write" }),
      makeFinding({ id: "LRN-3", group: "singleton" }),
    ];

    const groups = buildGroupsFromFindings(findings);

    expect(groups).toHaveLength(1);
    expect(groups[0].findings.map((f) => f.id)).toEqual(["LRN-1", "LRN-2"]);
  });

  it("skips findings without a group field", () => {
    const findings = [
      makeFinding({ id: "LRN-1", group: "read_before_write" }),
      makeFinding({ id: "LRN-2", group: "read_before_write" }),
      makeFinding({ id: "LRN-3" }), // no group
    ];

    const groups = buildGroupsFromFindings(findings);

    expect(groups).toHaveLength(1);
    expect(groups[0].findings).toHaveLength(2);
  });

  it("returns empty when all groups are singletons", () => {
    const findings = [
      makeFinding({ id: "LRN-1", group: "a" }),
      makeFinding({ id: "LRN-2", group: "b" }),
      makeFinding({ id: "LRN-3", group: "c" }),
    ];

    const groups = buildGroupsFromFindings(findings);

    expect(groups).toHaveLength(0);
  });

  it("respects custom minSize", () => {
    const findings = [
      makeFinding({ id: "LRN-1", group: "a" }),
      makeFinding({ id: "LRN-2", group: "a" }),
      makeFinding({ id: "LRN-3", group: "a" }),
      makeFinding({ id: "LRN-4", group: "b" }),
      makeFinding({ id: "LRN-5", group: "b" }),
    ];

    const groups = buildGroupsFromFindings(findings, 3);

    expect(groups).toHaveLength(1);
    expect(groups[0].findings).toHaveLength(3);
  });
});

// ─── executeRunPromotion (mock LLM + storage) ─────────────────────────────

vi.mock("../../src/llm.js", () => ({
  callLLM: vi.fn(),
  getPromoteConfig: vi.fn((config: unknown) => config),
}));

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

// Mock executePromoteFinding to avoid nested LLM calls
vi.mock("../../src/commands/promote-finding.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/promote-finding.js")>();
  return {
    ...actual,
    executePromoteFinding: vi.fn(),
  };
});

// Mock executeGroup to avoid LLM calls for grouping
vi.mock("../../src/commands/group.js", () => ({
  executeGroup: vi.fn(),
}));

import { callLLM } from "../../src/llm.js";
import { loadConfig } from "../../src/config.js";
import { executePromoteFinding } from "../../src/commands/promote-finding.js";

const mockedCallLLM = vi.mocked(callLLM);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedExecutePromoteFinding = vi.mocked(executePromoteFinding);

describe("executeRunPromotion", () => {
  let tmpDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-run-promo-test-"));
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
      promotionScoreThreshold: 6,
    });

    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeFinding(finding: Finding): void {
    const sivDir = path.join(tmpDir, ".siv");
    fs.appendFileSync(
      path.join(sivDir, "findings.jsonl"),
      JSON.stringify(finding) + "\n",
      "utf-8"
    );
  }

  it("prints 'nothing' when no pending findings", async () => {
    await executeRunPromotion({}, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Nothing to promote.");
  });

  it("prints 'nothing' when no groups with 2+ and score below threshold", async () => {
    // best_practice + medium = score 2, below threshold 6
    writeFinding(makeFinding({
      id: "LRN-1",
      group: "solo_group",
      category: "best_practice",
      priority: "medium",
    }));

    await executeRunPromotion({ window: 30 }, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Nothing to promote.");
  });

  it("dry run prints candidates without calling distill LLM", async () => {
    writeFinding(makeFinding({ id: "LRN-1", group: "read_before_write" }));
    writeFinding(makeFinding({ id: "LRN-2", group: "read_before_write" }));

    await executeRunPromotion({ dryRun: true, window: 30 }, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Candidates for promotion:");
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("full flow: distills groups then promotes", async () => {
    writeFinding(makeFinding({ id: "LRN-1", group: "read_before_write", project: "proj" }));
    writeFinding(makeFinding({ id: "LRN-2", group: "read_before_write", project: "proj" }));

    // Mock distill LLM
    mockedCallLLM.mockResolvedValue({
      result: {
        promotions: [
          {
            finding_ids: ["LRN-1", "LRN-2"],
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

    mockedExecutePromoteFinding.mockResolvedValue({
      action: "create",
      entry: "Always read before write",
      reason: "new rule",
      finding_ids: ["LRN-1", "LRN-2"],
    });

    await executeRunPromotion({ window: 30 }, tmpDir);

    // Verify distill LLM was called
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);

    // Verify executePromoteFinding was called with distilled rule
    expect(mockedExecutePromoteFinding).toHaveBeenCalledTimes(1);
    expect(mockedExecutePromoteFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        findingIds: ["LRN-1", "LRN-2"],
        rule: "Always read before write",
      }),
      tmpDir,
      expect.anything()
    );

    // Verify summary
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Promotion complete: 1 rules promoted")
    );
  });

  it("promotes high-score singleton (correction + high = 9)", async () => {
    writeFinding(makeFinding({
      id: "LRN-1",
      group: "get_approval_first",
      category: "correction",
      priority: "high",
      project: "proj",
    }));

    // Mock distill LLM
    mockedCallLLM.mockResolvedValue({
      result: {
        promotions: [
          {
            finding_ids: ["LRN-1"],
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

    mockedExecutePromoteFinding.mockResolvedValue({
      action: "create",
      entry: "Always ask before implementing",
      reason: "high-score singleton",
      finding_ids: ["LRN-1"],
    });

    await executeRunPromotion({ window: 30 }, tmpDir);

    expect(mockedExecutePromoteFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        findingIds: ["LRN-1"],
        rule: "Always ask before implementing",
      }),
      tmpDir,
      expect.anything()
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Promotion complete: 1 rules promoted")
    );
  });

  it("dry run shows both group and score candidates", async () => {
    // Group candidate (2 findings)
    writeFinding(makeFinding({ id: "LRN-1", group: "read_before_write" }));
    writeFinding(makeFinding({ id: "LRN-2", group: "read_before_write" }));
    // Score candidate (singleton, correction + high = 9)
    writeFinding(makeFinding({
      id: "LRN-3",
      group: "get_approval",
      category: "correction",
      priority: "high",
    }));

    await executeRunPromotion({ dryRun: true, window: 30 }, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Candidates for promotion:");
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
