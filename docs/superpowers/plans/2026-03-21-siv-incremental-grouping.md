# SIV Incremental Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic group LLM call with batched incremental assign-and-merge, so prompt size stays bounded regardless of total insight count.

**Architecture:** New `groups.jsonl` stores accumulated group state (label + merged_summary + insight_ids + count). A new `assign-and-merge` prompt sends batches of ~10 new insights + existing group summaries to the LLM. The LLM assigns each insight to an existing group or creates a new one, returning updated merged summaries. `executeGroup` processes insights in batches, updating `groups.jsonl` after each. The downstream `run.ts` pipeline reads group labels from insights.jsonl as before — no changes needed there.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config.ts` | Modify | Add `groupsPath` to SivConfig |
| `src/prompts/group.ts` | Rewrite | New `buildAssignMergePrompt` replacing `buildGroupPrompt` |
| `src/commands/group.ts` | Rewrite | Batched incremental grouping with groups.jsonl |
| `src/storage.ts` | Add helpers | `readGroups` / `writeGroups` for groups.jsonl |
| `tests/commands/group.test.ts` | Create | Tests for new incremental grouping |
| `tests/prompts/group.test.ts` | Create | Tests for new prompt builder |
| `tests/commands/run.test.ts` | Modify | Update mock for new executeGroup signature |

---

### Task 1: Add groupsPath to config and group storage helpers

**Files:**
- Modify: `tools/siv/src/config.ts`
- Modify: `tools/siv/src/storage.ts`
- Create: `tools/siv/tests/storage-groups.test.ts`

- [ ] **Step 1: Write tests for group storage helpers**

Create `tools/siv/tests/storage-groups.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { readGroups, writeGroups, type GroupEntry } from "../src/storage.js";

describe("group storage", () => {
  let tmpDir: string;
  let groupsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-groups-test-"));
    groupsPath = path.join(tmpDir, "groups.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readGroups returns empty array for missing file", () => {
    expect(readGroups(groupsPath)).toEqual([]);
  });

  it("writeGroups creates file and readGroups reads it back", () => {
    const groups: GroupEntry[] = [
      {
        label: "ask_before_implementing",
        merged_summary: "Present approach to user before writing code",
        insight_ids: ["INS-001", "INS-002"],
        count: 2,
      },
    ];

    writeGroups(groupsPath, groups);
    const result = readGroups(groupsPath);

    expect(result).toEqual(groups);
  });

  it("writeGroups overwrites existing file", () => {
    const v1: GroupEntry[] = [
      { label: "old", merged_summary: "old summary", insight_ids: ["INS-1"], count: 1 },
    ];
    const v2: GroupEntry[] = [
      { label: "new", merged_summary: "new summary", insight_ids: ["INS-2"], count: 1 },
    ];

    writeGroups(groupsPath, v1);
    writeGroups(groupsPath, v2);
    const result = readGroups(groupsPath);

    expect(result).toEqual(v2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/siv && npx vitest run tests/storage-groups.test.ts`
Expected: FAIL — `readGroups` and `writeGroups` don't exist yet.

- [ ] **Step 3: Add GroupEntry type and helpers to storage.ts**

In `tools/siv/src/storage.ts`, add at the end:

```typescript
export interface GroupEntry {
  label: string;
  merged_summary: string;
  insight_ids: string[];
  count: number;
}

/**
 * Read all group entries from a groups.jsonl file.
 */
export function readGroups(filePath: string): GroupEntry[] {
  return readJsonl<GroupEntry>(filePath);
}

/**
 * Write group entries to a groups.jsonl file, overwriting existing content.
 */
export function writeGroups(filePath: string, groups: GroupEntry[]): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const content = groups.map((g) => JSON.stringify(g)).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf-8");
}
```

- [ ] **Step 4: Add groupsPath to SivConfig**

In `tools/siv/src/config.ts`, add `groupsPath: string;` to the `SivConfig` interface (after `rulesPath`), and in `loadConfig` return object add:

```typescript
groupsPath: path.join(sivDir, "groups.jsonl"),
```

- [ ] **Step 5: Run tests**

Run: `cd tools/siv && npx vitest run tests/storage-groups.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite to verify nothing broke**

Run: `cd tools/siv && npx vitest run`
Expected: All tests pass. Some tests mock `loadConfig` — they will still work because the mock returns a fixed object and callers that don't use `groupsPath` won't break.

- [ ] **Step 7: Commit**

```bash
git add tools/siv/src/config.ts tools/siv/src/storage.ts tools/siv/tests/storage-groups.test.ts
git commit -m "feat(siv): add groups.jsonl storage and groupsPath config"
```

---

### Task 2: Build the assign-and-merge prompt

**Files:**
- Rewrite: `tools/siv/src/prompts/group.ts`
- Create: `tools/siv/tests/prompts/group.test.ts`

- [ ] **Step 1: Write tests for the new prompt**

Create `tools/siv/tests/prompts/group.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildAssignMergePrompt,
  type AssignMergeOutput,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/siv && npx vitest run tests/prompts/group.test.ts`
Expected: FAIL — `buildAssignMergePrompt` doesn't exist.

- [ ] **Step 3: Rewrite prompts/group.ts**

Replace the entire content of `tools/siv/src/prompts/group.ts` with:

```typescript
/**
 * Build the assign-and-merge prompt for incremental insight grouping.
 *
 * Given a batch of new insights and existing group summaries,
 * the LLM assigns each new insight to an existing group or creates
 * a new one, returning updated merged summaries.
 */

export interface AssignMergeInput {
  id: string;
  summary: string;
  details: string;
}

export interface ExistingGroupSummary {
  label: string;
  merged_summary: string;
  count: number;
}

export interface AssignMergeOutput {
  assignments: Array<{
    insight_id: string;
    label: string;
    is_new: boolean;
    merged_summary: string;
  }>;
}

export function buildAssignMergePrompt(
  newInsights: AssignMergeInput[],
  existingGroups: ExistingGroupSummary[]
): {
  system: string;
  user: string;
} {
  const system = `You are an insight grouping engine. For each new insight, either assign it to an existing group or create a new group.

## Decision logic

For each new insight:
1. If it gives the SAME actionable advice as an existing group -> assign to that group
2. If it gives the same advice as another NEW insight in this batch -> create a new group containing both
3. If it is unique -> create a new group for it alone

## What "same advice" means

Two insights belong together ONLY if:
- They recommend the same concrete action (e.g., both say "ask user before coding")
- They could be merged into one rule without losing distinct advice

They do NOT belong together if:
- They share a topic/domain but give different advice
- Merging them would produce a vague umbrella rule

## Output

For each assignment, provide:
- insight_id: the ID of the new insight
- label: snake_case group key (2-5 words describing the specific advice). Use the existing group's label if assigning to an existing group.
- is_new: true if this creates a new group, false if assigning to existing
- merged_summary: updated one-sentence summary that covers ALL insights in the group (existing + new). Must be a "when X, do/don't Y" rule.

## Label format

2-5 words, snake_case, describing the specific advice (not the domain).

## Return format

Return ONLY valid JSON:
{
  "assignments": [
    {
      "insight_id": "INS-xxx",
      "label": "group_key",
      "is_new": true,
      "merged_summary": "When X, do Y"
    }
  ]
}

Every insight ID from the input must appear exactly once in the output.`;

  const existingText =
    existingGroups.length === 0
      ? "(none)"
      : existingGroups
          .map((g) => `- ${g.label} (count: ${g.count}): ${g.merged_summary}`)
          .join("\n");

  const insightsText = JSON.stringify(
    newInsights.map((i) => ({ id: i.id, summary: i.summary, details: i.details })),
    null,
    2
  );

  const user = `## Existing groups

${existingText}

## New insights to assign

${insightsText}`;

  return { system, user };
}
```

- [ ] **Step 4: Run tests**

Run: `cd tools/siv && npx vitest run tests/prompts/group.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/siv/src/prompts/group.ts tools/siv/tests/prompts/group.test.ts
git commit -m "feat(siv): add assign-and-merge prompt for incremental grouping"
```

---

### Task 3: Rewrite executeGroup with batched incremental logic

**Files:**
- Rewrite: `tools/siv/src/commands/group.ts`
- Create: `tools/siv/tests/commands/group.test.ts`

- [ ] **Step 1: Write tests for new executeGroup**

Create `tools/siv/tests/commands/group.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const mockCallLLM = vi.fn();
vi.mock("../../src/llm.js", () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
  getConsolidateConfig: (config: unknown) => config,
}));

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from "../../src/config.js";
import { executeGroup } from "../../src/commands/group.js";
import type { Insight } from "../../src/types.js";
import type { GroupEntry } from "../../src/storage.js";

const mockedLoadConfig = vi.mocked(loadConfig);

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "INS-20260321-abc",
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
    source: "analyze",
    status: "pending",
    ...overrides,
  };
}

describe("executeGroup", () => {
  let tmpDir: string;
  let insightsPath: string;
  let groupsPath: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "siv-group-test-"));
    const sivDir = path.join(tmpDir, ".siv");
    fs.mkdirSync(sivDir, { recursive: true });
    insightsPath = path.join(sivDir, "insights.jsonl");
    groupsPath = path.join(sivDir, "groups.jsonl");

    mockedLoadConfig.mockReturnValue({
      sivDir,
      apiKey: "test-key",
      apiBase: "https://api.test.com",
      model: "test-model",
      scansPath: path.join(sivDir, "scans.jsonl"),
      insightsPath,
      rulesPath: path.join(sivDir, "rules.jsonl"),
      groupsPath,
      backupsDir: path.join(sivDir, "backups"),
      promotionThreshold: { minSessions: 2, minOccurrences: 3, crossProjectMinProjects: 2 },
      promotionScoreThreshold: 6,
    });

    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeInsight(insight: Insight): void {
    fs.appendFileSync(insightsPath, JSON.stringify(insight) + "\n", "utf-8");
  }

  function writeGroup(group: GroupEntry): void {
    fs.appendFileSync(groupsPath, JSON.stringify(group) + "\n", "utf-8");
  }

  it("assigns new insights to groups and updates groups.jsonl", async () => {
    writeInsight(makeInsight({ id: "INS-1", summary: "ask user before coding" }));
    writeInsight(makeInsight({ id: "INS-2", summary: "get approval before implementing" }));

    mockCallLLM.mockResolvedValue({
      result: {
        assignments: [
          { insight_id: "INS-1", label: "ask_before_coding", is_new: true, merged_summary: "Ask user before writing code" },
          { insight_id: "INS-2", label: "ask_before_coding", is_new: false, merged_summary: "Present approach and get approval before writing code" },
        ],
      },
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await executeGroup({ yes: true }, tmpDir);

    // Check insights got group labels
    const insights = fs.readFileSync(insightsPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(insights[0].group).toBe("ask_before_coding");
    expect(insights[1].group).toBe("ask_before_coding");

    // Check groups.jsonl was written
    const groups = fs.readFileSync(groupsPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("ask_before_coding");
    expect(groups[0].count).toBe(2);
    expect(groups[0].insight_ids).toEqual(["INS-1", "INS-2"]);
  });

  it("passes existing groups to the LLM prompt", async () => {
    // Pre-existing group
    writeGroup({
      label: "ask_before_coding",
      merged_summary: "Ask user before writing code",
      insight_ids: ["INS-OLD"],
      count: 1,
    });
    // Pre-existing insight (already grouped)
    writeInsight(makeInsight({ id: "INS-OLD", group: "ask_before_coding" }));
    // New ungrouped insight
    writeInsight(makeInsight({ id: "INS-NEW", summary: "get approval first" }));

    mockCallLLM.mockResolvedValue({
      result: {
        assignments: [
          { insight_id: "INS-NEW", label: "ask_before_coding", is_new: false, merged_summary: "Present approach and get approval before writing code" },
        ],
      },
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    await executeGroup({ yes: true }, tmpDir);

    // LLM should have been called with only the ungrouped insight
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const [, , userPrompt] = mockCallLLM.mock.calls[0];
    expect(userPrompt).toContain("INS-NEW");
    expect(userPrompt).not.toContain("INS-OLD");
    // Existing group should be in context
    expect(userPrompt).toContain("ask_before_coding");

    // groups.jsonl should be updated
    const groups = fs.readFileSync(groupsPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    const g = groups.find((g: GroupEntry) => g.label === "ask_before_coding");
    expect(g.count).toBe(2);
    expect(g.insight_ids).toContain("INS-OLD");
    expect(g.insight_ids).toContain("INS-NEW");
  });

  it("skips when no ungrouped insights", async () => {
    writeInsight(makeInsight({ id: "INS-1", group: "existing_group" }));

    await executeGroup({ yes: true }, tmpDir);

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No ungrouped insights"));
  });

  it("processes in batches of BATCH_SIZE", async () => {
    // Write 15 insights — should result in 2 batches (10 + 5)
    for (let i = 1; i <= 15; i++) {
      writeInsight(makeInsight({ id: `INS-${i}`, summary: `insight ${i}` }));
    }

    // First batch: 10 insights
    mockCallLLM.mockResolvedValueOnce({
      result: {
        assignments: Array.from({ length: 10 }, (_, i) => ({
          insight_id: `INS-${i + 1}`,
          label: `group_${(i % 3) + 1}`,
          is_new: i < 3,
          merged_summary: `Summary for group ${(i % 3) + 1}`,
        })),
      },
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    // Second batch: 5 insights, with existing groups from first batch
    mockCallLLM.mockResolvedValueOnce({
      result: {
        assignments: Array.from({ length: 5 }, (_, i) => ({
          insight_id: `INS-${i + 11}`,
          label: `group_${(i % 3) + 1}`,
          is_new: false,
          merged_summary: `Updated summary for group ${(i % 3) + 1}`,
        })),
      },
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    await executeGroup({ yes: true }, tmpDir);

    expect(mockCallLLM).toHaveBeenCalledTimes(2);

    // Second call should include existing groups from first batch
    const [, , secondUserPrompt] = mockCallLLM.mock.calls[1];
    expect(secondUserPrompt).toContain("group_1");
    expect(secondUserPrompt).toContain("group_2");
    expect(secondUserPrompt).toContain("group_3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/siv && npx vitest run tests/commands/group.test.ts`
Expected: FAIL — the current `executeGroup` has different behavior.

- [ ] **Step 3: Rewrite commands/group.ts**

Replace the entire content of `tools/siv/src/commands/group.ts` with:

```typescript
/**
 * Group command: incrementally assign insights to semantic groups.
 *
 * Processes ungrouped insights in batches. Each batch is sent to the LLM
 * along with existing group summaries. The LLM assigns each insight to
 * an existing group or creates a new one.
 *
 * State is persisted in groups.jsonl (accumulated group summaries)
 * and the `group` field on each insight in insights.jsonl.
 */

import fs from "fs";
import { loadConfig } from "../config.js";
import {
  readJsonl,
  updateInsightField,
  readGroups,
  writeGroups,
  type GroupEntry,
} from "../storage.js";
import { callLLM, getConsolidateConfig } from "../llm.js";
import {
  buildAssignMergePrompt,
  type AssignMergeOutput,
} from "../prompts/group.js";
import type { Insight } from "../types.js";

export const BATCH_SIZE = 10;

export interface GroupOptions {
  dryRun?: boolean;
  reset?: boolean;
  yes?: boolean;
}

/**
 * Reset groups: clear group field from all insights and delete groups.jsonl.
 */
function resetGroups(insightsPath: string, groupsPath: string): void {
  // Clear group field from insights
  if (fs.existsSync(insightsPath)) {
    const content = fs.readFileSync(insightsPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    const updated = lines.map((line) => {
      try {
        const obj = JSON.parse(line);
        delete obj.group;
        return JSON.stringify(obj);
      } catch {
        return line;
      }
    });
    fs.writeFileSync(insightsPath, updated.join("\n") + "\n", "utf-8");
  }

  // Delete groups.jsonl
  if (fs.existsSync(groupsPath)) {
    fs.unlinkSync(groupsPath);
  }
}

export async function executeGroup(
  options: GroupOptions = {},
  homeDir?: string
): Promise<void> {
  const config = loadConfig(homeDir);

  if (options.reset) {
    const allInsights = readJsonl<Insight>(config.insightsPath);
    const grouped = allInsights.filter((f) => f.group).length;
    console.log(`Clearing group field from ${grouped} insights and deleting groups.jsonl.`);

    if (!options.yes) {
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ok = await new Promise<boolean>((resolve) => {
        rl.question("Continue? [y/N] ", (answer) => {
          rl.close();
          resolve(answer.trim().toLowerCase() === "y");
        });
      });
      if (!ok) {
        console.log("Aborted.");
        return;
      }
    }

    resetGroups(config.insightsPath, config.groupsPath);
    console.log("Reset complete.");
  }

  // Read current state
  const allInsights = readJsonl<Insight>(config.insightsPath);
  const ungrouped = allInsights.filter((f) => !f.group);

  if (ungrouped.length === 0) {
    console.log("No ungrouped insights to process.");
    return;
  }

  // Load existing groups
  let groups = readGroups(config.groupsPath);
  const consolidateConfig = getConsolidateConfig(config);

  // Process in batches
  for (let i = 0; i < ungrouped.length; i += BATCH_SIZE) {
    const batch = ungrouped.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(ungrouped.length / BATCH_SIZE);

    if (totalBatches > 1) {
      console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} insights)...`);
    }

    const { system, user } = buildAssignMergePrompt(
      batch.map((f) => ({ id: f.id, summary: f.summary, details: f.details })),
      groups.map((g) => ({ label: g.label, merged_summary: g.merged_summary, count: g.count }))
    );

    const { result } = await callLLM<AssignMergeOutput>(consolidateConfig, system, user);

    // Apply assignments: update groups state and collect insight->label mapping
    const idToGroup = new Map<string, string>();

    for (const assignment of result.assignments) {
      idToGroup.set(assignment.insight_id, assignment.label);

      const existing = groups.find((g) => g.label === assignment.label);
      if (existing) {
        // Update existing group
        existing.insight_ids.push(assignment.insight_id);
        existing.count = existing.insight_ids.length;
        existing.merged_summary = assignment.merged_summary;
      } else {
        // Create new group
        groups.push({
          label: assignment.label,
          merged_summary: assignment.merged_summary,
          insight_ids: [assignment.insight_id],
          count: 1,
        });
      }
    }

    // Write group labels back to insights.jsonl
    if (!options.dryRun) {
      updateInsightField(config.insightsPath, idToGroup, "group");
    }
  }

  // Write updated groups.jsonl
  if (!options.dryRun) {
    writeGroups(config.groupsPath, groups);
  }

  // Print results
  const sorted = [...groups].sort((a, b) => b.count - a.count);
  for (const g of sorted) {
    console.log(`\n[${g.label}] (${g.count} insights)`);
    console.log(`  ${g.merged_summary}`);
  }

  console.log(`\nGrouped ${ungrouped.length} insights into ${groups.length} groups.`);

  if (options.dryRun) {
    console.log("Dry run — no files updated.");
  }
}
```

- [ ] **Step 4: Run group tests**

Run: `cd tools/siv && npx vitest run tests/commands/group.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/siv/src/commands/group.ts tools/siv/tests/commands/group.test.ts
git commit -m "feat(siv): rewrite executeGroup with batched incremental grouping"
```

---

### Task 4: Update run.ts and its tests for new groupsPath config

**Files:**
- Modify: `tools/siv/tests/commands/run.test.ts`
- Modify: `tools/siv/tests/commands/analyze.test.ts`
- Modify: `tools/siv/tests/adapters/claude-code-session.test.ts`

The `loadConfig` mock in several test files needs `groupsPath` added. While there, also add any missing `SivConfig` fields (`scansPath`, `promotionScoreThreshold`) to each mock for correctness. The `run.ts` source code itself doesn't need changes — it calls `executeGroup` which handles everything, and reads group labels from insights.jsonl as before.

- [ ] **Step 1: Update loadConfig mock in run.test.ts**

In `tools/siv/tests/commands/run.test.ts`, find the `mockedLoadConfig.mockReturnValue({` block (~line 145) and add:

```typescript
groupsPath: path.join(sivDir, "groups.jsonl"),
scansPath: path.join(sivDir, "scans.jsonl"),  // add if missing
```

Also verify `promotionScoreThreshold: 6` is present in the mock (it should be).

- [ ] **Step 2: Update loadConfig mock in analyze.test.ts**

In `tools/siv/tests/commands/analyze.test.ts`, find the `loadConfig: vi.fn(() => ({` block (~line 6) and add:

```typescript
groupsPath: "/tmp/siv-test/groups.jsonl",
promotionScoreThreshold: 6,  // add if missing
```

- [ ] **Step 3: Check all other test files for loadConfig mocks**

Search for all files that mock `loadConfig` and ensure each mock object has `groupsPath`, `scansPath`, and `promotionScoreThreshold`. Files to check:
- `tools/siv/tests/commands/consolidate.test.ts`
- `tools/siv/tests/commands/status.test.ts`
- `tools/siv/tests/commands/retrieve.test.ts`
- `tools/siv/tests/adapters/claude-code-session.test.ts`
- `tools/siv/tests/e2e/smoke.test.ts`

For each, add missing fields to the mock return value.

- [ ] **Step 4: Run full test suite**

Run: `cd tools/siv && npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Run TypeScript check**

Run: `cd tools/siv && npx tsc --noEmit`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add tools/siv/tests/
git commit -m "chore(siv): add groupsPath to loadConfig mocks in test files"
```

---

### Task 5: Update MAX_SESSIONS and commit search.ts change

**Files:**
- Modify: `tools/siv/src/sessions/search.ts` (already modified in working tree)

- [ ] **Step 1: Verify the search.ts changes are correct**

The file should already have:
- `MAX_SESSIONS = 200` (changed from 20)
- Smart cap logic: when `--since` or `--date` is given without explicit `--latest`, use `MAX_SESSIONS` instead of `DEFAULT_LATEST`

Run: `cd tools/siv && npx vitest run tests/sessions/search.test.ts`
Expected: All search tests pass.

- [ ] **Step 2: Run full test suite**

Run: `cd tools/siv && npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tools/siv/src/sessions/search.ts
git commit -m "feat(siv): raise MAX_SESSIONS to 200 and use smart cap with date filters"
```

---

### Task 6: E2E verification

- [ ] **Step 1: Build**

Run: `cd tools/siv && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 2: Run full test suite**

Run: `cd tools/siv && npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Manual E2E test with real data**

Clear and re-run on the week's sessions:

```bash
cd tools/siv
: > ~/.siv/insights.jsonl && : > ~/.siv/rules.jsonl && : > ~/.siv/scans.jsonl && rm -f ~/.siv/groups.jsonl
npx tsx src/index.ts analyze --since 2026-03-14
npx tsx src/index.ts run -y --window 8
```

Verify:
- Analyze completes (skips marker-less sessions)
- Group step processes in batches (should see batch progress for 29 insights)
- `~/.siv/groups.jsonl` contains group entries with labels, merged summaries, and counts
- Rules are generated in `~/.siv/rules.jsonl`

- [ ] **Step 4: Commit any fixes needed**
