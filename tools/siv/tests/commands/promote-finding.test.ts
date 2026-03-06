import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { executePromoteFinding } from "../../src/commands/promote-finding.js";
import { buildPromotePrompt, type PromoteWriterOutput } from "../../src/prompts/promote.js";

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

describe("buildPromotePrompt", () => {
  it("includes correct and incorrect examples in system prompt", () => {
    const { system } = buildPromotePrompt({
      rule: "test rule",
      category: "learning",
      scope: "project",
      existingPromotions: [],
      findingIds: ["LRN-001"],
    });

    expect(system).toContain("<example>");
    expect(system).toContain("<correct-output>");
    expect(system).toContain("<incorrect-output");
  });
});

describe("executePromoteFinding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-promote-exec-"));

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

  it("create: appends to promotions.jsonl and marks findings promoted", async () => {
    const sivDir = path.join(tmpDir, ".siv");
    const findingsPath = path.join(sivDir, "findings.jsonl");
    fs.writeFileSync(
      findingsPath,
      JSON.stringify({ id: "LRN-20260305-abc", status: "pending" }) + "\n",
      "utf-8"
    );

    mockedCallLLM.mockResolvedValue({
      result: {
        action: "create",
        entry: "Always read before write",
        reason: "new learning",
      } satisfies PromoteWriterOutput,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await executePromoteFinding(
      {
        findingIds: ["LRN-20260305-abc"],
        scope: "project",
        project: "project",
        projectPath: "/Users/me/work/project",
        category: "learning",
        rule: "Always read before write",
      },
      tmpDir
    );

    expect(result.action).toBe("create");
    expect(result.finding_ids).toEqual(["LRN-20260305-abc"]);
    expect(result.entry).toBe("Always read before write");

    // Verify promotion was appended to promotions.jsonl
    const promotionsPath = path.join(sivDir, "promotions.jsonl");
    expect(fs.existsSync(promotionsPath)).toBe(true);
    const promotionLine = fs.readFileSync(promotionsPath, "utf-8").trim();
    const promotion = JSON.parse(promotionLine);
    expect(promotion.action_taken).toBe("create");
    expect(promotion.status).toBe("active");
    expect(promotion.id).toMatch(/^PRM-/);
    expect(promotion.scope).toBe("project");

    // Verify finding was marked as promoted
    const findingsContent = fs.readFileSync(findingsPath, "utf-8");
    expect(findingsContent).toContain('"promoted"');
  });

  it("skip: no promotions.jsonl entry, findings unchanged", async () => {
    const sivDir = path.join(tmpDir, ".siv");
    const findingsPath = path.join(sivDir, "findings.jsonl");
    fs.writeFileSync(
      findingsPath,
      JSON.stringify({ id: "LRN-20260305-def", status: "pending" }) + "\n",
      "utf-8"
    );

    mockedCallLLM.mockResolvedValue({
      result: {
        action: "skip",
        entry: "",
        reason: "duplicate of existing promotion",
      } satisfies PromoteWriterOutput,
      usage: { input_tokens: 100, output_tokens: 30 },
    });

    const result = await executePromoteFinding(
      {
        findingIds: ["LRN-20260305-def"],
        scope: "global",
        category: "learning",
        rule: "Already known rule",
      },
      tmpDir
    );

    expect(result.action).toBe("skip");

    // Verify no promotions.jsonl entry
    const promotionsPath = path.join(sivDir, "promotions.jsonl");
    expect(fs.existsSync(promotionsPath)).toBe(false);

    // Verify finding status unchanged
    const findingsContent = fs.readFileSync(findingsPath, "utf-8");
    expect(findingsContent).toContain('"pending"');
    expect(findingsContent).not.toContain('"promoted"');
  });

  it("LLM receives existing active promotions for dedup", async () => {
    const sivDir = path.join(tmpDir, ".siv");
    const findingsPath = path.join(sivDir, "findings.jsonl");
    fs.writeFileSync(
      findingsPath,
      JSON.stringify({ id: "LRN-20260305-ghi", status: "pending" }) + "\n",
      "utf-8"
    );

    // Write an existing active promotion
    const existingPromotion = {
      id: "PRM-20260305-aaa",
      ts: "2026-03-05T00:00:00Z",
      finding_ids: ["LRN-20260305-old"],
      scope: "project",
      project: "project",
      project_path: "/Users/me/work/project",
      category: "learning",
      rule: "Existing rule about reading files",
      action_taken: "create",
      status: "active",
    };
    fs.writeFileSync(
      path.join(sivDir, "promotions.jsonl"),
      JSON.stringify(existingPromotion) + "\n",
      "utf-8"
    );

    mockedCallLLM.mockResolvedValue({
      result: {
        action: "create",
        entry: "New unrelated rule",
        reason: "genuinely new",
      } satisfies PromoteWriterOutput,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await executePromoteFinding(
      {
        findingIds: ["LRN-20260305-ghi"],
        scope: "project",
        project: "project",
        projectPath: "/Users/me/work/project",
        category: "learning",
        rule: "New unrelated rule",
      },
      tmpDir
    );

    // Verify LLM was called with existing promotions
    const callArgs = mockedCallLLM.mock.calls[0];
    const userPrompt = callArgs[2]; // system, user
    expect(userPrompt).toContain("PRM-20260305-aaa");
    expect(userPrompt).toContain("Existing rule about reading files");
  });

  it("merge: supersedes old promotion and appends new one", async () => {
    const sivDir = path.join(tmpDir, ".siv");
    const findingsPath = path.join(sivDir, "findings.jsonl");
    fs.writeFileSync(
      findingsPath,
      JSON.stringify({ id: "LRN-20260305-jkl", status: "pending" }) + "\n",
      "utf-8"
    );

    // Write existing promotion to merge with
    const oldPromotion = {
      id: "PRM-20260305-bbb",
      ts: "2026-03-05T00:00:00Z",
      finding_ids: ["LRN-20260305-old"],
      scope: "project",
      project: "project",
      project_path: "/Users/me/work/project",
      category: "learning",
      rule: "Partial rule",
      action_taken: "create",
      status: "active",
    };
    fs.writeFileSync(
      path.join(sivDir, "promotions.jsonl"),
      JSON.stringify(oldPromotion) + "\n",
      "utf-8"
    );

    mockedCallLLM.mockResolvedValue({
      result: {
        action: "merge",
        entry: "Combined rule with more detail",
        reason: "overlapping rules merged",
        supersedes_ids: ["PRM-20260305-bbb"],
      } satisfies PromoteWriterOutput,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await executePromoteFinding(
      {
        findingIds: ["LRN-20260305-jkl"],
        scope: "project",
        project: "project",
        projectPath: "/Users/me/work/project",
        category: "learning",
        rule: "Additional detail about partial rule",
      },
      tmpDir
    );

    expect(result.action).toBe("merge");

    // Read promotions.jsonl — should have 2 lines
    const promotionsContent = fs.readFileSync(
      path.join(sivDir, "promotions.jsonl"),
      "utf-8"
    );
    const lines = promotionsContent.trim().split("\n");
    expect(lines).toHaveLength(2);

    // First line: old promotion marked superseded
    const old = JSON.parse(lines[0]);
    expect(old.id).toBe("PRM-20260305-bbb");
    expect(old.status).toBe("superseded");

    // Second line: new active promotion
    const newPromo = JSON.parse(lines[1]);
    expect(newPromo.status).toBe("active");
    expect(newPromo.action_taken).toBe("merge");
    expect(newPromo.rule).toBe("Combined rule with more detail");
  });
});
