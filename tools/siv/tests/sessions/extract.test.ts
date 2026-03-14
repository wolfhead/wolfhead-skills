import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  parseJsonl,
  classifyRecord,
  isMainSession,
  extractMetadata,
  extractConversation,
  extractSkills,
  extractSubagents,
  extractToolFailures,
  extractApiErrors,
  extractToolUsageSummary,
  extractCompactions,
  findSubagentFiles,
  extractSession,
  extractSubsession,
  buildToolNameMap,
  truncate,
  summarizeToolInput,
  extractToolResultContent,
  extractEmotionMarkers,
  CONTENT_PREVIEW_MAX_CHARS,
  TOOL_INPUT_MAX_CHARS,
} from "../../src/sessions/extract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-extract-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJsonl(
  dir: string,
  filename: string,
  records: unknown[]
): string {
  const filePath = path.join(dir, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// =========================================================================
// Task 6 — Core parser tests
// =========================================================================

describe("parseJsonl", () => {
  it("reads basic JSONL file", () => {
    const p = writeJsonl(tmpDir, "test.jsonl", [
      { type: "user", message: { content: "hello" } },
      { type: "assistant", message: { id: "msg_1" } },
    ]);
    const records = parseJsonl(p);
    expect(records).toHaveLength(2);
    expect(records[0].type).toBe("user");
  });

  it("skips malformed lines", () => {
    const p = path.join(tmpDir, "test.jsonl");
    fs.writeFileSync(
      p,
      '{"type": "user"}\nthis is not json\n{"type": "assistant"}\n\n{broken json\n'
    );
    const records = parseJsonl(p);
    expect(records).toHaveLength(2);
  });

  it("returns empty array for empty file", () => {
    const p = path.join(tmpDir, "empty.jsonl");
    fs.writeFileSync(p, "");
    expect(parseJsonl(p)).toEqual([]);
  });
});

// =========================================================================
// classifyRecord
// =========================================================================

describe("classifyRecord", () => {
  it("classifies human_message", () => {
    expect(
      classifyRecord({
        type: "user",
        message: { role: "user", content: "hello" },
      })
    ).toBe("human_message");
  });

  it("classifies tool_result", () => {
    expect(
      classifyRecord({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "ok",
              is_error: false,
            },
          ],
        },
      })
    ).toBe("tool_result");
  });

  it("classifies assistant", () => {
    expect(
      classifyRecord({
        type: "assistant",
        message: { id: "msg_1", content: [{ type: "text", text: "hi" }] },
      })
    ).toBe("assistant");
  });

  it("classifies agent_progress", () => {
    expect(
      classifyRecord({ type: "progress", data: { type: "agent_progress" } })
    ).toBe("agent_progress");
  });

  it("classifies bash_progress", () => {
    expect(
      classifyRecord({ type: "progress", data: { type: "bash_progress" } })
    ).toBe("bash_progress");
  });

  it("classifies hook_progress", () => {
    expect(
      classifyRecord({ type: "progress", data: { type: "hook_progress" } })
    ).toBe("hook_progress");
  });

  it("returns skip for unknown progress type", () => {
    expect(
      classifyRecord({ type: "progress", data: { type: "query_update" } })
    ).toBe("skip");
  });

  it("classifies turn_duration", () => {
    expect(
      classifyRecord({
        type: "system",
        subtype: "turn_duration",
        durationMs: 5000,
      })
    ).toBe("turn_duration");
  });

  it("classifies api_error", () => {
    expect(
      classifyRecord({ type: "system", subtype: "api_error", cause: {} })
    ).toBe("api_error");
  });

  it("classifies compact_boundary", () => {
    expect(
      classifyRecord({ type: "system", subtype: "compact_boundary" })
    ).toBe("compact_boundary");
  });

  it("returns skip for other system subtypes", () => {
    expect(
      classifyRecord({ type: "system", subtype: "local_command" })
    ).toBe("skip");
  });

  it("classifies summary", () => {
    expect(classifyRecord({ type: "summary", summary: "test" })).toBe(
      "summary"
    );
  });

  it("classifies queue_operation", () => {
    expect(
      classifyRecord({ type: "queue-operation", operation: "enqueue" })
    ).toBe("queue_operation");
  });

  it("returns skip for file-history-snapshot", () => {
    expect(classifyRecord({ type: "file-history-snapshot" })).toBe("skip");
  });

  it("returns skip for saved_hook_context", () => {
    expect(classifyRecord({ type: "saved_hook_context" })).toBe("skip");
  });

  it("classifies list content without tool_result as human_message", () => {
    expect(
      classifyRecord({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "some text" }],
        },
      })
    ).toBe("human_message");
  });
});

// =========================================================================
// isMainSession
// =========================================================================

describe("isMainSession", () => {
  it("returns true for main session", () => {
    const p = writeJsonl(tmpDir, "main.jsonl", [
      {
        type: "user",
        isSidechain: false,
        sessionId: "abc123",
        message: { content: "hello" },
      },
    ]);
    expect(isMainSession(p)).toBe(true);
  });

  it("returns false for sidechain", () => {
    const p = writeJsonl(tmpDir, "sub.jsonl", [
      {
        type: "user",
        isSidechain: true,
        agentId: "ab72d42",
        sessionId: "abc123",
        message: { content: "task prompt" },
      },
    ]);
    expect(isMainSession(p)).toBe(false);
  });

  it("returns false for agentId present", () => {
    const p = writeJsonl(tmpDir, "sub2.jsonl", [
      {
        type: "user",
        agentId: "ab72d42",
        message: { content: "task prompt" },
      },
    ]);
    expect(isMainSession(p)).toBe(false);
  });

  it("returns false for empty file", () => {
    const p = path.join(tmpDir, "empty.jsonl");
    fs.writeFileSync(p, "");
    expect(isMainSession(p)).toBe(false);
  });

  it("returns false for nonexistent file", () => {
    expect(isMainSession("/nonexistent/path.jsonl")).toBe(false);
  });

  it("returns true when no sidechain or agentId", () => {
    const p = writeJsonl(tmpDir, "main2.jsonl", [
      { type: "user", message: { content: "hello" } },
    ]);
    expect(isMainSession(p)).toBe(true);
  });

  it("returns false for all malformed lines", () => {
    const p = path.join(tmpDir, "bad.jsonl");
    fs.writeFileSync(p, "not json at all\n{broken\nalso bad}\n");
    expect(isMainSession(p)).toBe(false);
  });
});

// =========================================================================
// Task 7 — Metadata tests
// =========================================================================

function sampleMetadataRecords(): Record<string, unknown>[] {
  return [
    {
      type: "user",
      sessionId: "sess-001",
      slug: "happy-coding-cat",
      cwd: "/home/user/project",
      gitBranch: "main",
      version: "2.1.37",
      timestamp: "2026-02-09T03:18:09.566Z",
      message: { role: "user", content: "hello" },
    },
    {
      type: "assistant",
      sessionId: "sess-001",
      timestamp: "2026-02-09T03:18:12.882Z",
      message: {
        model: "claude-opus-4-6",
        id: "msg_01",
        content: [{ type: "text", text: "Hi" }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 300,
        },
      },
    },
    {
      type: "assistant",
      sessionId: "sess-001",
      timestamp: "2026-02-09T03:18:14.000Z",
      message: {
        model: "claude-opus-4-6",
        id: "msg_01",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 30,
        },
      },
    },
    {
      type: "system",
      subtype: "turn_duration",
      durationMs: 5000,
      timestamp: "2026-02-09T03:18:20.000Z",
    },
    {
      type: "system",
      subtype: "turn_duration",
      durationMs: 3000,
      timestamp: "2026-02-09T03:20:00.000Z",
    },
  ];
}

describe("extractMetadata", () => {
  it("extracts basic metadata", () => {
    const meta = extractMetadata(sampleMetadataRecords());
    expect(meta.session_id).toBe("sess-001");
    expect(meta.slug).toBe("happy-coding-cat");
    expect(meta.cwd).toBe("/home/user/project");
    expect(meta.git_branch).toBe("main");
    expect(meta.model).toBe("claude-opus-4-6");
    expect(meta.version).toBe("2.1.37");
  });

  it("extracts timestamps", () => {
    const meta = extractMetadata(sampleMetadataRecords());
    expect(meta.first_timestamp).toBe("2026-02-09T03:18:09.566Z");
    expect(meta.last_timestamp).toBe("2026-02-09T03:20:00.000Z");
  });

  it("accumulates token totals", () => {
    const meta = extractMetadata(sampleMetadataRecords());
    expect(meta.input_tokens).toBe(110);
    expect(meta.output_tokens).toBe(55);
    expect(meta.cache_read_tokens).toBe(220);
    expect(meta.cache_creation_tokens).toBe(330);
  });

  it("tracks turn count and durations", () => {
    const meta = extractMetadata(sampleMetadataRecords());
    expect(meta.turn_count).toBe(2);
    expect(meta.turn_durations).toEqual([5000, 3000]);
  });

  it("handles empty records", () => {
    const meta = extractMetadata([]);
    expect(meta.session_id).toBeNull();
    expect(meta.input_tokens).toBe(0);
    expect(meta.turn_count).toBe(0);
  });

  it("handles non-dict usage field", () => {
    const records = [
      {
        type: "assistant",
        timestamp: "2026-02-09T03:18:12.000Z",
        message: {
          model: "claude-opus-4-6",
          id: "msg_bad_usage",
          content: [{ type: "text", text: "hi" }],
          usage: "not-a-dict",
        },
      },
    ];
    const meta = extractMetadata(records);
    expect(meta.input_tokens).toBe(0);
    expect(meta.output_tokens).toBe(0);
  });
});

// =========================================================================
// Helper function tests
// =========================================================================

describe("buildToolNameMap", () => {
  it("maps tool_use_id to tool_name", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_1",
          content: [
            { type: "tool_use", id: "toolu_abc", name: "Read", input: {} },
            { type: "tool_use", id: "toolu_def", name: "Bash", input: {} },
          ],
        },
      },
    ];
    const map = buildToolNameMap(records as Record<string, unknown>[]);
    expect(map.get("toolu_abc")).toBe("Read");
    expect(map.get("toolu_def")).toBe("Bash");
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long text with ellipsis", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcde...");
  });

  it("converts non-string to string", () => {
    expect(truncate(12345, 3)).toBe("123...");
  });
});

describe("summarizeToolInput", () => {
  it("summarizes Write input", () => {
    const result = summarizeToolInput("Write", {
      file_path: "/tmp/test.ts",
      content: "x".repeat(1000),
    });
    expect(result).toEqual({
      file_path: "/tmp/test.ts",
      content: "(1000 chars)",
    });
  });

  it("summarizes Edit input", () => {
    const result = summarizeToolInput("Edit", {
      file_path: "/tmp/test.ts",
      old_string: "a".repeat(200),
      new_string: "b".repeat(200),
    });
    const r = result as Record<string, unknown>;
    expect(r.file_path).toBe("/tmp/test.ts");
    expect((r.old_string as string).length).toBeLessThanOrEqual(103);
    expect((r.new_string as string).length).toBeLessThanOrEqual(103);
  });

  it("summarizes Read input with optional fields", () => {
    const result = summarizeToolInput("Read", {
      file_path: "/tmp/test.ts",
      offset: 10,
      limit: 50,
    });
    expect(result).toEqual({
      file_path: "/tmp/test.ts",
      offset: 10,
      limit: 50,
    });
  });

  it("summarizes Bash input", () => {
    const result = summarizeToolInput("Bash", {
      command: "echo hello",
      description: "Print hello",
    });
    expect(result).toEqual({
      command: "echo hello",
      description: "Print hello",
    });
  });

  it("summarizes Agent input", () => {
    const result = summarizeToolInput("Agent", {
      description: "Explore code",
      prompt: "x".repeat(500),
      subagent_type: "general-purpose",
    });
    const r = result as Record<string, unknown>;
    expect(r.description).toBe("Explore code");
    expect(r.subagent_type).toBe("general-purpose");
    expect(r.prompt).toBe("(500 chars)");
  });

  it("summarizes Task input same as Agent", () => {
    const result = summarizeToolInput("Task", {
      description: "Do thing",
      prompt: "abc",
    });
    const r = result as Record<string, unknown>;
    expect(r.description).toBe("Do thing");
    expect(r.prompt).toBe("(3 chars)");
  });

  it("summarizes Grep input", () => {
    const result = summarizeToolInput("Grep", {
      pattern: "TODO",
      path: "/src",
      glob: "*.ts",
      type: "ts",
      output_mode: "content",
    });
    expect(result).toEqual({
      pattern: "TODO",
      path: "/src",
      glob: "*.ts",
      type: "ts",
      output_mode: "content",
    });
  });

  it("summarizes Glob input", () => {
    const result = summarizeToolInput("Glob", {
      pattern: "**/*.ts",
      path: "/src",
    });
    expect(result).toEqual({ pattern: "**/*.ts", path: "/src" });
  });

  it("truncates generic input", () => {
    const bigInput: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      bigInput[`key_${i}`] = "value_" + "x".repeat(20);
    }
    const result = summarizeToolInput("UnknownTool", bigInput) as Record<
      string,
      unknown
    >;
    expect(result._summary).toBeDefined();
    expect((result._summary as string).endsWith("...")).toBe(true);
  });

  it("returns small generic input as-is", () => {
    const result = summarizeToolInput("UnknownTool", { small: "data" });
    expect(result).toEqual({ small: "data" });
  });

  it("returns non-object input as-is", () => {
    expect(summarizeToolInput("Write", "just a string")).toBe(
      "just a string"
    );
    expect(summarizeToolInput("Write", 42)).toBe(42);
  });
});

describe("extractToolResultContent", () => {
  it("returns string content directly", () => {
    expect(extractToolResultContent("hello")).toBe("hello");
  });

  it("joins array of text items", () => {
    const content = [
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ];
    expect(extractToolResultContent(content)).toBe("line 1\nline 2");
  });

  it("handles string items in array", () => {
    expect(extractToolResultContent(["a", "b"])).toBe("a\nb");
  });

  it("returns empty string for falsy", () => {
    expect(extractToolResultContent(null)).toBe("");
    expect(extractToolResultContent(undefined)).toBe("");
    expect(extractToolResultContent("")).toBe("");
  });

  it("converts other types to string", () => {
    expect(extractToolResultContent(42)).toBe("42");
  });
});

// =========================================================================
// Task 8 — Conversation flow tests
// =========================================================================

describe("extractConversation", () => {
  it("handles simple conversation", () => {
    const records = [
      {
        type: "user",
        message: { role: "user", content: "What is 2+2?" },
      },
      {
        type: "assistant",
        message: {
          id: "msg_01",
          content: [{ type: "text", text: "The answer is 4." }],
          usage: {},
        },
      },
    ];
    const turns = extractConversation(records);
    expect(turns).toHaveLength(2);
    expect(turns[0].type).toBe("human_message");
    expect((turns[0] as { text: string }).text).toBe("What is 2+2?");
    expect(turns[1].type).toBe("assistant_turn");
    expect((turns[1] as { text: string }).text).toBe("The answer is 4.");
    expect((turns[1] as { tool_calls: unknown[] }).tool_calls).toEqual([]);
  });

  it("filters thinking blocks", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_02",
          content: [{ type: "thinking", thinking: "Let me think..." }],
          usage: {},
        },
      },
      {
        type: "assistant",
        message: {
          id: "msg_02",
          content: [{ type: "text", text: "Here is my answer." }],
          usage: {},
        },
      },
    ];
    const turns = extractConversation(records);
    expect(turns).toHaveLength(1);
    expect(turns[0].type).toBe("assistant_turn");
    expect((turns[0] as { text: string }).text).toBe("Here is my answer.");
  });

  it("merges multiple assistant records with same message.id", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_03",
          content: [{ type: "text", text: "Part 1" }],
          usage: {},
        },
      },
      {
        type: "assistant",
        message: {
          id: "msg_03",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Bash",
              input: { command: "ls" },
            },
          ],
          usage: {},
        },
      },
    ];
    const turns = extractConversation(records);
    expect(turns).toHaveLength(1);
    expect((turns[0] as { text: string }).text).toBe("Part 1");
    const tc = (turns[0] as { tool_calls: ToolCallLike[] }).tool_calls;
    expect(tc).toHaveLength(1);
    expect(tc[0].name).toBe("Bash");
  });

  it("handles error tool results individually", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_05",
          content: [
            {
              type: "tool_use",
              id: "toolu_err",
              name: "Bash",
              input: { command: "fail" },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_err",
              content: "command not found",
              is_error: true,
            },
          ],
        },
      },
    ];
    const turns = extractConversation(records);
    // Should have assistant_turn + tool_result (error)
    const trTurn = turns.find((t) => t.type === "tool_result");
    expect(trTurn).toBeDefined();
    expect((trTurn as { is_error: boolean }).is_error).toBe(true);
  });

  it("counts successful tool results as summary", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_04",
          content: [
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "Read",
              input: { file_path: "/tmp/test.txt" },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: "file contents here",
              is_error: false,
            },
          ],
        },
      },
    ];
    const turns = extractConversation(records);
    const summary = turns.find((t) => t.type === "tool_results_summary");
    expect(summary).toBeDefined();
    expect(
      (summary as { successful_tool_results: number }).successful_tool_results
    ).toBe(1);
  });

  it("handles tool result content as array", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_06",
          content: [
            {
              type: "tool_use",
              id: "toolu_arr",
              name: "Task",
              input: { description: "do thing" },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_arr",
              content: [
                { type: "text", text: "Result line 1" },
                { type: "text", text: "Result line 2" },
              ],
            },
          ],
        },
      },
    ];
    // This is a successful result (no is_error), so it goes to summary count.
    // Let's make it an error to test content extraction
    (
      (records[1] as Record<string, unknown>).message as Record<
        string,
        unknown
      >
    ).content = [
      {
        type: "tool_result",
        tool_use_id: "toolu_arr",
        content: [
          { type: "text", text: "Result line 1" },
          { type: "text", text: "Result line 2" },
        ],
        is_error: true,
      },
    ];
    const turns = extractConversation(records);
    const tr = turns.find((t) => t.type === "tool_result") as
      | { content_preview: string }
      | undefined;
    expect(tr).toBeDefined();
    expect(tr!.content_preview).toContain("Result line 1");
    expect(tr!.content_preview).toContain("Result line 2");
  });

  it("truncates long content previews", () => {
    const longContent = "x".repeat(600);
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_07",
          content: [
            {
              type: "tool_use",
              id: "toolu_long",
              name: "Bash",
              input: { command: "cat big" },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_long",
              content: longContent,
              is_error: true,
            },
          ],
        },
      },
    ];
    const turns = extractConversation(records);
    const tr = turns.find((t) => t.type === "tool_result") as
      | { content_preview: string }
      | undefined;
    expect(tr).toBeDefined();
    expect(tr!.content_preview.length).toBeLessThanOrEqual(503);
    expect(tr!.content_preview.endsWith("...")).toBe(true);
  });

  it("skips progress records", () => {
    const records = [
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "progress", data: { type: "bash_progress" } },
      {
        type: "assistant",
        message: {
          id: "msg_08",
          content: [{ type: "text", text: "hi" }],
          usage: {},
        },
      },
    ];
    const turns = extractConversation(records);
    expect(turns).toHaveLength(2);
    const types = turns.map((t) => t.type);
    expect(types).not.toContain("progress");
  });

  it("collapses skill-content dumps", () => {
    const skillDump =
      "Base directory for this skill: /home/user/skills/my-skill\n" +
      "# Lots of skill content here\n" +
      "x".repeat(5000);
    const records = [
      { type: "user", message: { role: "user", content: skillDump } },
    ];
    const turns = extractConversation(records);
    expect(turns).toHaveLength(1);
    expect(turns[0].type).toBe("skill_loaded");
    expect((turns[0] as { skill_name: string }).skill_name).toBe("my-skill");
    expect((turns[0] as { size: number }).size).toBe(skillDump.length);
  });

  it("drops compaction summaries", () => {
    const records = [
      {
        type: "user",
        message: {
          role: "user",
          content:
            "This session is being continued from a previous conversation. Here is the summary...",
        },
      },
      { type: "user", message: { role: "user", content: "Do something" } },
    ];
    const turns = extractConversation(records);
    expect(turns).toHaveLength(1);
    expect((turns[0] as { text: string }).text).toBe("Do something");
  });

  it("handles AskUserQuestion: keeps successful answers, skips rejections", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_ask",
          content: [
            {
              type: "tool_use",
              id: "toolu_ask1",
              name: "AskUserQuestion",
              input: { question: "Are you sure?" },
            },
            {
              type: "tool_use",
              id: "toolu_ask2",
              name: "AskUserQuestion",
              input: { question: "Continue?" },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_ask1",
              content: "Yes, I am sure",
              is_error: false,
            },
            {
              type: "tool_result",
              tool_use_id: "toolu_ask2",
              content: "No, cancel",
              is_error: true,
            },
          ],
        },
      },
    ];
    const turns = extractConversation(records);
    // Should have assistant_turn + 1 tool_result (the success)
    const toolResults = turns.filter((t) => t.type === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(
      (toolResults[0] as { tool_name: string }).tool_name
    ).toBe("AskUserQuestion");
    expect((toolResults[0] as { is_error: boolean }).is_error).toBe(false);
    expect(
      (toolResults[0] as { content_preview: string }).content_preview
    ).toBe("Yes, I am sure");
  });
});

// Type helper for tool_calls checks
interface ToolCallLike {
  name: string;
  tool_use_id: string;
  input: unknown;
}

// =========================================================================
// Task 9 — Signal extraction tests
// =========================================================================

describe("extractSkills", () => {
  it("extracts skill invocations with results", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_s1",
          content: [
            {
              type: "tool_use",
              id: "toolu_skill1",
              name: "Skill",
              input: {
                skill: "superpowers:writing-plans",
                args: "plan the feature",
              },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_skill1",
              content: "Plan created successfully.",
            },
          ],
        },
      },
    ];
    const skills = extractSkills(records);
    expect(skills).toHaveLength(1);
    expect(skills[0].skill_name).toBe("superpowers:writing-plans");
    expect(skills[0].args).toBe("plan the feature");
    expect(skills[0].result).toBe("Plan created successfully.");
    expect(skills[0].tool_use_id).toBe("toolu_skill1");
  });

  it("returns empty for no skills", () => {
    expect(
      extractSkills([{ type: "user", message: { content: "hello" } }])
    ).toEqual([]);
  });

  it("handles skill without result", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_s2",
          content: [
            {
              type: "tool_use",
              id: "toolu_skill2",
              name: "Skill",
              input: { skill: "commit" },
            },
          ],
          usage: {},
        },
      },
    ];
    const skills = extractSkills(records);
    expect(skills).toHaveLength(1);
    expect(skills[0].result).toBeNull();
  });
});

describe("extractSubagents", () => {
  it("extracts Task subagent invocations", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_t1",
          content: [
            {
              type: "tool_use",
              id: "toolu_task1",
              name: "Task",
              input: {
                description: "Explore token mechanism",
                prompt: "Investigate the token flow...",
                subagent_type: "general-purpose",
              },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_task1",
              content: [
                { type: "text", text: "Found the token mechanism." },
                {
                  type: "text",
                  text: "agentId: ab72d42 (for resuming)\n<usage>total_tokens: 37577\ntool_uses: 4\nduration_ms: 155647</usage>",
                },
              ],
            },
          ],
        },
        toolUseResult: { status: "completed", prompt: "Investigate..." },
      },
    ];
    const subagents = extractSubagents(records);
    expect(subagents).toHaveLength(1);
    expect(subagents[0].description).toBe("Explore token mechanism");
    expect(subagents[0].subagent_type).toBe("general-purpose");
    expect(subagents[0].agent_id).toBe("ab72d42");
    expect(subagents[0].status).toBe("completed");
    expect(subagents[0].duration).toBe(155647);
    expect(subagents[0].tokens).toBe(37577);
  });

  it("extracts Agent tool name (alias)", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_a1",
          content: [
            {
              type: "tool_use",
              id: "toolu_agent1",
              name: "Agent",
              input: {
                description: "Explore codebase",
                prompt: "Look at the files...",
                subagent_type: "Explore",
              },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_agent1",
              content: [
                { type: "text", text: "Found 5 files." },
                {
                  type: "text",
                  text: "agentId: af54a0eeda4518ec6\n<usage>total_tokens: 5000\ntool_uses: 3\nduration_ms: 30000</usage>",
                },
              ],
            },
          ],
        },
        toolUseResult: { status: "completed" },
      },
    ];
    const subagents = extractSubagents(records);
    expect(subagents).toHaveLength(1);
    expect(subagents[0].description).toBe("Explore codebase");
    expect(subagents[0].subagent_type).toBe("Explore");
    expect(subagents[0].agent_id).toBe("af54a0eeda4518ec6");
  });

  it("returns empty for no subagents", () => {
    expect(
      extractSubagents([{ type: "user", message: { content: "hello" } }])
    ).toEqual([]);
  });
});

describe("extractToolFailures", () => {
  it("extracts tool failures", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_f1",
          content: [
            {
              type: "tool_use",
              id: "toolu_fail1",
              name: "Read",
              input: { file_path: "/nonexistent" },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_fail1",
              content:
                "<tool_use_error>File does not exist.</tool_use_error>",
              is_error: true,
            },
          ],
        },
      },
    ];
    const failures = extractToolFailures(records);
    expect(failures).toHaveLength(1);
    expect(failures[0].tool_name).toBe("Read");
    expect(failures[0].content_preview).toContain("<tool_use_error>");
  });

  it("returns empty when no failures", () => {
    const records = [
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_ok",
              content: "success",
              is_error: false,
            },
          ],
        },
      },
    ];
    expect(extractToolFailures(records)).toEqual([]);
  });

  it("skips AskUserQuestion rejections", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_ask",
          content: [
            {
              type: "tool_use",
              id: "toolu_ask",
              name: "AskUserQuestion",
              input: { question: "Continue?" },
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_ask",
              content: "No",
              is_error: true,
            },
          ],
        },
      },
    ];
    expect(extractToolFailures(records)).toEqual([]);
  });
});

describe("extractApiErrors", () => {
  it("extracts api errors", () => {
    const records = [
      {
        type: "system",
        subtype: "api_error",
        cause: { code: "ECONNRESET" },
        retryAttempt: 1,
        maxRetries: 10,
        retryInMs: 515.43,
        timestamp: "2026-02-09T03:30:00.000Z",
      },
    ];
    const errors = extractApiErrors(records);
    expect(errors).toHaveLength(1);
    expect((errors[0].cause as { code: string }).code).toBe("ECONNRESET");
    expect(errors[0].retry_attempt).toBe(1);
    expect(errors[0].max_retries).toBe(10);
    expect(errors[0].retry_in_ms).toBeCloseTo(515.43);
  });

  it("returns empty when no api errors", () => {
    expect(
      extractApiErrors([{ type: "system", subtype: "turn_duration" }])
    ).toEqual([]);
  });
});

describe("extractToolUsageSummary", () => {
  it("counts success and failure per tool", () => {
    const records = [
      {
        type: "assistant",
        message: {
          id: "msg_1",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: {},
            },
            {
              type: "tool_use",
              id: "toolu_2",
              name: "Read",
              input: {},
            },
            {
              type: "tool_use",
              id: "toolu_3",
              name: "Bash",
              input: {},
            },
          ],
          usage: {},
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "ok",
              is_error: false,
            },
            {
              type: "tool_result",
              tool_use_id: "toolu_2",
              content: "fail",
              is_error: true,
            },
            {
              type: "tool_result",
              tool_use_id: "toolu_3",
              content: "ok",
              is_error: false,
            },
          ],
        },
      },
    ];
    const summary = extractToolUsageSummary(records);
    expect(summary.Read).toEqual({ success: 1, failure: 1 });
    expect(summary.Bash).toEqual({ success: 1, failure: 0 });
  });
});

describe("extractCompactions", () => {
  it("extracts compaction records", () => {
    const records = [
      {
        type: "system",
        subtype: "compact_boundary",
        content: "Conversation compacted",
        timestamp: "2026-02-09T04:00:00.000Z",
        compactMetadata: { trigger: "auto", preTokens: 168602 },
      },
    ];
    const compactions = extractCompactions(records);
    expect(compactions).toHaveLength(1);
    expect(compactions[0].trigger).toBe("auto");
    expect(compactions[0].pre_tokens).toBe(168602);
    expect(compactions[0].content).toBe("Conversation compacted");
  });

  it("returns empty when no compactions", () => {
    expect(
      extractCompactions([
        { type: "user", message: { content: "hello" } },
      ])
    ).toEqual([]);
  });
});

// =========================================================================
// Task 10 — Pipeline tests
// =========================================================================

describe("findSubagentFiles", () => {
  it("finds subagent files", () => {
    const sessionId = "4842e703-b98d-400e-aa9f-98aaf9489ace";
    const sessionPath = writeJsonl(tmpDir, `${sessionId}.jsonl`, [
      { type: "user", message: { content: "hello" } },
    ]);
    const subagentsDir = path.join(tmpDir, sessionId, "subagents");
    fs.mkdirSync(subagentsDir, { recursive: true });
    writeJsonl(subagentsDir, "agent-ab72d42.jsonl", [
      { type: "user", isSidechain: true, agentId: "ab72d42" },
    ]);
    writeJsonl(subagentsDir, "agent-cd1234f.jsonl", [
      { type: "user", isSidechain: true, agentId: "cd1234f" },
    ]);

    const files = findSubagentFiles(sessionPath);
    expect(files).toHaveLength(2);
    const names = files.map((f) => path.basename(f)).sort();
    expect(names).toContain("agent-ab72d42.jsonl");
    expect(names).toContain("agent-cd1234f.jsonl");
  });

  it("returns empty when no subagents dir", () => {
    const p = writeJsonl(tmpDir, "session.jsonl", [{ type: "user" }]);
    expect(findSubagentFiles(p)).toEqual([]);
  });
});

describe("extractSession", () => {
  it("extracts full session pipeline", () => {
    const records = [
      {
        type: "user",
        sessionId: "sess-full",
        slug: "test-session",
        cwd: "/home/user",
        gitBranch: "main",
        version: "2.1.37",
        timestamp: "2026-02-09T03:18:09.566Z",
        isSidechain: false,
        message: { role: "user", content: "hello world" },
      },
      {
        type: "assistant",
        sessionId: "sess-full",
        timestamp: "2026-02-09T03:18:12.000Z",
        message: {
          model: "claude-opus-4-6",
          id: "msg_full1",
          content: [{ type: "text", text: "Hi there!" }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: "system",
        subtype: "turn_duration",
        durationMs: 3000,
        timestamp: "2026-02-09T03:18:15.000Z",
      },
    ];
    const p = writeJsonl(tmpDir, "sess-full.jsonl", records);
    const result = extractSession(p);
    expect(result).not.toBeNull();
    expect(result!.metadata.session_id).toBe("sess-full");
    expect(result!.conversation).toHaveLength(2);
    expect(result!.conversation[0].type).toBe("human_message");
    expect(result!.conversation[1].type).toBe("assistant_turn");
    expect(result!.skills).toEqual([]);
    expect(result!.subagents).toEqual([]);
    expect(result!.tool_failures).toEqual([]);
    expect(result!.api_errors).toEqual([]);
    expect(result!.compactions).toEqual([]);
    expect(result!.subagent_files).toEqual([]);
  });

  it("returns null for subagent file", () => {
    const p = writeJsonl(tmpDir, "sub.jsonl", [
      {
        type: "user",
        isSidechain: true,
        agentId: "ab72d42",
        message: { content: "task" },
      },
    ]);
    expect(extractSession(p)).toBeNull();
  });
});

describe("extractSubsession", () => {
  it("extracts subagent file", () => {
    const records = [
      {
        type: "user",
        isSidechain: true,
        agentId: "ab72d42",
        sessionId: "sess-sub",
        timestamp: "2026-02-09T03:18:09.566Z",
        message: { role: "user", content: "do the task" },
      },
      {
        type: "assistant",
        sessionId: "sess-sub",
        timestamp: "2026-02-09T03:18:12.000Z",
        message: {
          model: "claude-opus-4-6",
          id: "msg_sub1",
          content: [{ type: "text", text: "Working on it." }],
          usage: {
            input_tokens: 50,
            output_tokens: 25,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ];
    const p = writeJsonl(tmpDir, "agent-ab72d42.jsonl", records);
    const result = extractSubsession(p);
    expect(result).not.toBeNull();
    expect(result!.metadata.session_id).toBe("sess-sub");
    expect(result!.conversation).toHaveLength(2);
    expect(result!.skills).toBeDefined();
    expect(result!.subagents).toBeDefined();
    expect(result!.tool_failures).toBeDefined();
    expect(result!.api_errors).toBeDefined();
    expect(result!.compactions).toBeDefined();
  });

  it("returns null for nonexistent file", () => {
    expect(extractSubsession("/nonexistent/path/agent-abc.jsonl")).toBeNull();
  });

  it("returns null for empty file", () => {
    const p = path.join(tmpDir, "agent-empty.jsonl");
    fs.writeFileSync(p, "");
    expect(extractSubsession(p)).toBeNull();
  });
});

// =========================================================================
// Emotion marker extraction
// =========================================================================

describe("extractEmotionMarkers", () => {
  it("extracts marker with double-quoted context", () => {
    const records = [
      { type: "user", message: { content: "first human message" } },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-1",
              name: "Bash",
              input: { command: 'siv mark frustration "stuck on API"' },
            },
          ],
        },
      },
    ];
    const markers = extractEmotionMarkers(records);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toEqual({
      type: "frustration",
      context: "stuck on API",
      turn_index: 1,
    });
  });

  it("extracts marker with single-quoted context", () => {
    const records = [
      { type: "user", message: { content: "hello" } },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-2",
              name: "Bash",
              input: { command: "siv mark correction 'wrong approach'" },
            },
          ],
        },
      },
    ];
    const markers = extractEmotionMarkers(records);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe("correction");
    expect(markers[0].context).toBe("wrong approach");
  });

  it("extracts marker without quotes", () => {
    const records = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-3",
              name: "Bash",
              input: { command: "siv mark breakthrough figured it out" },
            },
          ],
        },
      },
    ];
    const markers = extractEmotionMarkers(records);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toEqual({
      type: "breakthrough",
      context: "figured it out",
      turn_index: 0,
    });
  });

  it("extracts marker with no context", () => {
    const records = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-4",
              name: "Bash",
              input: { command: "siv mark surprise" },
            },
          ],
        },
      },
    ];
    const markers = extractEmotionMarkers(records);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe("surprise");
    expect(markers[0].context).toBe("");
  });

  it("tracks turn_index correctly across multiple human turns", () => {
    const records = [
      { type: "user", message: { content: "turn 1" } },
      { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } },
      { type: "user", message: { content: "turn 2" } },
      { type: "user", message: { content: "turn 3" } },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-5",
              name: "Bash",
              input: { command: 'siv mark frustration "after 3 turns"' },
            },
          ],
        },
      },
    ];
    const markers = extractEmotionMarkers(records);
    expect(markers).toHaveLength(1);
    expect(markers[0].turn_index).toBe(3);
  });

  it("extracts multiple markers from different turns", () => {
    const records = [
      { type: "user", message: { content: "start" } },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-6",
              name: "Bash",
              input: { command: "siv mark frustration stuck" },
            },
          ],
        },
      },
      { type: "user", message: { content: "middle" } },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-7",
              name: "Bash",
              input: { command: "siv mark breakthrough solved" },
            },
          ],
        },
      },
    ];
    const markers = extractEmotionMarkers(records);
    expect(markers).toHaveLength(2);
    expect(markers[0].type).toBe("frustration");
    expect(markers[0].turn_index).toBe(1);
    expect(markers[1].type).toBe("breakthrough");
    expect(markers[1].turn_index).toBe(2);
  });

  it("returns empty array when no markers present", () => {
    const records = [
      { type: "user", message: { content: "hello" } },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-8",
              name: "Bash",
              input: { command: "git status" },
            },
          ],
        },
      },
    ];
    const markers = extractEmotionMarkers(records);
    expect(markers).toHaveLength(0);
  });

  it("ignores non-Bash tool_use blocks", () => {
    const records = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-9",
              name: "Read",
              input: { command: "siv mark frustration test" },
            },
          ],
        },
      },
    ];
    const markers = extractEmotionMarkers(records);
    expect(markers).toHaveLength(0);
  });
});

describe("extractSession includes emotion_markers", () => {
  it("includes emotion_markers in extraction result", () => {
    const records = [
      { type: "user", message: { content: "hello" } },
      {
        type: "assistant",
        message: {
          id: "msg-1",
          content: [
            {
              type: "tool_use",
              id: "tu-10",
              name: "Bash",
              input: { command: 'siv mark frustration "test marker"' },
            },
          ],
        },
      },
    ];

    const filePath = writeJsonl(tmpDir, "main-session.jsonl", records);
    const result = extractSession(filePath);
    expect(result).not.toBeNull();
    expect(result!.emotion_markers).toHaveLength(1);
    expect(result!.emotion_markers[0].type).toBe("frustration");
  });
});
