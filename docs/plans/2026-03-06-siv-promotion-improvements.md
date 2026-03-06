# SIV Promotion Improvements Plan

## Context

Model comparison testing (GLM-5 vs Qwen vs Opus vs Sonnet) on the same 14 sessions revealed:
- Cheap models (Qwen) extract more findings but promote too loosely (noise like "statusline formatting")
- Expensive models (Opus) are excellent judges but cost ~$1/run
- All models had JSON parsing failures from markdown fences, reasoning preambles, or trailing text
- `response_format: json_object` is not reliably supported across providers

## Changes

### 1. Split models by stage

Add separate config for the promotion model so we can use cheap model for extraction, strong model for judgment.

**Files to modify:**
- `src/config.ts` — add `promoteModel`, `promoteApiKey`, `promoteApiBase` fields
- `src/llm.ts` — accept model/api override params
- `src/commands/run-promotion.ts` — pass promote config to distill + promote calls
- `src/commands/group.ts` — pass promote config to group call

**Config (.env):**
```
SIV_API_KEY=sk_xxx
SIV_API_BASE=https://api.ppio.com/openai
SIV_MODEL=qwen/qwen3.5-plus

# Optional: separate model for promotion (group + distill + promote steps)
# Falls back to SIV_MODEL if not set
SIV_PROMOTE_API_KEY=sk_yyy
SIV_PROMOTE_API_BASE=https://api.jiekou.ai/openai
SIV_PROMOTE_MODEL=claude-opus-4-6
```

**Implementation:**
- `SivConfig` gets optional `promoteApiKey`, `promoteApiBase`, `promoteModel`
- `callLLM` gets an optional `configOverride` param for model/api fields
- `run-promotion.ts` and `group.ts` use promote config when available
- `analyze` command continues using the default model (cheap)

### 2. Tighten promotion prompt criteria

The distill prompt currently says "Distill each group into exactly ONE rule. Do not skip groups." This forces the model to promote everything — even noise. The model should be allowed to reject low-quality groups.

**Files to modify:**
- `src/prompts/distill.ts` — add rejection criteria and quality gate

**Changes to distill prompt:**

Add a `<HARD-GATE>` section with explicit rejection criteria:

```
## Quality gate

You MUST reject a group (omit from output) if ANY of these apply:
- One-time config fix (e.g., "set statusline separator to |")
- Code-level fix, not an agent behavior rule (e.g., "strip markdown fences before JSON.parse")
- Too vague to act on (e.g., "be more careful with APIs")
- Project-specific trivia that won't recur (e.g., "this repo uses tabs not spaces")

You MUST promote a group if ALL of these apply:
- Actionable: states "when X, do Y" with concrete trigger and action
- Transferable: would help in future sessions on similar tasks
- Evidenced: supported by 2+ independent findings from different sessions
```

Add incorrect example showing a noise group being promoted:

```xml
<incorrect-output reason="Statusline formatting is a one-time config fix, not a reusable agent rule">
{
  "promotions": [{
    "finding_ids": ["LRN-042"],
    "scope": "project",
    "category": "correction",
    "rule": "Show only directory basename in statusline, separate fields with | delimiter"
  }]
}
</incorrect-output>
```

Also update the output format to support empty promotions:
```
If no groups pass the quality gate, return: {"promotions": []}
```

### 3. Robust JSON extraction

Replace the brittle regex fence stripper with `jsonrepair` library.

**Files to modify:**
- `package.json` — add `jsonrepair` dependency
- `src/llm.ts` — replace fence stripping with robust extraction

**Implementation:**

```typescript
import { jsonrepair } from "jsonrepair";

// In callLLM, replace the fence-strip + JSON.parse block:
const trimmed = content.trim();

// Try direct parse first (fast path)
let parsed: T;
try {
  parsed = JSON.parse(trimmed) as T;
} catch {
  // Extract from markdown fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    parsed = JSON.parse(jsonrepair(candidate)) as T;
  } catch {
    throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
  }
}
```

Strategy: fast path for clean JSON, `jsonrepair` fallback for malformed responses. No `response_format` dependency — works with any provider.

**Remove:** `response_format: { type: "json_object" }` from the request — it's unreliable across providers and not needed with robust parsing.

**Tests to update:**
- `tests/llm.test.ts` — existing fence-strip tests should still pass
- The 3 reasoning-model failure tests should now pass
- Add test for `jsonrepair` handling (trailing commas, unquoted keys)

## Verification

1. `npm test` — all existing + new tests pass
2. Run `siv analyze --latest 5` with Qwen — should work as before
3. Run `siv run_promotion` with Opus via promote config — should produce high-quality rules
4. Run `siv run_promotion` with Qwen only — should produce fewer noise rules than before (distill prompt rejects noise)
5. Verify the 3 failure-mode test cases from `tests/llm.test.ts` now pass
