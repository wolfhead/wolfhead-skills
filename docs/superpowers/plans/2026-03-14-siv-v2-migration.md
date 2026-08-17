# SIV v2 Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate SIV from v1 naming (Finding/Promotion) to v2 (Insight/Rule), add Source Adapter architecture, and implement emotion markers.

**Architecture:** Global rename across all types, storage, CLI commands, and config. Extract session parsing into a SourceAdapter interface with `claude-code-session` as first implementation. Add `siv mark` command and emotion marker extraction/analysis support.

**Tech Stack:** TypeScript, Commander.js, Vitest, OpenAI SDK

**Spec:** `tools/siv/docs/2026-03-14-siv-v2-design.md`

---

## File Structure

### Files to rename (git mv)
| v1 path | v2 path |
|---------|---------|
| `src/commands/promote-finding.ts` | `src/commands/consolidate.ts` |
| `src/commands/run-promotion.ts` | `src/commands/run.ts` |
| `src/prompts/promote.ts` | `src/prompts/consolidate.ts` |
| `tests/commands/promote-finding.test.ts` | `tests/commands/consolidate.test.ts` |
| `tests/commands/run-promotion.test.ts` | `tests/commands/run.test.ts` |

### Files to create
| Path | Responsibility |
|------|---------------|
| `src/adapters/types.ts` | SourceAdapter interface, ScanCandidate, ExtractedSession |
| `src/adapters/claude-code-session.ts` | Wraps existing sessions/search.ts + sessions/extract.ts |
| `src/commands/mark.ts` | `siv mark` command — print "marked" and exit |
| `tests/commands/mark.test.ts` | Tests for mark command |
| `tests/adapters/claude-code-session.test.ts` | Tests for the adapter |

### Files to modify
| Path | Nature of change |
|------|-----------------|
| `src/types.ts` | Finding→Insight, Promotion→Rule, FindingStatus→InsightStatus |
| `src/storage.ts` | generateId→INS- prefix, generatePromotionId→generateRuleId, rename all functions |
| `src/config.ts` | SIV_PROMOTE_*→SIV_CONSOLIDATE_*, findingsPath→insightsPath, promotionsPath→rulesPath |
| `src/index.ts` | Rename CLI commands, add `mark` and `--source` on analyze |
| `src/commands/analyze.ts` | Use SourceAdapter, add marker-aware analysis strategy |
| `src/commands/log.ts` | Finding→Insight throughout |
| `src/commands/group.ts` | Finding→Insight throughout |
| `src/commands/status.ts` | Finding→Insight, Promotion→Rule throughout |
| `src/commands/retrieve.ts` | Promotion→Rule throughout |
| `src/commands/doctor.ts` | findings.jsonl→insights.jsonl, promotions.jsonl→rules.jsonl |
| `src/llm.ts` | getPromoteConfig→getConsolidateConfig |
| `src/scoring.ts` | FindingCategory→InsightCategory, scoreFinding→scoreInsight |
| `src/prompts/analyze.ts` | finding→insight in prompt text + output format, add marker prompt |
| `src/prompts/distill.ts` | FindingGroup→InsightGroup, DistillOutput.promotions→.rules |
| `src/prompts/group.ts` | finding→insight in prompt text |
| `src/sessions/extract.ts` | Add EmotionMarker extraction |
| All test files | Mirror renames in source |

---

## Task 1: Global Rename

One atomic rename of all v1 names to v2. Purely mechanical — no behavior changes.

**Files:** Every `.ts` file in `src/` and `tests/`.

### Rename table (complete)

| v1 | v2 | Scope |
|---|---|---|
| `Finding` | `Insight` | Type name |
| `Promotion` | `Rule` | Type name |
| `FindingCategory` | `InsightCategory` | Type name |
| `FindingStatus` | `InsightStatus` | Type name |
| `FindingSource` | `InsightSource` | Type name |
| `"promoted"` status value | `"consolidated"` | String literal in InsightStatus |
| `finding_ids` | `insight_ids` | Field in Rule, DistillOutput, ConsolidateOptions |
| `findings.jsonl` | `insights.jsonl` | Storage file |
| `promotions.jsonl` | `rules.jsonl` | Storage file |
| `LRN-` / `ERR-` prefix | `INS-` | Insight IDs (unified, no category split) |
| `PRM-` prefix | `RUL-` | Rule IDs |
| `generateId(category)` | `generateInsightId()` | storage.ts (no category param) |
| `generatePromotionId()` | `generateRuleId()` | storage.ts |
| `updateFindingStatus()` | `updateInsightStatus()` | storage.ts |
| `updateFindingField()` | `updateInsightField()` | storage.ts |
| `updatePromotionStatus()` | `updateRuleStatus()` | storage.ts |
| `scoreFinding()` | `scoreInsight()` | scoring.ts |
| `getPromoteConfig()` | `getConsolidateConfig()` | llm.ts |
| `promoteApiKey/Base/Model` | `consolidateApiKey/Base/Model` | config.ts fields |
| `SIV_PROMOTE_*` env vars | `SIV_CONSOLIDATE_*` | config.ts env loading |
| `findingsPath` | `insightsPath` | config.ts |
| `promotionsPath` | `rulesPath` | config.ts |
| `promote_finding` command | `consolidate` | CLI |
| `run_promotion` command | `run` | CLI |
| `executePromoteFinding()` | `executeConsolidate()` | consolidate.ts |
| `PromoteFindingOptions` | `ConsolidateOptions` | consolidate.ts |
| `executeRunPromotion()` | `executeRun()` | run.ts |
| `RunPromotionOptions` | `RunOptions` | run.ts |
| `resetPromotions()` | `resetRules()` | run.ts |
| `buildGroupsFromFindings()` | `buildGroupsFromInsights()` | run.ts |
| `buildPromotePrompt()` | `buildConsolidatePrompt()` | consolidate prompt |
| `ExistingPromotion` | `ExistingRule` | consolidate prompt |
| `PromoteWriterInput/Output` | `ConsolidateWriterInput/Output` | consolidate prompt |
| `FindingGroup` | `InsightGroup` | distill.ts |
| `DistillOutput.promotions` | `DistillOutput.rules` | distill.ts (interface + LLM prompt) |
| `AnalyzeFinding` | `AnalyzeInsight` | analyze.ts |
| `AnalyzeResponse.findings` | `AnalyzeResponse.insights` | analyze.ts (interface + LLM prompt) |
| `ScanRecord.findings_count` | `ScanRecord.insights_count` | analyze.ts |

> **Note:** `promotionThreshold` and `promotionScoreThreshold` in SivConfig are NOT renamed — they are unused in current code and not listed in the spec's rename table. Can be removed in a future cleanup.

### Steps

- [ ] **Step 1: Rename files via git mv**

```bash
cd /Users/meixueting/work/wolfhead_skills/tools/siv
git mv src/commands/promote-finding.ts src/commands/consolidate.ts
git mv src/commands/run-promotion.ts src/commands/run.ts
git mv src/prompts/promote.ts src/prompts/consolidate.ts
git mv tests/commands/promote-finding.test.ts tests/commands/consolidate.test.ts
git mv tests/commands/run-promotion.test.ts tests/commands/run.test.ts
```

- [ ] **Step 2: Apply all renames across all source files**

Work through the rename table above, file by file. The order doesn't matter since this is one atomic commit. Key guidance per file:

**`src/types.ts`** — Full rewrite:
```typescript
export type InsightCategory = "correction" | "error" | "knowledge_gap" | "best_practice" | "feature_request";
export type Priority = "low" | "medium" | "high" | "critical";
export type InsightStatus = "pending" | "consolidated" | "dismissed";
export type InsightSource = "analyze" | "manual" | "hook";

export interface Insight {
  id: string;
  ts: string;
  category: InsightCategory;
  summary: string;
  details: string;
  priority: Priority;
  project: string;
  project_path: string;
  session: string;
  tags: string[];
  related_files: string[];
  source: InsightSource;
  status: InsightStatus;
  group?: string;
}

export interface Rule {
  id: string;
  ts: string;
  insight_ids: string[];
  scope: "project" | "global";
  project: string;
  project_path: string;
  category: string;
  rule: string;
  action_taken: string;
  status: "active" | "superseded";
}
```

**`src/storage.ts`** — `generateInsightId()` no longer takes a category param:
```typescript
export function generateInsightId(): string {
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const hex = crypto.randomBytes(2).toString("hex").slice(0, 3);
  return `INS-${dateStr}-${hex}`;
}

export function generateRuleId(): string {
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const hex = crypto.randomBytes(2).toString("hex").slice(0, 3);
  return `RUL-${dateStr}-${hex}`;
}
```

**`src/config.ts`** — Rename fields and env vars:
```typescript
export interface SivConfig {
  sivDir: string;
  apiKey: string;
  apiBase: string;
  model: string;
  consolidateApiKey?: string;
  consolidateApiBase?: string;
  consolidateModel?: string;
  scansPath: string;
  insightsPath: string;
  rulesPath: string;
  backupsDir: string;
  promotionThreshold: { minSessions: number; minOccurrences: number; crossProjectMinProjects: number };
  promotionScoreThreshold: number;
}
```
In `loadConfig()`: read `SIV_CONSOLIDATE_*` env vars, set `insightsPath` → `insights.jsonl`, `rulesPath` → `rules.jsonl`.

**`src/llm.ts`** — Rename `getPromoteConfig` → `getConsolidateConfig`, update field references to `consolidateModel/ApiKey/ApiBase`.

**`src/scoring.ts`** — `InsightCategory`, `scoreInsight()`.

**`src/commands/consolidate.ts`** (was promote-finding.ts) — All function/type/field renames per table. Import from `../prompts/consolidate.js`.

**`src/commands/run.ts`** (was run-promotion.ts) — All function/type/field renames. Import from `./consolidate.js`. `distilled.promotions` → `distilled.rules`, `p.finding_ids` → `p.insight_ids`.

**`src/commands/log.ts`** — `Insight`, `InsightCategory`, `InsightSource`, `generateInsightId()`, `config.insightsPath`.

**`src/commands/group.ts`** — `Insight`, `config.insightsPath`, `getConsolidateConfig`.

**`src/commands/status.ts`** — `Insight`, `Rule`, `config.insightsPath`, `config.rulesPath`. Display text: "Insights"/"rules".

**`src/commands/retrieve.ts`** — `Rule`, `config.rulesPath`.

**`src/commands/doctor.ts`** — `config.insightsPath`, `config.rulesPath`. Display text: "insights"/"rules".

**`src/commands/analyze.ts`** — `AnalyzeFinding` → `AnalyzeInsight`, `AnalyzeResponse.findings` → `.insights`, `response.findings` → `response.insights`, `findings_count` → `insights_count` in ScanRecord and logScan calls, `config.insightsPath`.

**`src/prompts/consolidate.ts`** (was promote.ts) — `ExistingRule`, `ConsolidateWriterInput/Output`, `buildConsolidatePrompt`, `insightIds`, `insight_ids`, `existingRules`. Prompt text: `PRM-xxx` → `RUL-xxx`.

**`src/prompts/distill.ts`** — `InsightGroup`, `DistillOutput.rules` (was `.promotions`), `insight_ids` (was `finding_ids`). Prompt text: "promotions" → "rules", examples updated.

**`src/prompts/group.ts`** — Prompt text: "finding" → "insight".

**`src/prompts/analyze.ts`** — Prompt text: "findings" → "insights" throughout. Output format: `{ "insights": [...] }`.

**`src/index.ts`** — `consolidate` command (was `promote_finding`), `run` command (was `run_promotion`), `--insight-ids` (was `--finding-ids`). Help text updates. CLI for consolidate:
```typescript
program
  .command("consolidate")
  .description("Consolidate a single insight into a rule")
  .requiredOption("--insight-ids <ids>", "Comma-separated insight IDs")
  .requiredOption("--scope <scope>", "project|global")
  .option("--project <name>", "Project name")
  .option("--project-path <path>", "Project path")
  .requiredOption("--category <category>", "Rule category")
  .requiredOption("--rule <rule>", "The distilled rule text")
  .action(async (options) => {
    const { executeConsolidate } = await import("./commands/consolidate.js");
    const result = await executeConsolidate({
      insightIds: options.insightIds.split(",").map((s: string) => s.trim()),
      scope: options.scope,
      project: options.project,
      projectPath: options.projectPath,
      category: options.category,
      rule: options.rule,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("run")
  .description("Run full pipeline: group → distill → consolidate")
  .option("--dry-run", "Show what would be consolidated without doing it")
  .option("--reset", "Reset all insights to pending and clear rules before running")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("--window <days>", "Days to look back", "3")
  .action(async (options) => {
    const { executeRun } = await import("./commands/run.js");
    await executeRun({
      dryRun: options.dryRun || false,
      reset: options.reset || false,
      yes: options.yes || false,
      window: parseInt(options.window),
    });
  });
```

- [ ] **Step 3: Apply all renames across all test files**

Update every test file to match source renames:
- `tests/storage.test.ts` — `generateInsightId()` (no category param, check `INS-` prefix), `generateRuleId()` (check `RUL-`), all function name renames
- `tests/config.test.ts` — `insightsPath`, `rulesPath`, `consolidateModel` etc.
- `tests/llm.test.ts` — `getConsolidateConfig`
- `tests/scoring.test.ts` — `scoreInsight`
- `tests/commands/log.test.ts` — `Insight` types, `insightsPath`
- `tests/commands/analyze.test.ts` — `AnalyzeInsight`, `response.insights`, `insights_count`
- `tests/commands/consolidate.test.ts` — `executeConsolidate`, `ConsolidateOptions`, `Rule`, `insight_ids`
- `tests/commands/run.test.ts` — `executeRun`, `RunOptions`, `InsightGroup`, `distilled.rules`, `scoreInsight`, `buildGroupsFromInsights`
- `tests/commands/status.test.ts` — `Insight`, `Rule`, `insightsPath`, `rulesPath`
- `tests/commands/retrieve.test.ts` — `Rule`, `rulesPath`
- `tests/sessions/extract.test.ts` — (no renames needed unless it imports from types.ts)
- `tests/sessions/search.test.ts` — (likely no changes)
- **`tests/e2e/smoke.test.ts`** — This file heavily uses v1 names: imports `Finding`/`Promotion`, `buildGroupsFromFindings`, `updateFindingField`, `PRM-`/`LRN-` prefixes, `findingsPath`/`promotionsPath`. ALL must be updated.
- `tests/e2e/glm5-json-mode.test.ts` — Check for v1 type references

- [ ] **Step 4: Build and test**

Run: `cd /Users/meixueting/work/wolfhead_skills/tools/siv && npx tsc --noEmit`
Expected: No errors

Run: `cd /Users/meixueting/work/wolfhead_skills/tools/siv && npx vitest run`
Expected: All PASS

- [ ] **Step 5: Verify no v1 names remain**

Run: `cd /Users/meixueting/work/wolfhead_skills/tools/siv && grep -rn 'Finding\|Promotion\|promote_finding\|run_promotion\|PRM-\|LRN-\|ERR-\|findingsPath\|promotionsPath\|getPromoteConfig\|scoreFinding' src/ tests/ --include='*.ts'`
Expected: No matches (except inside comments explaining the v1→v2 change, if any)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(siv): v2 rename — Finding→Insight, Promotion→Rule, commands, config, IDs"
```

---

## Task 2: Source Adapter Architecture

Define SourceAdapter interface, implement claude-code-session adapter, wire into analyze.

**Files:**
- Create: `src/adapters/types.ts`, `src/adapters/claude-code-session.ts`, `tests/adapters/claude-code-session.test.ts`
- Modify: `src/commands/analyze.ts`, `src/index.ts`, `tests/commands/analyze.test.ts`

### Steps

- [ ] **Step 1: Write adapter interface**

```typescript
// src/adapters/types.ts
export interface ScanOptions {
  since?: string;
  latest?: number;
  projectPath?: string;
  homeDir?: string;
}

export interface ScanCandidate {
  id: string;
  source: string;
  metadata: Record<string, unknown>;
}

export interface ExtractedSession {
  id: string;
  source: string;
  project?: string;
  project_path?: string;
  condensed: string;
  metadata: Record<string, unknown>;
}

export interface SourceAdapter {
  name: string;
  scan(options: ScanOptions): Promise<ScanCandidate[]>;
  extract(candidate: ScanCandidate): Promise<ExtractedSession>;
}
```

- [ ] **Step 2: Write adapter test**

```typescript
// tests/adapters/claude-code-session.test.ts
import { describe, it, expect } from "vitest";
import { ClaudeCodeSessionAdapter } from "../../src/adapters/claude-code-session.js";

describe("ClaudeCodeSessionAdapter", () => {
  it("has correct name", () => {
    const adapter = new ClaudeCodeSessionAdapter();
    expect(adapter.name).toBe("claude-code-session");
  });

  // Additional tests with tmpdir fixture session files for scan() and extract()
});
```

- [ ] **Step 3: Implement adapter**

```typescript
// src/adapters/claude-code-session.ts
import type { SourceAdapter, ScanOptions, ScanCandidate, ExtractedSession } from "./types.js";
import { searchSessions } from "../sessions/search.js";
import { extractSession } from "../sessions/extract.js";

export class ClaudeCodeSessionAdapter implements SourceAdapter {
  name = "claude-code-session";

  async scan(options: ScanOptions): Promise<ScanCandidate[]> {
    const sessions = searchSessions({
      latest: options.latest,
      projectPath: options.projectPath,
      since: options.since,
      minTurns: 1,
      homeDir: options.homeDir,
    });
    return sessions.map((s) => ({
      id: s.session_id,
      source: this.name,
      metadata: {
        path: s.path,
        modified: s.modified,
        size_bytes: s.size_bytes,
        turn_count: s.turn_count,
      },
    }));
  }

  async extract(candidate: ScanCandidate): Promise<ExtractedSession> {
    const filePath = candidate.metadata.path as string;
    const extraction = extractSession(filePath);
    if (!extraction) {
      throw new Error(`Failed to extract session: ${candidate.id} (not a main session)`);
    }
    return {
      id: candidate.id,
      source: this.name,
      project: extraction.metadata.slug ?? undefined,
      project_path: extraction.metadata.cwd ?? undefined,
      condensed: JSON.stringify(extraction),
      metadata: {
        ...candidate.metadata,
        model: extraction.metadata.model,
        turn_count: extraction.metadata.turn_count,
      },
    };
  }
}
```

- [ ] **Step 4: Wire into analyze command**

Add `--source` option to analyze in `index.ts`:
```typescript
.option("--source <source>", "Source adapter (claude-code-session)", "claude-code-session")
```

In `analyze.ts`, add `source?: string` to `AnalyzeOptions`. Replace `searchSessions()` call with adapter scan:
```typescript
import { ClaudeCodeSessionAdapter } from "../adapters/claude-code-session.js";

function getAdapter(source: string): SourceAdapter {
  if (source === "claude-code-session") return new ClaudeCodeSessionAdapter();
  throw new Error(`Unknown source adapter: ${source}`);
}

// In executeAnalyze:
const adapter = getAdapter(options.source ?? "claude-code-session");
const candidates = await adapter.scan({ latest: options.latest, projectPath: options.projectPath, since: options.since });
```

The rest of the analyze flow stays the same — use `candidate.metadata.path` to call `extractSession()` directly.

Add `source` field to ScanRecord:
```typescript
interface ScanRecord {
  scanned_at: string;
  source: string;        // "claude-code-session" | "daily-notes"
  session_id: string;
  file_modified: string;
  file_size_bytes: number;
  line_count: number;
  project: string;
  project_path: string;
  insights_count: number;
  chunks?: number;
  status: "ok" | "error" | "skipped";
  error?: string;
}
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/meixueting/work/wolfhead_skills/tools/siv && npx vitest run tests/adapters/ tests/commands/analyze.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(siv): add SourceAdapter interface and claude-code-session adapter"
```

---

## Task 3: `siv mark` Command

Add the emotion marker CLI command — a near no-op that prints "marked".

**Files:**
- Create: `src/commands/mark.ts`, `tests/commands/mark.test.ts`
- Modify: `src/index.ts`

### Steps

- [ ] **Step 1: Write test**

```typescript
// tests/commands/mark.test.ts
import { describe, it, expect } from "vitest";
import { executeMark } from "../../src/commands/mark.js";

describe("executeMark", () => {
  it("returns 'marked' for valid type", () => {
    expect(executeMark("frustration", "stuck on API")).toBe("marked");
  });

  it("accepts unknown types silently", () => {
    expect(executeMark("curiosity", "interesting")).toBe("marked");
  });

  it("works without context", () => {
    expect(executeMark("breakthrough")).toBe("marked");
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/commands/mark.ts
/**
 * Mark command: record an emotion marker.
 * Nearly a no-op — prints "marked" and exits. Its purpose is to leave
 * a trace in the session record (Claude Code logs all tool calls).
 * No file I/O, no network calls, no side effects.
 */
export function executeMark(type: string, context?: string): string {
  return "marked";
}
```

- [ ] **Step 3: Wire into CLI**

```typescript
program
  .command("mark")
  .description("Record an emotion marker")
  .argument("<type>", "Marker type (frustration, correction, breakthrough, surprise)")
  .argument("[context...]", "Optional free-text description")
  .action(async (type: string, context: string[]) => {
    const { executeMark } = await import("./commands/mark.js");
    const result = executeMark(type, context.join(" ") || undefined);
    console.log(result);
  });
```

- [ ] **Step 4: Test and commit**

Run: `cd /Users/meixueting/work/wolfhead_skills/tools/siv && npx vitest run tests/commands/mark.test.ts`
Expected: PASS

```bash
git add src/commands/mark.ts tests/commands/mark.test.ts src/index.ts
git commit -m "feat(siv): add siv mark command for emotion markers"
```

---

## Task 4: Emotion Marker Extraction + Marker-Aware Analysis

Extract `siv mark` calls from session JSONL and use them to focus the analysis prompt.

**Files:**
- Modify: `src/sessions/extract.ts`, `src/commands/analyze.ts`, `src/prompts/analyze.ts`
- Modify: `tests/sessions/extract.test.ts`, `tests/commands/analyze.test.ts`

### Steps

- [ ] **Step 1: Write extraction test**

Add to `tests/sessions/extract.test.ts` — create a session fixture with assistant turns containing `siv mark frustration "stuck on API"` as a Bash tool call, verify `extraction.emotion_markers` is populated.

```typescript
it("extracts emotion markers from siv mark tool calls", () => {
  // Fixture: JSONL with assistant turn containing Bash tool_use
  // where input.command = 'siv mark frustration "stuck on API"'
  const result = extractSession(fixturePath);
  expect(result).not.toBeNull();
  expect(result!.emotion_markers).toHaveLength(1);
  expect(result!.emotion_markers[0]).toEqual({
    type: "frustration",
    context: "stuck on API",
    turn_index: expect.any(Number),
  });
});
```

- [ ] **Step 2: Add EmotionMarker type and extraction to extract.ts**

```typescript
export interface EmotionMarker {
  type: string;
  context: string;
  turn_index: number;  // 0-based human-turn counter. Use as index into humanTurnPositions[].
}

// Add to SessionExtraction interface:
emotion_markers: EmotionMarker[];

/**
 * Extract emotion markers from Bash tool calls matching `siv mark <type> [context]`.
 */
export function extractEmotionMarkers(records: Rec[]): EmotionMarker[] {
  const markers: EmotionMarker[] = [];
  let turnIndex = 0;

  for (const rec of records) {
    const cat = classifyRecord(rec);
    if (cat === "human_message") {
      turnIndex++;
      continue;
    }
    if (rec.type !== "assistant") continue;

    const msg = (rec.message ?? {}) as Rec;
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Rec;
      if (b.type !== "tool_use" || b.name !== "Bash") continue;

      const input = (b.input ?? {}) as Rec;
      const command = (input.command as string) ?? "";
      if (!command.startsWith("siv mark ")) continue;

      const afterMark = command.slice("siv mark ".length).trim();
      const parts = afterMark.match(/^(\S+)\s*(.*)/);
      if (!parts) continue;

      const markerType = parts[1];
      let context = parts[2].trim();
      if ((context.startsWith('"') && context.endsWith('"')) ||
          (context.startsWith("'") && context.endsWith("'"))) {
        context = context.slice(1, -1);
      }

      markers.push({ type: markerType, context, turn_index: turnIndex });
    }
  }
  return markers;
}
```

Wire into `extractSession()`:
```typescript
return {
  // ... existing fields
  emotion_markers: extractEmotionMarkers(records),
};
```

- [ ] **Step 3: Add marker-focused prompt to analyze.ts prompt**

In `src/prompts/analyze.ts`, add `buildMarkerAnalyzePrompt()`. Reuse the quality guidance from the base prompt (extract shared sections into a const to avoid duplication):

```typescript
export function buildMarkerAnalyzePrompt(
  markers: Array<{ type: string; context: string; turn_index: number }>,
  contextWindows: string
): { system: string; user: string } {
  const system = `You are a session analyst for an AI agent self-improvement system. You extract rules from emotionally significant moments in coding sessions.

The agent flagged specific moments during this session. Analyze ONLY the flagged moments and their surrounding context to extract reusable rules.

## Marker types and what to look for

- **frustration**: Agent was stuck or retrying → look for process/tool gaps
- **correction**: User corrected the agent → look for knowledge/process gaps
- **breakthrough**: Agent figured something out after struggle → capture the insight
- **surprise**: Data or behavior was unexpected → potential new knowledge

${SHARED_QUALITY_GUIDANCE}

If there are no insights worth reporting, return: { "insights": [] }`;

  const user = `Analyze these flagged moments and their surrounding context:\n\n## Markers\n${JSON.stringify(markers, null, 2)}\n\n## Context Windows\n${contextWindows}`;

  return { system, user };
}
```

Extract the shared prompt sections (What NOT to report, Summary format, Quality bar, Output format) into a `SHARED_QUALITY_GUIDANCE` const used by both `buildAnalyzePrompt` and `buildMarkerAnalyzePrompt`.

- [ ] **Step 4: Add marker-aware analysis strategy to analyze.ts**

Add context window helpers and branching logic:

```typescript
import type { EmotionMarker } from "../sessions/extract.js";
import { buildMarkerAnalyzePrompt } from "../prompts/analyze.js";

/**
 * Deduplicate markers of same type within 3 human turns.
 * Keeps first marker in each cluster.
 */
function deduplicateMarkers(markers: EmotionMarker[]): EmotionMarker[] {
  const sorted = [...markers].sort((a, b) => a.turn_index - b.turn_index);
  const result: EmotionMarker[] = [];
  const lastKept = new Map<string, number>();

  for (const m of sorted) {
    const prev = lastKept.get(m.type);
    if (prev !== undefined && m.turn_index - prev <= 3) continue;
    result.push(m);
    lastKept.set(m.type, m.turn_index);
  }
  return result;
}

/**
 * Merge overlapping or adjacent windows.
 */
function mergeWindows(
  windows: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

/**
 * Build context windows around emotion markers.
 * Per spec: 5 human turns before + 2 human turns after each marker.
 */
function buildContextWindows(
  extraction: SessionExtraction,
  markers: EmotionMarker[]
): string {
  const conversation = extraction.conversation;
  const humanTurnPositions: number[] = [];
  for (let i = 0; i < conversation.length; i++) {
    if (conversation[i].type === "human_message") {
      humanTurnPositions.push(i);
    }
  }

  const deduped = deduplicateMarkers(markers);
  const windows: Array<{ start: number; end: number }> = [];

  for (const marker of deduped) {
    // turn_index is 0-based human-turn counter → direct index into humanTurnPositions
    const humanIdx = Math.min(marker.turn_index, humanTurnPositions.length - 1);
    const startHumanIdx = Math.max(0, humanIdx - 5);
    const endHumanIdx = Math.min(humanTurnPositions.length - 1, humanIdx + 2);
    windows.push({
      start: humanTurnPositions[startHumanIdx],
      end: endHumanIdx + 1 < humanTurnPositions.length
        ? humanTurnPositions[endHumanIdx + 1]
        : conversation.length,
    });
  }

  const merged = mergeWindows(windows);
  return merged.map((w) => JSON.stringify(conversation.slice(w.start, w.end))).join("\n\n---\n\n");
}

async function callMarkerAnalyze(
  config: SivConfig,
  markers: EmotionMarker[],
  contextWindows: string
): Promise<AnalyzeInsight[]> {
  const prompt = buildMarkerAnalyzePrompt(markers, contextWindows);
  const llmResult = await callLLM<AnalyzeResponse>(config, prompt.system, prompt.user);
  if (!llmResult.result.insights || !Array.isArray(llmResult.result.insights)) return [];
  return llmResult.result.insights;
}
```

In `executeAnalyze`, after `extractSession()`, add the binary branch:
```typescript
const markers = extraction.emotion_markers;
let insights: AnalyzeInsight[];

if (markers.length > 0) {
  const contextWindows = buildContextWindows(extraction, markers);
  insights = await callMarkerAnalyze(config, markers, contextWindows);
} else {
  insights = await analyzeExtraction(config, extraction);
}
```

> **Known limitation:** No chunking for marker-focused analysis. Marker context windows are typically much smaller than full sessions, so this is acceptable for v2.

- [ ] **Step 5: Update tests**

In `tests/sessions/extract.test.ts`: verify marker extraction.
In `tests/commands/analyze.test.ts`: add test for marker-aware path — mock a session with markers and verify focused prompt is used.

- [ ] **Step 6: Build, test, commit**

Run: `cd /Users/meixueting/work/wolfhead_skills/tools/siv && npx tsc --noEmit && npx vitest run`
Expected: All PASS

```bash
git add -A
git commit -m "feat(siv): emotion marker extraction and marker-aware analysis"
```

---

## Task 5: Verification + Version Bump

**Files:**
- Modify: `tools/siv/package.json`

### Steps

- [ ] **Step 1: Full build and test**

Run: `cd /Users/meixueting/work/wolfhead_skills/tools/siv && npx tsc --noEmit && npx vitest run`
Expected: No errors, all PASS

- [ ] **Step 2: Manual smoke test**

```bash
cd /Users/meixueting/work/wolfhead_skills/tools/siv
npx tsx src/index.ts --help           # Shows: consolidate, run, mark
npx tsx src/index.ts mark frustration "test"  # Prints: marked
npx tsx src/index.ts doctor           # Shows insights.jsonl, rules.jsonl
```

- [ ] **Step 3: Verify no v1 names in source**

```bash
cd /Users/meixueting/work/wolfhead_skills/tools/siv
grep -rn 'Finding\|Promotion\|promote_finding\|run_promotion\|PRM-\|LRN-\|ERR-\|findingsPath\|promotionsPath\|getPromoteConfig\|scoreFinding' src/ tests/ --include='*.ts'
```
Expected: No matches

- [ ] **Step 4: Bump version and commit**

Change `package.json` version: `"0.1.0"` → `"0.2.0"`

```bash
git add tools/siv/package.json
git commit -m "chore(siv): bump version to 0.2.0 for v2 migration"
```

- [ ] **Step 5: Delete v1 data files (runtime)**

```bash
rm -f ~/.siv/findings.jsonl ~/.siv/promotions.jsonl ~/.siv/scans.jsonl
```

> **Note:** Deleting `scans.jsonl` means the first `siv analyze` will re-scan ALL sessions. This is intentional per spec — clean slate for v2.

---

## Deferred Items (not in this plan)

- **Emotion skill**: Skill that teaches agents when to use `siv mark`. Guidance only, no code — create after CLI is working.
- **daily-notes adapter**: Same SourceAdapter interface, new parser. Implement when Scout integration is needed.
- **`siv doctor` v1 file warning**: Consider checking for stale `findings.jsonl`/`promotions.jsonl` in `~/.siv/`.
