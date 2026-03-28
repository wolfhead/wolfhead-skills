import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the dependencies before importing
vi.mock("../../src/sessions/search.js");
vi.mock("../../src/sessions/extract.js");

import { executeExtract } from "../../src/commands/extract.js";
import { searchSessions } from "../../src/sessions/search.js";
import { extractSession } from "../../src/sessions/extract.js";

const mockSearchSessions = vi.mocked(searchSessions);
const mockExtractSession = vi.mocked(extractSession);

describe("executeExtract", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("outputs JSON array of extractions to stdout", () => {
    const fakeSession = { path: "/tmp/s.jsonl", session_id: "abc", modified: "2026-03-28T00:00:00", size_bytes: 1000, turn_count: 5 };
    const fakeExtraction = {
      metadata: { session_id: "abc", slug: "test", cwd: "/test", git_branch: null, model: "opus", version: null, first_timestamp: null, last_timestamp: null, input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0, turn_count: 5, turn_durations: [] },
      conversation: [],
      skills: [],
      subagents: [],
      tool_failures: [],
      tool_usage_summary: {},
      api_errors: [],
      compactions: [],
      subagent_files: [],
      emotion_markers: [],
    };

    mockSearchSessions.mockReturnValue([fakeSession]);
    mockExtractSession.mockReturnValue(fakeExtraction);

    executeExtract({ latest: 10 });

    expect(mockSearchSessions).toHaveBeenCalledWith({
      latest: 10,
      projectPath: undefined,
      since: undefined,
      minTurns: 1,
    });
    expect(consoleLogSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(output).toHaveLength(1);
    expect(output[0].metadata.session_id).toBe("abc");
  });

  it("returns early when no sessions found", () => {
    mockSearchSessions.mockReturnValue([]);

    executeExtract({});

    expect(consoleErrorSpy).toHaveBeenCalledWith("No sessions found matching criteria.");
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("skips non-main sessions and reports count", () => {
    const sessions = [
      { path: "/tmp/a.jsonl", session_id: "a", modified: "2026-03-28T00:00:00", size_bytes: 1000, turn_count: 5 },
      { path: "/tmp/b.jsonl", session_id: "b", modified: "2026-03-28T00:00:00", size_bytes: 1000, turn_count: 3 },
    ];
    mockSearchSessions.mockReturnValue(sessions);
    mockExtractSession.mockReturnValueOnce(null);
    mockExtractSession.mockReturnValueOnce({
      metadata: { session_id: "b", slug: null, cwd: null, git_branch: null, model: null, version: null, first_timestamp: null, last_timestamp: null, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, turn_count: 3, turn_durations: [] },
      conversation: [], skills: [], subagents: [], tool_failures: [], tool_usage_summary: {}, api_errors: [], compactions: [], subagent_files: [], emotion_markers: [],
    });

    executeExtract({});

    expect(consoleErrorSpy).toHaveBeenCalledWith("Skipped 1 non-main session(s).");
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(output).toHaveLength(1);
    expect(output[0].metadata.session_id).toBe("b");
  });

  it("filters by --session when provided", () => {
    const sessions = [
      { path: "/tmp/a.jsonl", session_id: "target", modified: "2026-03-28T00:00:00", size_bytes: 1000, turn_count: 5 },
      { path: "/tmp/b.jsonl", session_id: "other", modified: "2026-03-28T00:00:00", size_bytes: 1000, turn_count: 3 },
    ];
    mockSearchSessions.mockReturnValue(sessions);
    mockExtractSession.mockReturnValue({
      metadata: { session_id: "target", slug: null, cwd: null, git_branch: null, model: null, version: null, first_timestamp: null, last_timestamp: null, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, turn_count: 5, turn_durations: [] },
      conversation: [], skills: [], subagents: [], tool_failures: [], tool_usage_summary: {}, api_errors: [], compactions: [], subagent_files: [], emotion_markers: [],
    });

    executeExtract({ session: "target" });

    expect(mockExtractSession).toHaveBeenCalledOnce();
    expect(mockExtractSession).toHaveBeenCalledWith("/tmp/a.jsonl");
  });

  it("passes minTurns: 1 to searchSessions", () => {
    mockSearchSessions.mockReturnValue([]);

    executeExtract({ latest: 5, projectPath: "/my/project", since: "2026-03-01" });

    expect(mockSearchSessions).toHaveBeenCalledWith({
      latest: 5,
      projectPath: "/my/project",
      since: "2026-03-01",
      minTurns: 1,
    });
  });
});
