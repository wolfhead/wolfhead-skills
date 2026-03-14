import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  computeStatus,
  formatStatus,
  executeStatus,
} from "../../src/commands/status.js";
import type { Insight, Rule } from "../../src/types.js";

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "INS-20260305-abc",
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

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "RUL-20260305-abc",
    ts: new Date().toISOString(),
    insight_ids: ["INS-1"],
    scope: "project",
    project: "test-project",
    project_path: "/Users/me/test-project",
    category: "learning",
    rule: "Always Read before Write",
    action_taken: "create",
    status: "active",
    ...overrides,
  };
}

// ─── computeStatus ──────────────────────────────────────────────────────

describe("computeStatus", () => {
  it("counts by status", () => {
    const insights = [
      makeInsight({ status: "pending" }),
      makeInsight({ status: "pending" }),
      makeInsight({ status: "consolidated" }),
      makeInsight({ status: "dismissed" }),
    ];
    const result = computeStatus(insights, []);

    expect(result.total).toBe(4);
    expect(result.byStatus).toEqual({
      pending: 2,
      consolidated: 1,
      dismissed: 1,
    });
  });

  it("counts by category", () => {
    const insights = [
      makeInsight({ category: "correction" }),
      makeInsight({ category: "correction" }),
      makeInsight({ category: "error" }),
      makeInsight({ category: "best_practice" }),
    ];
    const result = computeStatus(insights, []);

    expect(result.byCategory).toEqual({
      correction: 2,
      error: 1,
      best_practice: 1,
    });
  });

  it("counts by project", () => {
    const insights = [
      makeInsight({ project: "proj-a" }),
      makeInsight({ project: "proj-a" }),
      makeInsight({ project: "proj-b" }),
    ];
    const result = computeStatus(insights, []);

    expect(result.byProject).toEqual({ "proj-a": 2, "proj-b": 1 });
  });

  it("filters by project path", () => {
    const insights = [
      makeInsight({ project: "proj-a", project_path: "/path/a" }),
      makeInsight({ project: "proj-b", project_path: "/path/b" }),
    ];
    const result = computeStatus(insights, [], { projectPath: "/path/a" });

    expect(result.total).toBe(1);
    expect(result.byProject).toEqual({ "proj-a": 1 });
  });

  it("returns last 10 rules sorted by date", () => {
    const rules = Array.from({ length: 12 }, (_, i) =>
      makeRule({
        ts: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        rule: `Rule ${i + 1}`,
      })
    );
    const result = computeStatus([], rules);

    expect(result.recentRules).toHaveLength(10);
    // Most recent first
    expect(result.recentRules[0].ts).toBe("2026-03-12");
    expect(result.recentRules[0].rule).toBe("Rule 12");
  });

  it("computes pending age buckets", () => {
    const now = Date.now();
    const DAY = 86400000;
    const insights = [
      makeInsight({ ts: new Date(now - 1 * DAY).toISOString(), status: "pending" }),
      makeInsight({ ts: new Date(now - 3 * DAY).toISOString(), status: "pending" }),
      makeInsight({ ts: new Date(now - 10 * DAY).toISOString(), status: "pending" }),
      makeInsight({ ts: new Date(now - 20 * DAY).toISOString(), status: "pending" }),
      makeInsight({ ts: new Date(now - 45 * DAY).toISOString(), status: "pending" }),
      // consolidated should not count
      makeInsight({ ts: new Date(now - 1 * DAY).toISOString(), status: "consolidated" }),
    ];
    const result = computeStatus(insights, []);

    expect(result.pendingAge).toEqual({
      lt7: 2,
      d7to14: 1,
      d14to30: 1,
      gt30: 1,
    });
  });

  it("uses (unknown) for empty project name", () => {
    const insights = [makeInsight({ project: "" })];
    const result = computeStatus(insights, []);

    expect(result.byProject).toEqual({ "(unknown)": 1 });
  });
});

// ─── formatStatus ───────────────────────────────────────────────────────

describe("formatStatus", () => {
  it("formats output with all sections", () => {
    const result = computeStatus(
      [
        makeInsight({ status: "pending", category: "correction", project: "proj" }),
        makeInsight({ status: "consolidated", category: "error", project: "proj" }),
      ],
      [makeRule({ rule: "Always Read before Write" })]
    );

    const output = formatStatus(result);

    expect(output).toContain("siv status");
    expect(output).toContain("Insights: 2 total");
    expect(output).toContain("pending: 1");
    expect(output).toContain("consolidated: 1");
    expect(output).toContain("By category:");
    expect(output).toContain("correction: 1");
    expect(output).toContain("By project:");
    expect(output).toContain("proj: 2");
    expect(output).toContain("Recent rules");
    expect(output).toContain("Always Read before Write");
    expect(output).toContain("Pending age:");
    expect(output).toContain("< 7 days: 1");
  });

  it("shows (none) when empty", () => {
    const result = computeStatus([], []);
    const output = formatStatus(result);

    expect(output).toContain("Insights: 0 total");
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
    const insight = makeInsight({ project: "my-proj" });
    fs.writeFileSync(
      path.join(sivDir, "insights.jsonl"),
      JSON.stringify(insight) + "\n",
      "utf-8"
    );

    const rule = makeRule({ project: "my-proj", rule: "Test rule" });
    fs.writeFileSync(
      path.join(sivDir, "rules.jsonl"),
      JSON.stringify(rule) + "\n",
      "utf-8"
    );

    const output = executeStatus({}, tmpDir);

    expect(output).toContain("Insights: 1 total");
    expect(output).toContain("my-proj: 1");
    expect(output).toContain("Test rule");
  });

  it("works with empty storage", () => {
    const output = executeStatus({}, tmpDir);

    expect(output).toContain("Insights: 0 total");
  });
});
