/**
 * Build the analysis prompt for LLM-based session analysis.
 *
 * The system prompt instructs the LLM to analyze flagged moments from a session
 * and return structured insights as JSON.
 */

/** Shared quality guidance used by marker-aware prompts. */
const SHARED_QUALITY_GUIDANCE = `## What NOT to report

NEVER report these — even if they involved struggle or multiple attempts:
- Tool constraints (e.g., "Edit requires a prior Read") — enforced by the tool itself
- Anything that worked on the first try
- Things already fixed in code — bugs fixed, features built, configs changed. The code is the memory. A future session won't hit the same bug because the code is already correct.

Also skip:
- Multiple insights about the same issue — merge into ONE
- Issues resolved quickly without user frustration
- One-time fixes (e.g., "set config value to X", "use version Y")

## Output format

{
  "insights": [
    {
      "category": "correction | error | knowledge_gap | best_practice",
      "summary": "<a 'when X, do Y' or 'when X, don't Y' rule — this IS the insight>",
      "details": "<what was tried, what failed, what finally worked — max 2 sentences>",
      "priority": "low | medium | high | critical",
      "scope": "global | project",
      "tags": ["<relevant>", "<tags>"]
    }
  ]
}

## Summary format — CRITICAL

The summary MUST be a reusable rule in one of these forms:
- "When [situation], do [action]"
- "When [situation], don't [action]"
- "When [situation], [action] instead of [wrong action]"

The summary must be understandable WITHOUT reading the details. Include enough context that someone reading just the summary knows WHAT situation and WHAT action.

Good examples:
- "When connecting to a proxy API, ask the user for the exact base URL instead of guessing URL patterns"
- "When preparing data for LLM analysis, include both success and failure counts — not just failures — so the LLM can calculate accurate rates"
- "When a curl request fails with SSL error, don't retry the same URL — check if the host resolves"

Bad examples (DO NOT write these):
- "User had to provide correct API endpoint" (descriptive, not a rule)
- "Agent switched SDKs twice" (narrative, not actionable)
- "SSL errors occurred" (observation, not guidance)
- "When condensing session data for subagent analysis, preserve successful results and add a tool_usage_summary" (too jargon-heavy, not self-contained)
- "When editing a file, always read it first" (tool constraint — enforced by the tool)
- "When applying result caps, apply after filtering" (bug fix — already in the code now)
- "When grouping insights, preserve existing group assignments" (feature built this session — already implemented)
- "When distilling rules, use the narrowest scope" (design decision — already in the prompt now)

## Priority

- **critical**: Data loss, security issue, or >5 wasted iterations
- **high**: User had to intervene to unblock
- **medium**: Suboptimal path that wasted a few steps
- **low**: Minor inefficiency

## Quality bar

- Fewer, better insights. 1-3 high-quality rules beats 6 mediocre ones.
- Every summary MUST be a "when X, do/don't Y" rule. If you can't write one, skip the insight.
- Rules should apply in future sessions — either across any project (general technique) or within the same project (project convention/principle).

If there are no insights worth reporting, return: { "insights": [] }`;

export function buildMarkerAnalyzePrompt(
  markers: Array<{ type: string; context: string; turn_index: number }>,
  contextWindows: string
): { system: string; user: string } {
  const system = `You are a session analyst for an AI agent self-improvement system. You extract rules from emotionally significant moments in coding sessions.

The agent flagged specific moments during this session. Analyze ONLY the flagged moments and their surrounding context to extract reusable rules.

## Marker types and what to look for

- **frustration**: Agent was stuck or retrying -> look for process/tool gaps
- **correction**: User corrected the agent -> look for knowledge/process gaps
- **breakthrough**: Agent figured something out after struggle -> capture the insight
- **surprise**: Data or behavior was unexpected -> potential new knowledge

${SHARED_QUALITY_GUIDANCE}`;

  const user = `Analyze these flagged moments and their surrounding context:\n\n## Markers\n${JSON.stringify(markers, null, 2)}\n\n## Context Windows\n${contextWindows}`;

  return { system, user };
}
