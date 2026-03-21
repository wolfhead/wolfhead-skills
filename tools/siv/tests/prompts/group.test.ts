import { describe, it, expect } from "vitest";
import {
  buildAssignMergePrompt,
} from "../../src/prompts/group.js";

describe("buildAssignMergePrompt", () => {
  it("includes new insights in user prompt", () => {
    const result = buildAssignMergePrompt(
      [{ id: "INS-1", summary: "ask user first", details: "agent coded without asking" }],
      []
    );

    expect(result.user).toContain("INS-1");
    expect(result.user).toContain("ask user first");
  });

  it("includes existing groups when provided", () => {
    const result = buildAssignMergePrompt(
      [{ id: "INS-3", summary: "new insight", details: "details" }],
      [{ label: "ask_before_coding", merged_summary: "Ask user before implementing", count: 2 }]
    );

    expect(result.user).toContain("ask_before_coding");
    expect(result.user).toContain("Ask user before implementing");
    expect(result.user).toContain("count: 2");
  });

  it("shows (none) when no existing groups", () => {
    const result = buildAssignMergePrompt(
      [{ id: "INS-1", summary: "test", details: "" }],
      []
    );

    expect(result.user).toContain("(none)");
  });

  it("system prompt describes assign-or-create behavior", () => {
    const result = buildAssignMergePrompt([], []);

    expect(result.system).toContain("assign");
    expect(result.system).toContain("create");
    expect(result.system).toContain("merged_summary");
  });
});
