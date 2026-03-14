import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { ScanCandidate } from "../../src/adapters/types.js";

// Build a minimal valid session JSONL (main session with human turns)
function buildSessionJsonl(sessionId: string, slug: string, cwd: string): string {
  const lines = [
    JSON.stringify({
      type: "user",
      sessionId,
      slug,
      cwd,
      timestamp: "2026-03-01T10:00:00Z",
      message: { content: "Hello, please help me." },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-01T10:00:01Z",
      message: {
        id: "msg-001",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "Sure, how can I help?" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }),
    JSON.stringify({
      type: "system",
      subtype: "turn_duration",
      durationMs: 1234,
      timestamp: "2026-03-01T10:00:02Z",
    }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-03-01T10:01:00Z",
      message: { content: "Thanks!" },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-01T10:01:01Z",
      message: {
        id: "msg-002",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "You're welcome!" }],
        usage: { input_tokens: 50, output_tokens: 20 },
      },
    }),
    JSON.stringify({
      type: "system",
      subtype: "turn_duration",
      durationMs: 567,
      timestamp: "2026-03-01T10:01:02Z",
    }),
  ];
  return lines.join("\n") + "\n";
}

describe("ClaudeCodeSessionAdapter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-adapter-test-"));
  });

  it("has name 'claude-code-session'", async () => {
    const { ClaudeCodeSessionAdapter } = await import(
      "../../src/adapters/claude-code-session.js"
    );
    const adapter = new ClaudeCodeSessionAdapter();
    expect(adapter.name).toBe("claude-code-session");
  });

  it("scan() returns ScanCandidate[]", async () => {
    // Set up a fake Claude projects directory
    const projectKey = "-Users-me-work-myproject";
    const projectDir = path.join(tmpDir, ".claude", "projects", projectKey);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = "abc-123-def";
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    fs.writeFileSync(
      sessionFile,
      buildSessionJsonl(sessionId, "myproject", "/Users/me/work/myproject")
    );

    const { ClaudeCodeSessionAdapter } = await import(
      "../../src/adapters/claude-code-session.js"
    );
    const adapter = new ClaudeCodeSessionAdapter();

    const candidates = await adapter.scan({ homeDir: tmpDir });

    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe(sessionId);
    expect(candidates[0].source).toBe("claude-code-session");
    expect(candidates[0].metadata.path).toBe(sessionFile);
    expect(typeof candidates[0].metadata.modified).toBe("string");
    expect(typeof candidates[0].metadata.size_bytes).toBe("number");
    expect(candidates[0].metadata.turn_count).toBeGreaterThanOrEqual(1);
  });

  it("extract() returns ExtractedSession with condensed JSON", async () => {
    // Set up a fake session file
    const projectKey = "-Users-me-work-proj2";
    const projectDir = path.join(tmpDir, ".claude", "projects", projectKey);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = "extract-test-001";
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    fs.writeFileSync(
      sessionFile,
      buildSessionJsonl(sessionId, "proj2", "/Users/me/work/proj2")
    );

    const { ClaudeCodeSessionAdapter } = await import(
      "../../src/adapters/claude-code-session.js"
    );
    const adapter = new ClaudeCodeSessionAdapter();

    const candidate: ScanCandidate = {
      id: sessionId,
      source: "claude-code-session",
      metadata: { path: sessionFile },
    };

    const result = await adapter.extract(candidate);

    expect(result.id).toBe(sessionId);
    expect(result.source).toBe("claude-code-session");
    expect(result.project).toBe("proj2");
    expect(result.project_path).toBe("/Users/me/work/proj2");
    expect(typeof result.condensed).toBe("string");

    // condensed should be valid JSON
    const parsed = JSON.parse(result.condensed);
    expect(parsed.metadata).toBeDefined();
    expect(parsed.conversation).toBeDefined();
  });

  it("extract() throws for non-main sessions", async () => {
    // Create a subagent session file (isSidechain=true)
    const projectKey = "-Users-me-work-proj3";
    const projectDir = path.join(tmpDir, ".claude", "projects", projectKey);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = "sub-session-001";
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: "user",
        isSidechain: true,
        sessionId,
        message: { content: "subagent task" },
      }),
    ];
    fs.writeFileSync(sessionFile, lines.join("\n") + "\n");

    const { ClaudeCodeSessionAdapter } = await import(
      "../../src/adapters/claude-code-session.js"
    );
    const adapter = new ClaudeCodeSessionAdapter();

    const candidate: ScanCandidate = {
      id: sessionId,
      source: "claude-code-session",
      metadata: { path: sessionFile },
    };

    await expect(adapter.extract(candidate)).rejects.toThrow(
      /Failed to extract session.*not a main session/
    );
  });

  it("scan() returns empty array when no sessions exist", async () => {
    // tmpDir with no .claude directory at all
    const { ClaudeCodeSessionAdapter } = await import(
      "../../src/adapters/claude-code-session.js"
    );
    const adapter = new ClaudeCodeSessionAdapter();

    const candidates = await adapter.scan({ homeDir: tmpDir });
    expect(candidates).toEqual([]);
  });
});
