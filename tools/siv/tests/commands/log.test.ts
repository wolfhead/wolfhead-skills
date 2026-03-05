import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { executeLog } from "../../src/commands/log.js";
import { readJsonl } from "../../src/storage.js";
import type { Finding } from "../../src/types.js";

describe("executeLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-log-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends a finding to findings.jsonl", () => {
    const result = executeLog(
      {
        category: "correction",
        summary: "Test finding",
        project: "test-project",
      },
      tmpDir
    );

    expect(result.status).toBe("logged");
    expect(result.id).toMatch(/^LRN-/);

    const findings = readJsonl<Finding>(path.join(tmpDir, ".siv", "findings.jsonl"));
    expect(findings).toHaveLength(1);
    expect(findings[0].summary).toBe("Test finding");
    expect(findings[0].category).toBe("correction");
    expect(findings[0].status).toBe("pending");
    expect(findings[0].project).toBe("test-project");
  });

  it("generates ERR prefix for error category", () => {
    const result = executeLog(
      {
        category: "error",
        summary: "An error finding",
      },
      tmpDir
    );

    expect(result.id).toMatch(/^ERR-/);
  });

  it("parses comma-separated tags", () => {
    executeLog(
      {
        category: "best_practice",
        summary: "Tagged finding",
        tags: "typescript, testing, ci",
      },
      tmpDir
    );

    const findings = readJsonl<Finding>(path.join(tmpDir, ".siv", "findings.jsonl"));
    expect(findings[0].tags).toEqual(["typescript", "testing", "ci"]);
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

    const findings = readJsonl<Finding>(path.join(tmpDir, ".siv", "findings.jsonl"));
    expect(findings[0].related_files).toEqual(["src/index.ts", "src/config.ts"]);
  });

  it("uses default values for optional fields", () => {
    executeLog(
      {
        category: "feature_request",
        summary: "Minimal finding",
      },
      tmpDir
    );

    const findings = readJsonl<Finding>(path.join(tmpDir, ".siv", "findings.jsonl"));
    const f = findings[0];
    expect(f.priority).toBe("medium");
    expect(f.source).toBe("manual");
    expect(f.details).toBe("");
    expect(f.project).toBe("");
    expect(f.tags).toEqual([]);
    expect(f.related_files).toEqual([]);
  });
});
