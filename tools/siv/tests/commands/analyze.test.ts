import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAnalyzePrompt } from "../../src/prompts/analyze.js";

// Mock all external dependencies
vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(() => ({
    sivDir: "/tmp/siv-test",
    apiKey: "test-key",
    apiBase: "https://api.example.com/v1",
    model: "test-model",
    scansPath: "/tmp/siv-test/scans.jsonl",
    findingsPath: "/tmp/siv-test/findings.jsonl",
    promotionsPath: "/tmp/siv-test/promotions.jsonl",
    backupsDir: "/tmp/siv-test/backups",
    promotionThreshold: {
      minSessions: 3,
      minOccurrences: 3,
      crossProjectMinProjects: 2,
    },
  })),
}));

const mockSearchSessions = vi.fn();
vi.mock("../../src/sessions/search.js", () => ({
  searchSessions: (...args: unknown[]) => mockSearchSessions(...args),
  pathToProjectKey: vi.fn((p: string) => p.replace(/\//g, "-").replace(/_/g, "-")),
}));

const mockExtractSession = vi.fn();
vi.mock("../../src/sessions/extract.js", () => ({
  extractSession: (...args: unknown[]) => mockExtractSession(...args),
}));

const mockCallLLM = vi.fn();
vi.mock("../../src/llm.js", () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

const mockExecuteLog = vi.fn();
vi.mock("../../src/commands/log.js", () => ({
  executeLog: (...args: unknown[]) => mockExecuteLog(...args),
}));

const mockAppendJsonl = vi.fn();
const mockReadJsonl = vi.fn().mockReturnValue([]);
vi.mock("../../src/storage.js", () => ({
  appendJsonl: (...args: unknown[]) => mockAppendJsonl(...args),
  readJsonl: (...args: unknown[]) => mockReadJsonl(...args),
}));

// Mock fs.readFileSync for countLines — return 100 lines by default
const originalFs = await import("fs");
vi.spyOn(originalFs.default, "readFileSync").mockReturnValue(
  Array(100).fill("{}").join("\n")
);

import { executeAnalyze } from "../../src/commands/analyze.js";

describe("buildAnalyzePrompt", () => {
  it("returns system and user prompts", () => {
    const result = buildAnalyzePrompt('{"metadata":{}}');

    expect(result.system).toContain("session analyst");
    expect(result.system).toContain("findings");
    expect(result.system).toContain("correction");
    expect(result.system).toContain("error");
    expect(result.system).toContain("knowledge_gap");
    expect(result.system).toContain("best_practice");
  });

  it("includes condensed JSON in user prompt", () => {
    const json = '{"metadata":{"session_id":"abc123"}}';
    const result = buildAnalyzePrompt(json);

    expect(result.user).toContain("Analyze this session transcript");
    expect(result.user).toContain(json);
  });

  it("mentions priority levels in system prompt", () => {
    const result = buildAnalyzePrompt("{}");

    expect(result.system).toContain("critical");
    expect(result.system).toContain("high");
    expect(result.system).toContain("medium");
    expect(result.system).toContain("low");
  });

  it("instructs what not to report", () => {
    const result = buildAnalyzePrompt("{}");

    expect(result.system).toContain("What NOT to report");
    expect(result.system).toContain("Anything that worked on the first try");
  });

  it("uses strong enforcement for high-frequency exclusions", () => {
    const result = buildAnalyzePrompt("{}");

    expect(result.system).toContain("NEVER report");
  });
});

describe("executeAnalyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs findings from LLM analysis", async () => {
    mockSearchSessions.mockReturnValue([
      {
        path: "/sessions/test.jsonl",
        session_id: "sess-001",
        modified: "2026-03-01T00:00:00",
        size_bytes: 1000,
        turn_count: 5,
      },
    ]);

    mockExtractSession.mockReturnValue({
      metadata: {
        session_id: "sess-001",
        slug: "my-project",
        cwd: "/Users/me/work/project",
      },
      conversation: [],
      skills: [],
      subagents: [],
      tool_failures: [],
      tool_usage_summary: {},
      api_errors: [],
      compactions: [],
      subagent_files: [],
    });

    mockCallLLM.mockResolvedValue({
      result: {
        findings: [
          {
            category: "correction",
            summary: "Used cat instead of Read",
            details: "The agent used Bash cat to read a file instead of the Read tool.",
            priority: "medium",
            tags: ["tools", "read"],
          },
          {
            category: "error",
            summary: "Edit failed due to non-unique match",
            details: "The old_string was not unique in the file.",
            priority: "high",
            tags: ["tools", "edit"],
          },
        ],
      },
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    mockExecuteLog.mockReturnValue({ id: "LRN-20260301-abc", status: "logged" });

    await executeAnalyze({ latest: 5 });

    expect(mockSearchSessions).toHaveBeenCalledWith({
      latest: 5,
      projectPath: undefined,
      since: undefined,
      minTurns: 1,
    });

    expect(mockExtractSession).toHaveBeenCalledWith("/sessions/test.jsonl");
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(mockExecuteLog).toHaveBeenCalledTimes(2);

    // First finding
    expect(mockExecuteLog).toHaveBeenCalledWith({
      category: "correction",
      summary: "Used cat instead of Read",
      details: "The agent used Bash cat to read a file instead of the Read tool.",
      priority: "medium",
      project: "my-project",
      projectPath: "/Users/me/work/project",
      session: "sess-001",
      source: "analyze",
      tags: "tools, read",
    });

    // Second finding
    expect(mockExecuteLog).toHaveBeenCalledWith({
      category: "error",
      summary: "Edit failed due to non-unique match",
      details: "The old_string was not unique in the file.",
      priority: "high",
      project: "my-project",
      projectPath: "/Users/me/work/project",
      session: "sess-001",
      source: "analyze",
      tags: "tools, edit",
    });
  });

  it("handles no sessions found", async () => {
    mockSearchSessions.mockReturnValue([]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeAnalyze({ latest: 5 });

    expect(consoleSpy).toHaveBeenCalledWith("No sessions found matching criteria.");
    expect(mockCallLLM).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("skips non-main sessions", async () => {
    mockSearchSessions.mockReturnValue([
      {
        path: "/sessions/sub.jsonl",
        session_id: "sess-sub",
        modified: "2026-03-01T00:00:00",
        size_bytes: 500,
        turn_count: 3,
      },
    ]);

    mockExtractSession.mockReturnValue(null);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeAnalyze({});

    expect(mockCallLLM).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("handles LLM errors gracefully", async () => {
    mockSearchSessions.mockReturnValue([
      {
        path: "/sessions/err.jsonl",
        session_id: "sess-err",
        modified: "2026-03-01T00:00:00",
        size_bytes: 1000,
        turn_count: 5,
      },
    ]);

    mockExtractSession.mockReturnValue({
      metadata: { session_id: "sess-err", slug: null, cwd: null },
      conversation: [],
      skills: [],
      subagents: [],
      tool_failures: [],
      tool_usage_summary: {},
      api_errors: [],
      compactions: [],
      subagent_files: [],
    });

    mockCallLLM.mockRejectedValue(new Error("API timeout"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeAnalyze({});

    expect(errorSpy).toHaveBeenCalledWith(
      "Error analyzing sess-err: API timeout"
    );
    expect(mockExecuteLog).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("defaults invalid categories and priorities", async () => {
    mockSearchSessions.mockReturnValue([
      {
        path: "/sessions/bad.jsonl",
        session_id: "sess-bad",
        modified: "2026-03-01T00:00:00",
        size_bytes: 1000,
        turn_count: 5,
      },
    ]);

    mockExtractSession.mockReturnValue({
      metadata: { session_id: "sess-bad", slug: "proj", cwd: "/proj" },
      conversation: [],
      skills: [],
      subagents: [],
      tool_failures: [],
      tool_usage_summary: {},
      api_errors: [],
      compactions: [],
      subagent_files: [],
    });

    mockCallLLM.mockResolvedValue({
      result: {
        findings: [
          {
            category: "invalid_category",
            summary: "Bad category test",
            details: "",
            priority: "invalid_priority",
            tags: [],
          },
        ],
      },
      usage: { input_tokens: 50, output_tokens: 25 },
    });

    mockExecuteLog.mockReturnValue({ id: "LRN-20260301-xyz", status: "logged" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeAnalyze({});

    expect(mockExecuteLog).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "best_practice",
        priority: "medium",
      })
    );

    logSpy.mockRestore();
  });

  it("filters by session ID when --session is given", async () => {
    mockSearchSessions.mockReturnValue([
      {
        path: "/sessions/a.jsonl",
        session_id: "sess-a",
        modified: "2026-03-01T00:00:00",
        size_bytes: 1000,
        turn_count: 5,
      },
      {
        path: "/sessions/b.jsonl",
        session_id: "sess-b",
        modified: "2026-03-01T00:00:00",
        size_bytes: 1000,
        turn_count: 5,
      },
    ]);

    mockExtractSession.mockReturnValue({
      metadata: { session_id: "sess-b", slug: "proj", cwd: "/proj" },
      conversation: [],
      skills: [],
      subagents: [],
      tool_failures: [],
      tool_usage_summary: {},
      api_errors: [],
      compactions: [],
      subagent_files: [],
    });

    mockCallLLM.mockResolvedValue({
      result: { findings: [] },
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeAnalyze({ session: "sess-b" });

    expect(mockExtractSession).toHaveBeenCalledTimes(1);
    expect(mockExtractSession).toHaveBeenCalledWith("/sessions/b.jsonl");

    logSpy.mockRestore();
  });

  it("handles empty findings array from LLM", async () => {
    mockSearchSessions.mockReturnValue([
      {
        path: "/sessions/clean.jsonl",
        session_id: "sess-clean",
        modified: "2026-03-01T00:00:00",
        size_bytes: 1000,
        turn_count: 5,
      },
    ]);

    mockExtractSession.mockReturnValue({
      metadata: { session_id: "sess-clean", slug: "proj", cwd: "/proj" },
      conversation: [],
      skills: [],
      subagents: [],
      tool_failures: [],
      tool_usage_summary: {},
      api_errors: [],
      compactions: [],
      subagent_files: [],
    });

    mockCallLLM.mockResolvedValue({
      result: { findings: [] },
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    mockExecuteLog.mockReturnValue({ id: "LRN-20260301-000", status: "logged" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeAnalyze({});

    expect(mockExecuteLog).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
