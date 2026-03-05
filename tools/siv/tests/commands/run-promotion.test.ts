import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  groupFindings,
  applyThresholds,
  executeRunPromotion,
} from "../../src/commands/run-promotion.js";
import type { Finding } from "../../src/types.js";

// ─── groupFindings (pure logic) ───────────────────────────────────────────

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

describe("groupFindings", () => {
  it("groups by project + category", () => {
    const findings = [
      makeFinding({ id: "LRN-1", project: "proj-a", category: "correction" }),
      makeFinding({ id: "LRN-2", project: "proj-a", category: "error" }),
      makeFinding({ id: "LRN-3", project: "proj-b", category: "correction" }),
    ];

    const groups = groupFindings(findings);

    expect(groups).toHaveLength(3);
    expect(groups.map((g) => `${g.project}::${g.category}`).sort()).toEqual([
      "proj-a::correction",
      "proj-a::error",
      "proj-b::correction",
    ]);
  });

  it("puts multiple findings in same group", () => {
    const findings = [
      makeFinding({ id: "LRN-1", project: "proj-a", category: "correction", session: "s1" }),
      makeFinding({ id: "LRN-2", project: "proj-a", category: "correction", session: "s2" }),
      makeFinding({ id: "LRN-3", project: "proj-a", category: "correction", session: "s3" }),
    ];

    const groups = groupFindings(findings);

    expect(groups).toHaveLength(1);
    expect(groups[0].findings).toHaveLength(3);
    expect(groups[0].findings.map((f) => f.id)).toEqual(["LRN-1", "LRN-2", "LRN-3"]);
  });
});

// ─── applyThresholds ──────────────────────────────────────────────────────

describe("applyThresholds", () => {
  const thresholds = {
    minSessions: 2,
    minOccurrences: 3,
    crossProjectMinProjects: 2,
  };

  it("passes with 2+ unique sessions", () => {
    const findings = [
      makeFinding({ id: "LRN-1", session: "s1" }),
      makeFinding({ id: "LRN-2", session: "s2" }),
    ];
    const groups = groupFindings(findings);
    const result = applyThresholds(groups, thresholds);

    expect(result).toHaveLength(1);
  });

  it("passes with 3+ occurrences from 1 session", () => {
    const findings = [
      makeFinding({ id: "LRN-1", session: "s1" }),
      makeFinding({ id: "LRN-2", session: "s1" }),
      makeFinding({ id: "LRN-3", session: "s1" }),
    ];
    const groups = groupFindings(findings);
    const result = applyThresholds(groups, thresholds);

    expect(result).toHaveLength(1);
  });

  it("rejects below threshold", () => {
    const findings = [
      makeFinding({ id: "LRN-1", session: "s1" }),
    ];
    const groups = groupFindings(findings);
    const result = applyThresholds(groups, thresholds);

    expect(result).toHaveLength(0);
  });

  it("rejects 2 findings from 1 session", () => {
    const findings = [
      makeFinding({ id: "LRN-1", session: "s1" }),
      makeFinding({ id: "LRN-2", session: "s1" }),
    ];
    const groups = groupFindings(findings);
    const result = applyThresholds(groups, thresholds);

    expect(result).toHaveLength(0);
  });
});

// ─── executeRunPromotion (mock LLM + storage) ─────────────────────────────

vi.mock("../../src/llm.js", () => ({
  callLLM: vi.fn(),
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

  it("prints 'nothing' when findings below threshold", async () => {
    writeFinding(makeFinding({ id: "LRN-1", session: "s1" }));

    await executeRunPromotion({ window: 30 }, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Nothing to promote.");
  });

  it("dry run prints candidates without calling LLM", async () => {
    writeFinding(makeFinding({ id: "LRN-1", session: "s1" }));
    writeFinding(makeFinding({ id: "LRN-2", session: "s2" }));

    await executeRunPromotion({ dryRun: true, window: 30 }, tmpDir);

    expect(consoleSpy).toHaveBeenCalledWith("Candidates for promotion:");
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("full flow calls LLM and promotes", async () => {
    writeFinding(makeFinding({ id: "LRN-1", session: "s1", project: "proj" }));
    writeFinding(makeFinding({ id: "LRN-2", session: "s2", project: "proj" }));

    mockedCallLLM.mockResolvedValue({
      result: {
        promotions: [
          {
            finding_ids: ["LRN-1", "LRN-2"],
            scope: "project" as const,
            project: "proj",
            project_path: "/Users/me/test-project",
            category: "correction",
            rule: "Always check before acting",
          },
        ],
      },
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    mockedExecutePromoteFinding.mockResolvedValue({
      action: "create",
      target_file: "/tmp/MEMORY.md",
      entry: "- Always check before acting",
      reason: "new rule",
      finding_ids: ["LRN-1", "LRN-2"],
    });

    await executeRunPromotion({ window: 30 }, tmpDir);

    // Verify distill LLM was called
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);

    // Verify executePromoteFinding was called
    expect(mockedExecutePromoteFinding).toHaveBeenCalledTimes(1);
    expect(mockedExecutePromoteFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        findingIds: ["LRN-1", "LRN-2"],
        rule: "Always check before acting",
      }),
      tmpDir
    );

    // Verify summary was printed
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Promotion complete: 1 rules promoted")
    );
  });
});
