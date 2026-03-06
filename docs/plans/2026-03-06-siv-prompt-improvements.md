# SIV Prompt Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve `promote.ts` and `analyze.ts` prompts based on prompt engineering best practices audit to prevent over-generalized rules and missed exclusions.

**Architecture:** Two targeted prompt edits — add few-shot examples to `promote.ts` (the only prompt without them) and restructure the exclusion list in `analyze.ts` from a soft suggestion into a stronger enforcement pattern. No structural changes to the pipeline code.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Add few-shot examples to `promote.ts`

**Files:**
- Modify: `tools/siv/src/prompts/promote.ts:35-52` (system prompt string)

**Step 1: Write the failing test**

Add a test to `tools/siv/tests/commands/promote-finding.test.ts` that verifies the promote prompt contains example content:

```typescript
import { buildPromotePrompt } from "../../src/prompts/promote.js";

describe("buildPromotePrompt", () => {
  it("includes correct and incorrect examples in system prompt", () => {
    const { system } = buildPromotePrompt({
      rule: "test rule",
      category: "learning",
      scope: "project",
      existingPromotions: [],
      findingIds: ["LRN-001"],
    });

    expect(system).toContain("<example>");
    expect(system).toContain("<correct-output>");
    expect(system).toContain("<incorrect-output");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd tools/siv && npx vitest run tests/commands/promote-finding.test.ts`
Expected: FAIL — current prompt has no `<example>` tags

**Step 3: Update the promote prompt**

Replace the system prompt in `tools/siv/src/prompts/promote.ts` (lines 35–52). The new prompt should:

1. Keep the existing role line and decision logic (lines 35–42) as-is
2. Add a merge constraint after the decision logic:
   ```
   ## Constraints

   - When merging rules, preserve the NARROWEST correct scope from the inputs. Do not broaden a rule beyond what the source findings support.
   - The merged "entry" must be a standalone rule — not a summary of what changed.
   ```
3. Add an XML-tagged example block with all four actions demonstrated, focusing on the merge case since that's the error-prone one. Use `<example>` with `<input>`, `<correct-output>`, and `<incorrect-output>` tags matching the pattern in `distill.ts` and `group.ts`:
   ```
   <example>
   <input>
   New rule: "Read existing files before Edit to verify file state"
   Category: error
   Scope: project

   Existing promotions:
   - [PRM-001] (learning) When modifying a file, verify its current content first to avoid blind overwrites
   </input>

   <correct-output>
   {
     "action": "merge",
     "entry": "Read existing files before Edit or Write to verify current content and avoid blind overwrites. For new files, Write directly.",
     "reason": "Both rules recommend verifying file state before modification — merged into one rule preserving narrow scope",
     "supersedes_ids": ["PRM-001"]
   }
   </correct-output>

   <incorrect-output reason="Over-generalized — broadened to 'all file operations' and 'even for new files' which neither source rule supports">
   {
     "action": "merge",
     "entry": "Always read any file before performing any file operation, even for new files or when you believe you know the content.",
     "reason": "Merged overlapping rules about file operations",
     "supersedes_ids": ["PRM-001"]
   }
   </incorrect-output>
   </example>
   ```
4. Keep the existing return format section (lines 44–52) after the example

**Step 4: Run test to verify it passes**

Run: `cd tools/siv && npx vitest run tests/commands/promote-finding.test.ts`
Expected: PASS — all 5 tests pass (4 existing + 1 new)

**Step 5: Run full test suite**

Run: `cd tools/siv && npm test`
Expected: All 188+ tests pass

**Step 6: Commit**

```bash
cd /Users/meixueting/work/wolfhead_skills
git add tools/siv/src/prompts/promote.ts tools/siv/tests/commands/promote-finding.test.ts
git commit -m "feat(siv): add few-shot examples and merge constraints to promote prompt

The promote prompt was the only siv prompt without examples, making it
prone to over-generalizing when merging rules. Add correct/incorrect
XML-tagged examples following the pattern used in distill.ts and
group.ts."
```

---

### Task 2: Strengthen exclusion enforcement in `analyze.ts`

**Files:**
- Modify: `tools/siv/src/prompts/analyze.ts:24-31` ("What NOT to report" section)
- Modify: `tools/siv/tests/commands/analyze.test.ts` (add test)

**Step 1: Write the failing test**

Add a test to `tools/siv/tests/commands/analyze.test.ts` that verifies the exclusion list uses strong enforcement language:

```typescript
it("uses strong enforcement for high-frequency exclusions", () => {
  const result = buildAnalyzePrompt("{}");

  // The "What NOT to report" section should use NEVER/FORBIDDEN for
  // items that the LLM has historically ignored as soft suggestions
  expect(result.system).toContain("NEVER report");
});
```

**Step 2: Run test to verify it fails**

Run: `cd tools/siv && npx vitest run tests/commands/analyze.test.ts`
Expected: FAIL — current prompt uses soft "What NOT to report" list without "NEVER"

**Step 3: Restructure the exclusion section**

In `tools/siv/src/prompts/analyze.ts`, split the "What NOT to report" section into two tiers. Move the items that the LLM has historically ignored (high-frequency patterns) into a stronger enforcement block at the top of the section:

```
## What NOT to report

NEVER report these — they are known tool constraints or universally obvious practices, not learnings:
- Tool constraints (e.g., "Edit requires a prior Read", "always read before editing") — these are enforced by the tool itself
- Anything that worked on the first try
- Findings about the analysis/review process itself rather than the actual coding work

Also skip:
- Multiple findings about the same issue — merge into ONE
- Issues resolved quickly without user frustration
- One-time fixes that won't recur (e.g., "set config value to X", "use version Y", "use this path shortcut")
```

This keeps the existing bad example we added ("When editing a file, always read it first") as the format-zone reinforcement, while adding a category-level exclusion ("Tool constraints") at the top of the section that catches the general pattern — not just the specific example.

**Step 4: Run test to verify it passes**

Run: `cd tools/siv && npx vitest run tests/commands/analyze.test.ts`
Expected: PASS — all tests pass

**Step 5: Run full test suite**

Run: `cd tools/siv && npm test`
Expected: All 188+ tests pass

**Step 6: Commit**

```bash
cd /Users/meixueting/work/wolfhead_skills
git add tools/siv/src/prompts/analyze.ts tools/siv/tests/commands/analyze.test.ts
git commit -m "fix(siv): strengthen exclusion enforcement in analyze prompt

The LLM was ignoring soft exclusions for high-frequency patterns like
'read before edit'. Split the exclusion list into two tiers: NEVER
(tool constraints, obvious practices) and soft skip (dedup, one-time
fixes). This matches the constraint enforcement patterns from the
prompt engineering guide."
```

---

### Task 3: Verify end-to-end

**Step 1: Run full test suite one final time**

Run: `cd tools/siv && npm test`
Expected: All tests pass

**Step 2: Review prompt token counts**

Run: `cd tools/siv && node -e "const {buildPromotePrompt} = require('./dist/prompts/promote.js'); const p = buildPromotePrompt({rule:'x',category:'y',scope:'project',existingPromotions:[],findingIds:['a']}); console.log('promote system:', p.system.split(' ').length, 'words')"`

Verify the promote prompt stays under 300 words of instructions (the example JSON doesn't count as "instructions" per the guide, but the total system prompt should stay reasonable). The analyze prompt is already borderline at ~350 words — verify it didn't grow significantly.

If either prompt exceeds ~400 words, trim redundant phrasing before committing.
