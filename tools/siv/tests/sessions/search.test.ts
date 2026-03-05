import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  pathToProjectKey,
  countTurns,
  searchSessions,
} from "../../src/sessions/search.js";

describe("pathToProjectKey", () => {
  it("converts absolute path to dash-separated key", () => {
    expect(pathToProjectKey("/Users/me/work/my_project")).toBe(
      "-Users-me-work-my-project"
    );
  });

  it("strips trailing slash", () => {
    expect(pathToProjectKey("/Users/me/work/proj/")).toBe(
      "-Users-me-work-proj"
    );
  });

  it("replaces underscores with dashes", () => {
    expect(pathToProjectKey("/a/b_c/d_e")).toBe("-a-b-c-d-e");
  });

  it("handles root path", () => {
    expect(pathToProjectKey("/")).toBe("");
  });
});

/** Helper to write a JSONL file from an array of objects. */
function writeJsonl(filePath: string, records: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf-8");
}

/** Create a user text message record. */
function userMsg(text: string) {
  return { type: "user", message: { content: text } };
}

/** Create a user tool_result record. */
function toolResult() {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }],
    },
  };
}

/** Create an assistant message record. */
function assistantMsg(text: string) {
  return { type: "assistant", message: { content: text } };
}

describe("countTurns", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-turns-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("counts user text messages", () => {
    const fp = path.join(tmpDir, "session.jsonl");
    writeJsonl(fp, [
      userMsg("hello"),
      assistantMsg("hi"),
      userMsg("how are you"),
      assistantMsg("good"),
    ]);
    expect(countTurns(fp)).toBe(2);
  });

  it("skips tool_result records", () => {
    const fp = path.join(tmpDir, "session.jsonl");
    writeJsonl(fp, [
      userMsg("hello"),
      toolResult(),
      userMsg("next"),
      toolResult(),
    ]);
    expect(countTurns(fp)).toBe(2);
  });

  it("returns 0 for missing file", () => {
    expect(countTurns(path.join(tmpDir, "nonexistent.jsonl"))).toBe(0);
  });

  it("skips malformed JSON lines", () => {
    const fp = path.join(tmpDir, "bad.jsonl");
    fs.writeFileSync(fp, '{"type":"user","message":{"content":"ok"}}\nNOT JSON\n', "utf-8");
    expect(countTurns(fp)).toBe(1);
  });

  it("skips blank lines", () => {
    const fp = path.join(tmpDir, "blanks.jsonl");
    fs.writeFileSync(
      fp,
      '\n{"type":"user","message":{"content":"a"}}\n\n{"type":"user","message":{"content":"b"}}\n\n',
      "utf-8"
    );
    expect(countTurns(fp)).toBe(2);
  });
});

describe("searchSessions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-search-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Create a session file with the given number of user turns under the given project key. */
  function createSession(
    projectKey: string,
    sessionId: string,
    turnCount: number,
    subdir?: string
  ): string {
    const dir = subdir
      ? path.join(tmpDir, ".claude", "projects", projectKey, subdir)
      : path.join(tmpDir, ".claude", "projects", projectKey);
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, `${sessionId}.jsonl`);
    const records: unknown[] = [];
    for (let i = 0; i < turnCount; i++) {
      records.push(userMsg(`turn ${i}`));
      records.push(assistantMsg(`reply ${i}`));
    }
    writeJsonl(fp, records);
    return fp;
  }

  it("finds session files for a project", () => {
    createSession("-Users-me-proj", "abc-123", 5);
    const results = searchSessions({
      projectPath: "/Users/me/proj",
      homeDir: tmpDir,
      minTurns: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0].session_id).toBe("abc-123");
    expect(results[0].turn_count).toBe(5);
  });

  it("respects minTurns filter", () => {
    createSession("-Users-me-proj", "few-turns", 2);
    createSession("-Users-me-proj", "many-turns", 5);
    const results = searchSessions({
      projectPath: "/Users/me/proj",
      homeDir: tmpDir,
      minTurns: 3,
    });
    expect(results).toHaveLength(1);
    expect(results[0].session_id).toBe("many-turns");
  });

  it("skips subagent directories", () => {
    createSession("-Users-me-proj", "main-session", 5);
    createSession("-Users-me-proj", "sub-session", 5, "subagents");
    const results = searchSessions({
      projectPath: "/Users/me/proj",
      homeDir: tmpDir,
      minTurns: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0].session_id).toBe("main-session");
  });

  it("respects latest cap", () => {
    for (let i = 0; i < 10; i++) {
      const fp = createSession("-Users-me-proj", `session-${i}`, 5);
      // Stagger mtime so ordering is deterministic
      const t = new Date(2026, 0, 1 + i);
      fs.utimesSync(fp, t, t);
    }
    const results = searchSessions({
      projectPath: "/Users/me/proj",
      homeDir: tmpDir,
      minTurns: 1,
      latest: 3,
    });
    expect(results).toHaveLength(3);
    // Most recent first
    expect(results[0].session_id).toBe("session-9");
    expect(results[1].session_id).toBe("session-8");
    expect(results[2].session_id).toBe("session-7");
  });

  it("returns empty array when projects dir does not exist", () => {
    const results = searchSessions({
      projectPath: "/Users/me/proj",
      homeDir: path.join(tmpDir, "nonexistent"),
    });
    expect(results).toEqual([]);
  });

  it("searches all projects when projectPath is omitted", () => {
    createSession("-Users-me-projA", "sess-a", 5);
    createSession("-Users-me-projB", "sess-b", 5);
    const results = searchSessions({
      homeDir: tmpDir,
      minTurns: 1,
      latest: 10,
    });
    expect(results).toHaveLength(2);
  });

  it("filters by date", () => {
    const fp1 = createSession("-Users-me-proj", "old-session", 5);
    const fp2 = createSession("-Users-me-proj", "new-session", 5);
    // Set mtime: old = 2026-01-01, new = 2026-01-15
    fs.utimesSync(fp1, new Date("2026-01-01T12:00:00Z"), new Date("2026-01-01T12:00:00Z"));
    fs.utimesSync(fp2, new Date("2026-01-15T12:00:00Z"), new Date("2026-01-15T12:00:00Z"));

    const results = searchSessions({
      projectPath: "/Users/me/proj",
      homeDir: tmpDir,
      since: "2026-01-10",
      minTurns: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0].session_id).toBe("new-session");
  });

  it("result includes expected fields", () => {
    createSession("-Users-me-proj", "abc-123", 4);
    const results = searchSessions({
      projectPath: "/Users/me/proj",
      homeDir: tmpDir,
      minTurns: 1,
    });
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r).toHaveProperty("path");
    expect(r).toHaveProperty("session_id", "abc-123");
    expect(r).toHaveProperty("modified");
    expect(r).toHaveProperty("size_bytes");
    expect(r).toHaveProperty("turn_count", 4);
    expect(typeof r.size_bytes).toBe("number");
    expect(r.modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});
