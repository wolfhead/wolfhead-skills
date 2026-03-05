import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { applyPromotion, executePromoteFinding } from "../../src/commands/promote-finding.js";
import type { PromoteWriterOutput } from "../../src/prompts/promote.js";

// ─── applyPromotion (pure file manipulation, no LLM) ──────────────────────

describe("applyPromotion", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-promote-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates file with header when it doesn't exist", () => {
    const targetFile = path.join(tmpDir, "sub", "MEMORY.md");

    const output: PromoteWriterOutput = {
      action: "create",
      section: "## Session Learnings",
      entry: "- Always read before write *(added: 2026-03-05, confirmed: 2026-03-05, sessions: abc)*",
      reason: "new rule",
    };

    applyPromotion(targetFile, output);

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).toContain("# Project Memory");
    expect(content).toContain("## Session Learnings");
    expect(content).toContain("- Always read before write");
  });

  it("appends entry to existing section", () => {
    const targetFile = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(
      targetFile,
      "# Project Memory\n\n## Session Learnings\n\n- Existing rule\n",
      "utf-8"
    );

    const output: PromoteWriterOutput = {
      action: "create",
      section: "## Session Learnings",
      entry: "- New rule *(added: 2026-03-05, confirmed: 2026-03-05, sessions: def)*",
      reason: "new rule",
    };

    applyPromotion(targetFile, output);

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).toContain("## Session Learnings");
    expect(content).toContain("- Existing rule");
    expect(content).toContain("- New rule");
  });

  it("creates section if missing", () => {
    const targetFile = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(
      targetFile,
      "# Project Memory\n\n## Session Learnings\n\n- Existing\n",
      "utf-8"
    );

    const output: PromoteWriterOutput = {
      action: "create",
      section: "## Session Errors",
      entry: "- **Bad pattern**: avoid it *(added: 2026-03-05, confirmed: 2026-03-05, sessions: ghi)*",
      reason: "new section needed",
    };

    applyPromotion(targetFile, output);

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).toContain("## Session Errors");
    expect(content).toContain("- **Bad pattern**: avoid it");
    expect(content).toContain("## Session Learnings"); // still there
  });

  it("replaces line on merge", () => {
    const targetFile = path.join(tmpDir, "MEMORY.md");
    const oldLine = "- Old rule *(added: 2026-03-01, confirmed: 2026-03-01, sessions: aaa)*";
    fs.writeFileSync(
      targetFile,
      `# Project Memory\n\n## Session Learnings\n\n${oldLine}\n`,
      "utf-8"
    );

    const newLine = "- Old rule *(added: 2026-03-01, confirmed: 2026-03-05, sessions: aaa, bbb)*";
    const output: PromoteWriterOutput = {
      action: "merge",
      section: "## Session Learnings",
      target_line: oldLine,
      entry: newLine,
      reason: "merge with existing",
    };

    applyPromotion(targetFile, output);

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).not.toContain("confirmed: 2026-03-01");
    expect(content).toContain("confirmed: 2026-03-05");
    expect(content).toContain("sessions: aaa, bbb");
  });

  it("replaces line on supersede", () => {
    const targetFile = path.join(tmpDir, "MEMORY.md");
    const oldLine = "- Wrong approach *(added: 2026-03-01, confirmed: 2026-03-01, sessions: aaa)*";
    fs.writeFileSync(
      targetFile,
      `# Project Memory\n\n## Session Learnings\n\n${oldLine}\n`,
      "utf-8"
    );

    const newLine = "- Correct approach *(added: 2026-03-05, confirmed: 2026-03-05, sessions: bbb)*";
    const output: PromoteWriterOutput = {
      action: "supersede",
      section: "## Session Learnings",
      target_line: oldLine,
      entry: newLine,
      reason: "conflicting rule",
    };

    applyPromotion(targetFile, output);

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).not.toContain("Wrong approach");
    expect(content).toContain("Correct approach");
  });

  it("does nothing on skip", () => {
    const targetFile = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(targetFile, "# Project Memory\n\n- Existing\n", "utf-8");

    const output: PromoteWriterOutput = {
      action: "skip",
      section: "## Session Learnings",
      entry: "",
      reason: "already in CLAUDE.md",
    };

    applyPromotion(targetFile, output);

    const content = fs.readFileSync(targetFile, "utf-8");
    expect(content).toBe("# Project Memory\n\n- Existing\n");
  });
});

// ─── executePromoteFinding (mock LLM) ─────────────────────────────────────

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

describe("executePromoteFinding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-promote-exec-"));

    // Set up fake .siv directory structure
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

  it("full flow: reads files, calls LLM, backs up, applies edit, marks findings", async () => {
    // Create existing MEMORY.md
    const memDir = path.join(
      tmpDir,
      ".claude",
      "projects",
      "-Users-me-work-project",
      "memory"
    );
    fs.mkdirSync(memDir, { recursive: true });
    const memPath = path.join(memDir, "MEMORY.md");
    fs.writeFileSync(memPath, "# Project Memory\n\n## Session Learnings\n\n", "utf-8");

    // Create findings.jsonl with matching findings
    const sivDir = path.join(tmpDir, ".siv");
    const findingsPath = path.join(sivDir, "findings.jsonl");
    fs.writeFileSync(
      findingsPath,
      JSON.stringify({ id: "LRN-20260305-abc", status: "pending" }) + "\n",
      "utf-8"
    );

    // Mock LLM to return a "create" action
    mockedCallLLM.mockResolvedValue({
      result: {
        action: "create",
        section: "## Session Learnings",
        entry: "- Always read before write *(added: 2026-03-05, confirmed: 2026-03-05, sessions: LRN-20260305-abc)*",
        reason: "new learning",
      },
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

    // Verify MEMORY.md was updated
    const updatedContent = fs.readFileSync(memPath, "utf-8");
    expect(updatedContent).toContain("- Always read before write");

    // Verify backup was created
    const backups = fs.readdirSync(path.join(sivDir, "backups"));
    expect(backups.length).toBe(1);
    expect(backups[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-MEMORY\.md$/);

    // Verify finding was marked as promoted
    const findingsContent = fs.readFileSync(findingsPath, "utf-8");
    expect(findingsContent).toContain('"promoted"');

    // Verify promotion was appended to promotions.jsonl
    const promotionsPath = path.join(sivDir, "promotions.jsonl");
    expect(fs.existsSync(promotionsPath)).toBe(true);
    const promotionLine = fs.readFileSync(promotionsPath, "utf-8").trim();
    const promotion = JSON.parse(promotionLine);
    expect(promotion.action_taken).toBe("create");
    expect(promotion.scope).toBe("project");
  });

  it("skip action: no file writes, no finding status changes", async () => {
    // Create findings.jsonl
    const sivDir = path.join(tmpDir, ".siv");
    const findingsPath = path.join(sivDir, "findings.jsonl");
    fs.writeFileSync(
      findingsPath,
      JSON.stringify({ id: "LRN-20260305-def", status: "pending" }) + "\n",
      "utf-8"
    );

    // Mock LLM to return "skip"
    mockedCallLLM.mockResolvedValue({
      result: {
        action: "skip",
        section: "## Session Learnings",
        entry: "",
        reason: "already in CLAUDE.md",
      },
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

    // Verify no backup was created
    const backupsDir = path.join(sivDir, "backups");
    expect(fs.existsSync(backupsDir)).toBe(false);

    // Verify finding status unchanged
    const findingsContent = fs.readFileSync(findingsPath, "utf-8");
    expect(findingsContent).toContain('"pending"');
    expect(findingsContent).not.toContain('"promoted"');

    // Verify no promotions.jsonl entry
    const promotionsPath = path.join(sivDir, "promotions.jsonl");
    expect(fs.existsSync(promotionsPath)).toBe(false);
  });
});
