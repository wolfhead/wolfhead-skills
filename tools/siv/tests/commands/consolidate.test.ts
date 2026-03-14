import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { executeConsolidate } from "../../src/commands/consolidate.js";
import { buildConsolidatePrompt, type ConsolidateWriterOutput } from "../../src/prompts/consolidate.js";

vi.mock("../../src/llm.js", () => ({
  callLLM: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { callLLM } from "../../src/llm.js";
import { loadConfig } from "../../src/config.js";

const mockedCallLLM = vi.mocked(callLLM);
const mockedLoadConfig = vi.mocked(loadConfig);

describe("buildConsolidatePrompt", () => {
  it("includes correct and incorrect examples in system prompt", () => {
    const { system } = buildConsolidatePrompt({
      rule: "test rule",
      category: "learning",
      scope: "project",
      existingRules: [],
      insightIds: ["INS-001"],
    });

    expect(system).toContain("<example>");
    expect(system).toContain("<correct-output>");
    expect(system).toContain("<incorrect-output");
  });
});

describe("executeConsolidate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-consolidate-exec-"));

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
        minSessions: 3,
        minOccurrences: 3,
        crossProjectMinProjects: 2,
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("create: appends to rules.jsonl and marks insights consolidated", async () => {
    const sivDir = path.join(tmpDir, ".siv");
    const insightsPath = path.join(sivDir, "insights.jsonl");
    fs.writeFileSync(
      insightsPath,
      JSON.stringify({ id: "INS-20260305-abc", status: "pending" }) + "\n",
      "utf-8"
    );

    mockedCallLLM.mockResolvedValue({
      result: {
        action: "create",
        entry: "Always read before write",
        reason: "new learning",
      } satisfies ConsolidateWriterOutput,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await executeConsolidate(
      {
        insightIds: ["INS-20260305-abc"],
        scope: "project",
        project: "project",
        projectPath: "/Users/me/work/project",
        category: "learning",
        rule: "Always read before write",
      },
      tmpDir
    );

    expect(result.action).toBe("create");
    expect(result.insight_ids).toEqual(["INS-20260305-abc"]);
    expect(result.entry).toBe("Always read before write");

    // Verify rule was appended to rules.jsonl
    const rulesPath = path.join(sivDir, "rules.jsonl");
    expect(fs.existsSync(rulesPath)).toBe(true);
    const ruleLine = fs.readFileSync(rulesPath, "utf-8").trim();
    const rule = JSON.parse(ruleLine);
    expect(rule.action_taken).toBe("create");
    expect(rule.status).toBe("active");
    expect(rule.id).toMatch(/^RUL-/);
    expect(rule.scope).toBe("project");

    // Verify insight was marked as consolidated
    const insightsContent = fs.readFileSync(insightsPath, "utf-8");
    expect(insightsContent).toContain('"consolidated"');
  });

  it("skip: no rules.jsonl entry, insights unchanged", async () => {
    const sivDir = path.join(tmpDir, ".siv");
    const insightsPath = path.join(sivDir, "insights.jsonl");
    fs.writeFileSync(
      insightsPath,
      JSON.stringify({ id: "INS-20260305-def", status: "pending" }) + "\n",
      "utf-8"
    );

    mockedCallLLM.mockResolvedValue({
      result: {
        action: "skip",
        entry: "",
        reason: "duplicate of existing rule",
      } satisfies ConsolidateWriterOutput,
      usage: { input_tokens: 100, output_tokens: 30 },
    });

    const result = await executeConsolidate(
      {
        insightIds: ["INS-20260305-def"],
        scope: "global",
        category: "learning",
        rule: "Already known rule",
      },
      tmpDir
    );

    expect(result.action).toBe("skip");

    // Verify no rules.jsonl entry
    const rulesPath = path.join(sivDir, "rules.jsonl");
    expect(fs.existsSync(rulesPath)).toBe(false);

    // Verify insight status unchanged
    const insightsContent = fs.readFileSync(insightsPath, "utf-8");
    expect(insightsContent).toContain('"pending"');
    expect(insightsContent).not.toContain('"consolidated"');
  });

  it("LLM receives existing active rules for dedup", async () => {
    const sivDir = path.join(tmpDir, ".siv");
    const insightsPath = path.join(sivDir, "insights.jsonl");
    fs.writeFileSync(
      insightsPath,
      JSON.stringify({ id: "INS-20260305-ghi", status: "pending" }) + "\n",
      "utf-8"
    );

    // Write an existing active rule
    const existingRule = {
      id: "RUL-20260305-aaa",
      ts: "2026-03-05T00:00:00Z",
      insight_ids: ["INS-20260305-old"],
      scope: "project",
      project: "project",
      project_path: "/Users/me/work/project",
      category: "learning",
      rule: "Existing rule about reading files",
      action_taken: "create",
      status: "active",
    };
    fs.writeFileSync(
      path.join(sivDir, "rules.jsonl"),
      JSON.stringify(existingRule) + "\n",
      "utf-8"
    );

    mockedCallLLM.mockResolvedValue({
      result: {
        action: "create",
        entry: "New unrelated rule",
        reason: "genuinely new",
      } satisfies ConsolidateWriterOutput,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await executeConsolidate(
      {
        insightIds: ["INS-20260305-ghi"],
        scope: "project",
        project: "project",
        projectPath: "/Users/me/work/project",
        category: "learning",
        rule: "New unrelated rule",
      },
      tmpDir
    );

    // Verify LLM was called with existing rules
    const callArgs = mockedCallLLM.mock.calls[0];
    const userPrompt = callArgs[2]; // system, user
    expect(userPrompt).toContain("RUL-20260305-aaa");
    expect(userPrompt).toContain("Existing rule about reading files");
  });

  it("merge: supersedes old rule and appends new one", async () => {
    const sivDir = path.join(tmpDir, ".siv");
    const insightsPath = path.join(sivDir, "insights.jsonl");
    fs.writeFileSync(
      insightsPath,
      JSON.stringify({ id: "INS-20260305-jkl", status: "pending" }) + "\n",
      "utf-8"
    );

    // Write existing rule to merge with
    const oldRule = {
      id: "RUL-20260305-bbb",
      ts: "2026-03-05T00:00:00Z",
      insight_ids: ["INS-20260305-old"],
      scope: "project",
      project: "project",
      project_path: "/Users/me/work/project",
      category: "learning",
      rule: "Partial rule",
      action_taken: "create",
      status: "active",
    };
    fs.writeFileSync(
      path.join(sivDir, "rules.jsonl"),
      JSON.stringify(oldRule) + "\n",
      "utf-8"
    );

    mockedCallLLM.mockResolvedValue({
      result: {
        action: "merge",
        entry: "Combined rule with more detail",
        reason: "overlapping rules merged",
        supersedes_ids: ["RUL-20260305-bbb"],
      } satisfies ConsolidateWriterOutput,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await executeConsolidate(
      {
        insightIds: ["INS-20260305-jkl"],
        scope: "project",
        project: "project",
        projectPath: "/Users/me/work/project",
        category: "learning",
        rule: "Additional detail about partial rule",
      },
      tmpDir
    );

    expect(result.action).toBe("merge");

    // Read rules.jsonl — should have 2 lines
    const rulesContent = fs.readFileSync(
      path.join(sivDir, "rules.jsonl"),
      "utf-8"
    );
    const lines = rulesContent.trim().split("\n");
    expect(lines).toHaveLength(2);

    // First line: old rule marked superseded
    const old = JSON.parse(lines[0]);
    expect(old.id).toBe("RUL-20260305-bbb");
    expect(old.status).toBe("superseded");

    // Second line: new active rule
    const newRule = JSON.parse(lines[1]);
    expect(newRule.status).toBe("active");
    expect(newRule.action_taken).toBe("merge");
    expect(newRule.rule).toBe("Combined rule with more detail");
  });
});
