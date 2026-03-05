/**
 * Build the promotion prompt for LLM-based memory writing.
 *
 * The LLM decides how to integrate a distilled rule into the
 * appropriate MEMORY.md or CLAUDE.md file.
 */

export interface PromoteWriterInput {
  rule: string;
  category: string; // learning | error | preference
  scope: "project" | "global";
  currentMemoryMd: string;
  currentClaudeMd: string;
  findingIds: string[];
}

export interface PromoteWriterOutput {
  action: "create" | "merge" | "supersede" | "skip";
  section: string; // e.g. "## Session Learnings"
  target_line?: string; // existing line to replace (for merge/supersede)
  entry: string; // the formatted entry line
  reason: string;
}

export function buildPromotePrompt(input: PromoteWriterInput): {
  system: string;
  user: string;
} {
  const today = new Date().toISOString().slice(0, 10);

  const system = `You are a memory manager for an AI coding agent. Your job is to decide how to integrate a new rule into the agent's MEMORY.md file.

## Decision logic

1. If the rule (or a semantically equivalent rule) already exists in CLAUDE.md → action: "skip"
2. If a similar rule exists in MEMORY.md → action: "merge" (update confirmed date, append session IDs)
3. If a conflicting rule exists in MEMORY.md → action: "supersede" (replace with new rule)
4. If the rule is new → action: "create"

## Entry formats

For learnings and preferences:
- <rule text> *(added: YYYY-MM-DD, confirmed: YYYY-MM-DD, sessions: id1, id2)*

For errors:
- **<error pattern>**: <how to avoid> *(added: YYYY-MM-DD, confirmed: YYYY-MM-DD, sessions: id1, id2)*

## Section mapping

- learning → "## Session Learnings"
- error → "## Session Errors"
- preference → "## Preferences"

## Merge rules

When merging, preserve the original "added" date but update "confirmed" to today (${today}).
Append any new session IDs to the existing sessions list (comma-separated).

## Output format

Return ONLY valid JSON with this exact structure:
{
  "action": "create" | "merge" | "supersede" | "skip",
  "section": "## Section Name",
  "target_line": "the exact existing line to replace (only for merge/supersede, omit for create/skip)",
  "entry": "the formatted entry line (omit for skip)",
  "reason": "brief explanation of why this action was chosen"
}`;

  const user = `## Rule to promote

Category: ${input.category}
Scope: ${input.scope}
Rule: ${input.rule}
Finding IDs: ${input.findingIds.join(", ")}
Today: ${today}

## Current MEMORY.md contents

${input.currentMemoryMd || "(empty)"}

## Current CLAUDE.md contents

${input.currentClaudeMd || "(empty)"}`;

  return { system, user };
}
