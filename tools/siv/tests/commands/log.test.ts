import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { executeLog } from "../../src/commands/log.js";
import { readJsonl } from "../../src/storage.js";
import type { Insight } from "../../src/types.js";

describe("executeLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-log-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends an insight to insights.jsonl", () => {
    const result = executeLog(
      {
        category: "correction",
        summary: "Test insight",
        project: "test-project",
      },
      tmpDir
    );

    expect(result.status).toBe("logged");
    expect(result.id).toMatch(/^INS-/);

    const insights = readJsonl<Insight>(path.join(tmpDir, ".siv", "insights.jsonl"));
    expect(insights).toHaveLength(1);
    expect(insights[0].summary).toBe("Test insight");
    expect(insights[0].category).toBe("correction");
    expect(insights[0].status).toBe("pending");
    expect(insights[0].project).toBe("test-project");
  });

  it("generates INS prefix for all categories", () => {
    const result = executeLog(
      {
        category: "error",
        summary: "An error insight",
      },
      tmpDir
    );

    expect(result.id).toMatch(/^INS-/);
  });

  it("parses comma-separated tags", () => {
    executeLog(
      {
        category: "best_practice",
        summary: "Tagged insight",
        tags: "typescript, testing, ci",
      },
      tmpDir
    );

    const insights = readJsonl<Insight>(path.join(tmpDir, ".siv", "insights.jsonl"));
    expect(insights[0].tags).toEqual(["typescript", "testing", "ci"]);
  });

  it("parses comma-separated related files", () => {
    executeLog(
      {
        category: "knowledge_gap",
        summary: "Related files test",
        related: "src/index.ts, src/config.ts",
      },
      tmpDir
    );

    const insights = readJsonl<Insight>(path.join(tmpDir, ".siv", "insights.jsonl"));
    expect(insights[0].related_files).toEqual(["src/index.ts", "src/config.ts"]);
  });

  it("uses default values for optional fields", () => {
    executeLog(
      {
        category: "feature_request",
        summary: "Minimal insight",
      },
      tmpDir
    );

    const insights = readJsonl<Insight>(path.join(tmpDir, ".siv", "insights.jsonl"));
    const f = insights[0];
    expect(f.priority).toBe("medium");
    expect(f.source).toBe("manual");
    expect(f.details).toBe("");
    expect(f.project).toBe("");
    expect(f.tags).toEqual([]);
    expect(f.related_files).toEqual([]);
  });
});
