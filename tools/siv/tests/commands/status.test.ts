import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  computeStatus,
  formatStatus,
  executeStatus,
} from "../../src/commands/status.js";
import type { Finding, Promotion } from "../../src/types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "LRN-20260305-abc",
    ts: new Date().toISOString(),
    category: "correction",
    summary: "test summary",
    details: "test details",
    priority: "medium",
    project: "test-project",
    project_path: "/Users/me/test-project",
    session: "session-1",
    tags: [],
    related_files: [],
    source: "manual",
    status: "pending",
    ...overrides,
  };
}

function makePromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    ts: new Date().toISOString(),
    finding_ids: ["LRN-1"],
    scope: "project",
    project: "test-project",
    project_path: "/Users/me/test-project",
    category: "learning",
    rule: "Always Read before Write",
    action_taken: "create",
    target_file: "/tmp/MEMORY.md",
    ...overrides,
  };
}

// ─── computeStatus ──────────────────────────────────────────────────────

describe("computeStatus", () => {
  it("counts by status", () => {
    const findings = [
      makeFinding({ status: "pending" }),
      makeFinding({ status: "pending" }),
      makeFinding({ status: "promoted" }),
      makeFinding({ status: "dismissed" }),
    ];
    const result = computeStatus(findings, []);

    expect(result.total).toBe(4);
    expect(result.byStatus).toEqual({
      pending: 2,
      promoted: 1,
      dismissed: 1,
    });
  });

  it("counts by category", () => {
    const findings = [
      makeFinding({ category: "correction" }),
      makeFinding({ category: "correction" }),
      makeFinding({ category: "error" }),
      makeFinding({ category: "best_practice" }),
    ];
    const result = computeStatus(findings, []);

    expect(result.byCategory).toEqual({
      correction: 2,
      error: 1,
      best_practice: 1,
    });
  });

  it("counts by project", () => {
    const findings = [
      makeFinding({ project: "proj-a" }),
      makeFinding({ project: "proj-a" }),
      makeFinding({ project: "proj-b" }),
    ];
    const result = computeStatus(findings, []);

    expect(result.byProject).toEqual({ "proj-a": 2, "proj-b": 1 });
  });

  it("filters by project path", () => {
    const findings = [
      makeFinding({ project: "proj-a", project_path: "/path/a" }),
      makeFinding({ project: "proj-b", project_path: "/path/b" }),
    ];
    const result = computeStatus(findings, [], { projectPath: "/path/a" });

    expect(result.total).toBe(1);
    expect(result.byProject).toEqual({ "proj-a": 1 });
  });

  it("returns last 10 promotions sorted by date", () => {
    const promotions = Array.from({ length: 12 }, (_, i) =>
      makePromotion({
        ts: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        rule: `Rule ${i + 1}`,
      })
    );
    const result = computeStatus([], promotions);

    expect(result.recentPromotions).toHaveLength(10);
    // Most recent first
    expect(result.recentPromotions[0].ts).toBe("2026-03-12");
    expect(result.recentPromotions[0].rule).toBe("Rule 12");
  });

  it("computes pending age buckets", () => {
    const now = Date.now();
    const DAY = 86400000;
    const findings = [
      makeFinding({ ts: new Date(now - 1 * DAY).toISOString(), status: "pending" }),
      makeFinding({ ts: new Date(now - 3 * DAY).toISOString(), status: "pending" }),
      makeFinding({ ts: new Date(now - 10 * DAY).toISOString(), status: "pending" }),
      makeFinding({ ts: new Date(now - 20 * DAY).toISOString(), status: "pending" }),
      makeFinding({ ts: new Date(now - 45 * DAY).toISOString(), status: "pending" }),
      // promoted should not count
      makeFinding({ ts: new Date(now - 1 * DAY).toISOString(), status: "promoted" }),
    ];
    const result = computeStatus(findings, []);

    expect(result.pendingAge).toEqual({
      lt7: 2,
      d7to14: 1,
      d14to30: 1,
      gt30: 1,
    });
  });

  it("uses (unknown) for empty project name", () => {
    const findings = [makeFinding({ project: "" })];
    const result = computeStatus(findings, []);

    expect(result.byProject).toEqual({ "(unknown)": 1 });
  });
});

// ─── formatStatus ───────────────────────────────────────────────────────

describe("formatStatus", () => {
  it("formats output with all sections", () => {
    const result = computeStatus(
      [
        makeFinding({ status: "pending", category: "correction", project: "proj" }),
        makeFinding({ status: "promoted", category: "error", project: "proj" }),
      ],
      [makePromotion({ rule: "Always Read before Write" })]
    );

    const output = formatStatus(result);

    expect(output).toContain("siv status");
    expect(output).toContain("Findings: 2 total");
    expect(output).toContain("pending: 1");
    expect(output).toContain("promoted: 1");
    expect(output).toContain("By category:");
    expect(output).toContain("correction: 1");
    expect(output).toContain("By project:");
    expect(output).toContain("proj: 2");
    expect(output).toContain("Recent promotions");
    expect(output).toContain("Always Read before Write");
    expect(output).toContain("Pending age:");
    expect(output).toContain("< 7 days: 1");
  });

  it("shows (none) when empty", () => {
    const result = computeStatus([], []);
    const output = formatStatus(result);

    expect(output).toContain("Findings: 0 total");
    expect(output).toContain("(none)");
  });
});

// ─── executeStatus (integration) ────────────────────────────────────────

describe("executeStatus", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-status-test-"));
    const sivDir = path.join(tmpDir, ".siv");
    fs.mkdirSync(sivDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads from storage files and produces output", () => {
    const sivDir = path.join(tmpDir, ".siv");
    const finding = makeFinding({ project: "my-proj" });
    fs.writeFileSync(
      path.join(sivDir, "findings.jsonl"),
      JSON.stringify(finding) + "\n",
      "utf-8"
    );

    const promotion = makePromotion({ project: "my-proj", rule: "Test rule" });
    fs.writeFileSync(
      path.join(sivDir, "promotions.jsonl"),
      JSON.stringify(promotion) + "\n",
      "utf-8"
    );

    const output = executeStatus({}, tmpDir);

    expect(output).toContain("Findings: 1 total");
    expect(output).toContain("my-proj: 1");
    expect(output).toContain("Test rule");
  });

  it("works with empty storage", () => {
    const output = executeStatus({}, tmpDir);

    expect(output).toContain("Findings: 0 total");
  });
});
