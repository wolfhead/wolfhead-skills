# SIV Markers-Only Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the full-session scan path from `siv analyze` so only sessions with emotion markers get analyzed.

**Architecture:** In `analyze.ts`, sessions without markers get skipped (logged as "no markers"). The `if/else` branch collapses to marker-only. Dead code (`buildAnalyzePrompt`, `analyzeExtraction`, `chunkConversation`, `callAnalyze`, `MAX_CHUNK_SIZE`) gets deleted. Tests updated to match.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Update analyze command to skip marker-less sessions

**Files:**
- Modify: `tools/siv/src/commands/analyze.ts`

- [ ] **Step 1: Write failing test — sessions without markers are skipped**

In `tools/siv/tests/commands/analyze.test.ts`, replace the test `"uses full-scan analysis when no emotion_markers"` (line 482-521) with:

```typescript
it("skips sessions without emotion markers", async () => {
  mockSearchSessions.mockReturnValue([
    {
      path: "/sessions/nomark.jsonl",
      session_id: "sess-nomark",
      modified: "2026-03-01T00:00:00",
      size_bytes: 1000,
      turn_count: 5,
    },
  ]);

  mockExtractSession.mockReturnValue({
    metadata: { session_id: "sess-nomark", slug: "proj", cwd: "/proj" },
    conversation: [],
    skills: [],
    subagents: [],
    tool_failures: [],
    tool_usage_summary: {},
    api_errors: [],
    compactions: [],
    subagent_files: [],
    emotion_markers: [],
  });

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await executeAnalyze({});

  // Should NOT call LLM at all for marker-less sessions
  expect(mockCallLLM).not.toHaveBeenCalled();
  expect(mockExecuteLog).not.toHaveBeenCalled();

  // Should log skip reason
  expect(logSpy).toHaveBeenCalledWith(
    expect.stringContaining("no markers")
  );

  logSpy.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/siv && npx vitest run tests/commands/analyze.test.ts -v`
Expected: FAIL — the current code calls `callLLM` for marker-less sessions.

- [ ] **Step 3: Update analyze.ts — skip sessions without markers**

In `tools/siv/src/commands/analyze.ts`, replace the entire `try` block at lines 183-235 (from `const markers = extraction.emotion_markers;` through the `logScan` success call, `sessionsAnalyzed++`, and `console.log` with chunk note):

```typescript
    try {
      const markers = extraction.emotion_markers;

      if (markers.length === 0) {
        logScan(config, {
          session_id: candidate.id,
          source: adapter.name,
          file_modified: modified,
          file_size_bytes: sizeBytes,
          line_count: countLines(filePath),
          project,
          project_path: projectPath,
          insights_count: 0,
          status: "skipped",
          error: "no markers",
        });
        console.log(`Skipping ${candidate.id} (no markers)`);
        continue;
      }

      const contextWindows = buildContextWindows(extraction, markers);
      const insights = await callMarkerAnalyze(config, markers, contextWindows);

      for (const insight of insights) {
        const category = VALID_CATEGORIES.has(insight.category)
          ? (insight.category as InsightCategory)
          : "best_practice";
        const priority = VALID_PRIORITIES.has(insight.priority)
          ? (insight.priority as Priority)
          : "medium";

        executeLog({
          category,
          summary: insight.summary,
          details: insight.details || "",
          priority,
          project,
          projectPath,
          session: candidate.id,
          source: "analyze",
          tags: Array.isArray(insight.tags) ? insight.tags.join(", ") : "",
        });

        totalInsights++;
      }

      logScan(config, {
        session_id: candidate.id,
        source: adapter.name,
        file_modified: modified,
        file_size_bytes: sizeBytes,
        line_count: countLines(filePath),
        project,
        project_path: projectPath,
        insights_count: insights.length,
        status: "ok",
      });

      sessionsAnalyzed++;
      console.log(
        `Analyzed ${candidate.id}: ${insights.length} insight(s)`
      );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools/siv && npx vitest run tests/commands/analyze.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/siv/src/commands/analyze.ts tools/siv/tests/commands/analyze.test.ts
git commit -m "feat(siv): skip sessions without emotion markers in analyze"
```

---

### Task 2: Remove dead full-scan code from analyze.ts

**Files:**
- Modify: `tools/siv/src/commands/analyze.ts`

- [ ] **Step 1: Delete dead functions from analyze.ts**

Remove these functions, constants, and interfaces from `tools/siv/src/commands/analyze.ts`:
- `MAX_CHUNK_SIZE` constant (line 74)
- `analyzeExtraction` function (lines 264-296)
- `callAnalyze` function (lines 298-314)
- `chunkConversation` function (lines 320-368)
- `chunks?: number` field from the `ScanRecord` interface (line 58) — no longer populated

Also remove the unused import of `extractSession` and `ConversationTurn` if they become unused after the deletion (check: `ConversationTurn` is still used by `chunkConversation` which is being deleted, but also by `buildContextWindows` — verify `buildContextWindows` only uses it via `extraction.conversation` which is typed by `SessionExtraction`).

Remove the now-unused import of `buildAnalyzePrompt` from the import statement at line 20:
```typescript
// Before:
import {
  buildAnalyzePrompt,
  buildMarkerAnalyzePrompt,
} from "../prompts/analyze.js";

// After:
import { buildMarkerAnalyzePrompt } from "../prompts/analyze.js";
```

Remove the unused `ConversationTurn` import from line 14:
```typescript
// Before:
import {
  extractSession,
  type SessionExtraction,
  type ConversationTurn,
  type EmotionMarker,
} from "../sessions/extract.js";

// After:
import {
  extractSession,
  type SessionExtraction,
  type EmotionMarker,
} from "../sessions/extract.js";
```

- [ ] **Step 2: Run all tests to verify nothing broke**

Run: `cd tools/siv && npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tools/siv/src/commands/analyze.ts
git commit -m "refactor(siv): remove dead full-scan analysis code"
```

---

### Task 3: Remove buildAnalyzePrompt from prompts and update tests

**Files:**
- Modify: `tools/siv/src/prompts/analyze.ts`
- Modify: `tools/siv/tests/commands/analyze.test.ts`

- [ ] **Step 1: Delete buildAnalyzePrompt from prompts/analyze.ts**

Remove the `buildAnalyzePrompt` function (lines 81-102) from `tools/siv/src/prompts/analyze.ts`. Keep `SHARED_QUALITY_GUIDANCE` (still used by `buildMarkerAnalyzePrompt`) and `buildMarkerAnalyzePrompt`.

- [ ] **Step 2: Remove tests for deleted function**

In `tools/siv/tests/commands/analyze.test.ts`:

1. Remove the import of `buildAnalyzePrompt` from line 3:
```typescript
// Before:
import {
  buildAnalyzePrompt,
  buildMarkerAnalyzePrompt,
} from "../../src/prompts/analyze.js";

// After:
import { buildMarkerAnalyzePrompt } from "../../src/prompts/analyze.js";
```

2. Delete the entire `describe("buildAnalyzePrompt", ...)` block (lines 62-103).

3. In the `describe("buildMarkerAnalyzePrompt", ...)` block, update the test `"shares quality guidance with full-scan prompt"` (lines 551-563). Replace it with a simpler test that just verifies the marker prompt has quality guidance:

```typescript
it("includes shared quality guidance", () => {
  const result = buildMarkerAnalyzePrompt([], "[]");

  expect(result.system).toContain("What NOT to report");
  expect(result.system).toContain("Quality bar");
  expect(result.system).toContain("Summary format");
});
```

4. In `describe("executeAnalyze")`, update the test `"logs insights from LLM analysis"` (line 110). This test currently uses `emotion_markers: []` which will now cause the session to be skipped. Add markers so it exercises the happy path:

```typescript
// In the mockExtractSession return value, change:
emotion_markers: [],
// To:
emotion_markers: [
  { type: "correction", context: "wrong approach", turn_index: 0 },
],
// Also add conversation turns so context windows work:
conversation: [
  { type: "human_message", text: "do it differently" },
  { type: "assistant_turn", message_id: "m1", text: "ok", tool_calls: [] },
],
```

5. Same fix for `"handles LLM errors gracefully"` test (line 234) — add markers and conversation.

6. Same fix for `"defaults invalid categories and priorities"` test (line 274) — add markers and conversation.

7. Same fix for `"handles empty insights array from LLM"` test (line 373) — add markers and conversation.

8. Same fix for `"filters by session ID when --session is given"` test (line 328) — add markers and conversation.

- [ ] **Step 3: Run all tests**

Run: `cd tools/siv && npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tools/siv/src/prompts/analyze.ts tools/siv/tests/commands/analyze.test.ts
git commit -m "refactor(siv): remove buildAnalyzePrompt and update tests for markers-only"
```

---

### Task 4: Verify and clean up

**Files:**
- Verify: `tools/siv/src/commands/analyze.ts`
- Verify: `tools/siv/src/prompts/analyze.ts`

- [ ] **Step 1: Check for any remaining references to deleted code**

Run: `grep -rn "buildAnalyzePrompt\|analyzeExtraction\|callAnalyze\|chunkConversation\|MAX_CHUNK_SIZE" tools/siv/src/ tools/siv/tests/`
Expected: No matches.

- [ ] **Step 2: Check the export of SHARED_QUALITY_GUIDANCE is still used**

Run: `grep -rn "SHARED_QUALITY_GUIDANCE" tools/siv/src/`
Expected: Defined in `prompts/analyze.ts`, used in `buildMarkerAnalyzePrompt` within the same file. The named export can stay or be removed — it's only used internally now.

- [ ] **Step 3: Build to verify no TypeScript errors**

Run: `cd tools/siv && npx tsc --noEmit`
Expected: Clean build, no errors.

- [ ] **Step 4: Run full test suite one final time**

Run: `cd tools/siv && npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit if any cleanup was needed**

```bash
git add -A tools/siv/
git commit -m "chore(siv): clean up unused exports after markers-only migration"
```
