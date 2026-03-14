import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildAnalyzePrompt,
  buildMarkerAnalyzePrompt,
} from "../../src/prompts/analyze.js";

// Mock all external dependencies
vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(() => ({
    sivDir: "/tmp/siv-test",
    apiKey: "test-key",
    apiBase: "https://api.example.com/v1",
    model: "test-model",
    scansPath: "/tmp/siv-test/scans.jsonl",
    insightsPath: "/tmp/siv-test/insights.jsonl",
    rulesPath: "/tmp/siv-test/rules.jsonl",
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
    expect(result.system).toContain("insights");
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

  it("logs insights from LLM analysis", async () => {
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
      emotion_markers: [],
    });

    mockCallLLM.mockResolvedValue({
      result: {
        insights: [
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

    mockExecuteLog.mockReturnValue({ id: "INS-20260301-abc", status: "logged" });

    await executeAnalyze({ latest: 5 });

    expect(mockSearchSessions).toHaveBeenCalledWith({
      latest: 5,
      projectPath: undefined,
      since: undefined,
      minTurns: 1,
      homeDir: undefined,
    });

    expect(mockExtractSession).toHaveBeenCalledWith("/sessions/test.jsonl");
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(mockExecuteLog).toHaveBeenCalledTimes(2);

    // First insight
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

    // Second insight
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
      emotion_markers: [],
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
      emotion_markers: [],
    });

    mockCallLLM.mockResolvedValue({
      result: {
        insights: [
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

    mockExecuteLog.mockReturnValue({ id: "INS-20260301-xyz", status: "logged" });

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
      emotion_markers: [],
    });

    mockCallLLM.mockResolvedValue({
      result: { insights: [] },
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeAnalyze({ session: "sess-b" });

    expect(mockExtractSession).toHaveBeenCalledTimes(1);
    expect(mockExtractSession).toHaveBeenCalledWith("/sessions/b.jsonl");

    logSpy.mockRestore();
  });

  it("handles empty insights array from LLM", async () => {
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
      emotion_markers: [],
    });

    mockCallLLM.mockResolvedValue({
      result: { insights: [] },
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    mockExecuteLog.mockReturnValue({ id: "INS-20260301-000", status: "logged" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeAnalyze({});

    expect(mockExecuteLog).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it("uses marker-aware analysis when emotion_markers are present", async () => {
    mockSearchSessions.mockReturnValue([
      {
        path: "/sessions/marked.jsonl",
        session_id: "sess-marked",
        modified: "2026-03-01T00:00:00",
        size_bytes: 1000,
        turn_count: 5,
      },
    ]);

    mockExtractSession.mockReturnValue({
      metadata: { session_id: "sess-marked", slug: "proj", cwd: "/proj" },
      conversation: [
        { type: "human_message", text: "first message" },
        { type: "assistant_turn", message_id: "m1", text: "ok", tool_calls: [] },
        { type: "human_message", text: "second message" },
        { type: "assistant_turn", message_id: "m2", text: "done", tool_calls: [] },
      ],
      skills: [],
      subagents: [],
      tool_failures: [],
      tool_usage_summary: {},
      api_errors: [],
      compactions: [],
      subagent_files: [],
      emotion_markers: [
        { type: "frustration", context: "stuck on API", turn_index: 1 },
      ],
    });

    mockCallLLM.mockResolvedValue({
      result: {
        insights: [
          {
            category: "knowledge_gap",
            summary: "When calling the API, check auth first",
            details: "Agent tried unauthenticated calls repeatedly.",
            priority: "high",
            tags: ["api"],
          },
        ],
      },
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    mockExecuteLog.mockReturnValue({ id: "INS-20260301-mrk", status: "logged" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeAnalyze({});

    // Should have called LLM with marker-focused prompt
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const [, systemPrompt] = mockCallLLM.mock.calls[0];
    expect(systemPrompt).toContain("emotionally significant moments");
    expect(systemPrompt).toContain("frustration");
    expect(systemPrompt).toContain("Marker types");

    // Should still log the insight
    expect(mockExecuteLog).toHaveBeenCalledTimes(1);
    expect(mockExecuteLog).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "knowledge_gap",
        summary: "When calling the API, check auth first",
      })
    );

    logSpy.mockRestore();
  });

  it("uses full-scan analysis when no emotion_markers", async () => {
    mockSearchSessions.mockReturnValue([
      {
        path: "/sessions/nomark.jsonl",
        session_id: "sess-nomark",
        modified: "2026-03-01T00:00:00",
        size_bytes: 1000,
        turn_count: 5,
      },
    ]);

    mockExtractSession.mockReturnValue({
      metadata: { session_id: "sess-nomark", slug: "proj", cwd: "/proj" },
      conversation: [],
      skills: [],
      subagents: [],
      tool_failures: [],
      tool_usage_summary: {},
      api_errors: [],
      compactions: [],
      subagent_files: [],
      emotion_markers: [],
    });

    mockCallLLM.mockResolvedValue({
      result: { insights: [] },
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeAnalyze({});

    // Should have called LLM with full-scan prompt (not marker-aware)
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const [, systemPrompt] = mockCallLLM.mock.calls[0];
    expect(systemPrompt).toContain("Extract knowledge that makes the agent better");
    expect(systemPrompt).not.toContain("emotionally significant moments");

    logSpy.mockRestore();
  });
});

describe("buildMarkerAnalyzePrompt", () => {
  it("returns system and user prompts with marker types", () => {
    const markers = [
      { type: "frustration", context: "stuck on API", turn_index: 1 },
    ];
    const result = buildMarkerAnalyzePrompt(markers, "[]");

    expect(result.system).toContain("emotionally significant moments");
    expect(result.system).toContain("frustration");
    expect(result.system).toContain("correction");
    expect(result.system).toContain("breakthrough");
    expect(result.system).toContain("surprise");
  });

  it("includes markers and context windows in user prompt", () => {
    const markers = [
      { type: "frustration", context: "stuck", turn_index: 2 },
    ];
    const contextWindows = '[{"type":"human_message","text":"help"}]';
    const result = buildMarkerAnalyzePrompt(markers, contextWindows);

    expect(result.user).toContain("## Markers");
    expect(result.user).toContain("frustration");
    expect(result.user).toContain("## Context Windows");
    expect(result.user).toContain(contextWindows);
  });

  it("shares quality guidance with full-scan prompt", () => {
    const fullPrompt = buildAnalyzePrompt("{}");
    const markerPrompt = buildMarkerAnalyzePrompt([], "[]");

    // Both should contain the shared quality guidance sections
    expect(fullPrompt.system).toContain("What NOT to report");
    expect(markerPrompt.system).toContain("What NOT to report");
    expect(fullPrompt.system).toContain("Quality bar");
    expect(markerPrompt.system).toContain("Quality bar");
    expect(fullPrompt.system).toContain("Summary format");
    expect(markerPrompt.system).toContain("Summary format");
  });
});
