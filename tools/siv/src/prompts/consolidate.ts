/**
 * Build the consolidation prompt for LLM-based dedup/merge decisions.
 *
 * The LLM decides whether to create a new rule, merge with an
 * existing one, supersede an existing one, or skip as duplicate.
 */

export interface ExistingRule {
  id: string;
  rule: string;
  category: string;
  insight_ids: string[];
  ts: string;
}

export interface ConsolidateWriterInput {
  rule: string;
  category: string;
  scope: "project" | "global";
  existingRules: ExistingRule[];
  insightIds: string[];
}

export interface ConsolidateWriterOutput {
  action: "create" | "merge" | "supersede" | "skip";
  entry: string; // the rule text for the new/merged rule
  reason: string;
  supersedes_ids?: string[]; // rule IDs to mark as superseded (for merge/supersede)
}

export function buildConsolidatePrompt(input: ConsolidateWriterInput): {
  system: string;
  user: string;
} {
  const system = `You are a deduplication engine for consolidated rules. Your job is to decide how a new rule relates to existing consolidated rules.

## Decision logic

1. If the rule is semantically equivalent to an existing rule -> action: "skip"
2. If the rule overlaps with one or more existing rules (same topic, complementary info) -> action: "merge" (combine into one rule, return supersedes_ids of the old rules)
3. If the rule conflicts with an existing rule -> action: "supersede" (replace old, return supersedes_ids)
4. If the rule is genuinely new -> action: "create"

## Constraints

- When merging rules, preserve the NARROWEST correct scope from the inputs. Do not broaden a rule beyond what the source insights support.
- The merged "entry" must be a standalone rule — not a summary of what changed.

<example>
<input>
New rule: "Read existing files before Edit to verify file state"
Category: error
Scope: project

Existing rules:
- [RUL-001] (learning) When modifying a file, verify its current content first to avoid blind overwrites
</input>

<correct-output>
{
  "action": "merge",
  "entry": "Read existing files before Edit or Write to verify current content and avoid blind overwrites. For new files, Write directly.",
  "reason": "Both rules recommend verifying file state before modification — merged preserving narrow scope",
  "supersedes_ids": ["RUL-001"]
}
</correct-output>

<incorrect-output reason="Over-generalized — broadened to 'all file operations' and 'even for new files' which neither source rule supports">
{
  "action": "merge",
  "entry": "Always read any file before performing any file operation, even for new files or when you believe you know the content.",
  "reason": "Merged overlapping rules about file operations",
  "supersedes_ids": ["RUL-001"]
}
</incorrect-output>
</example>

## Output format

Return ONLY valid JSON with this exact structure:
{
  "action": "create" | "merge" | "supersede" | "skip",
  "entry": "the rule text (omit for skip)",
  "reason": "brief explanation of why this action was chosen",
  "supersedes_ids": ["RUL-xxx", "RUL-yyy"]  // only for merge/supersede — IDs of old rules to replace
}`;

  const existingText =
    input.existingRules.length === 0
      ? "(none)"
      : input.existingRules
          .map(
            (p) =>
              `- [${p.id}] (${p.category}) ${p.rule}`
          )
          .join("\n");

  const user = `## Rule to consolidate

Category: ${input.category}
Scope: ${input.scope}
Rule: ${input.rule}
Insight IDs: ${input.insightIds.join(", ")}

## Existing active rules (same project/scope)

${existingText}`;

  return { system, user };
}
