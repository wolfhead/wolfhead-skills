/**
 * Build the promotion prompt for LLM-based dedup/merge decisions.
 *
 * The LLM decides whether to create a new promotion, merge with an
 * existing one, supersede an existing one, or skip as duplicate.
 */

export interface ExistingPromotion {
  id: string;
  rule: string;
  category: string;
  finding_ids: string[];
  ts: string;
}

export interface PromoteWriterInput {
  rule: string;
  category: string;
  scope: "project" | "global";
  existingPromotions: ExistingPromotion[];
  findingIds: string[];
}

export interface PromoteWriterOutput {
  action: "create" | "merge" | "supersede" | "skip";
  entry: string; // the rule text for the new/merged promotion
  reason: string;
  supersedes_ids?: string[]; // promotion IDs to mark as superseded (for merge/supersede)
}

export function buildPromotePrompt(input: PromoteWriterInput): {
  system: string;
  user: string;
} {
  const system = `You are a deduplication engine for promoted rules. Your job is to decide how a new rule relates to existing promoted rules.

## Decision logic

1. If the rule is semantically equivalent to an existing promotion → action: "skip"
2. If the rule overlaps with one or more existing promotions (same topic, complementary info) → action: "merge" (combine into one rule, return supersedes_ids of the old promotions)
3. If the rule conflicts with an existing promotion → action: "supersede" (replace old, return supersedes_ids)
4. If the rule is genuinely new → action: "create"

## Constraints

- When merging rules, preserve the NARROWEST correct scope from the inputs. Do not broaden a rule beyond what the source findings support.
- The merged "entry" must be a standalone rule — not a summary of what changed.

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
  "reason": "Both rules recommend verifying file state before modification — merged preserving narrow scope",
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

## Output format

Return ONLY valid JSON with this exact structure:
{
  "action": "create" | "merge" | "supersede" | "skip",
  "entry": "the rule text (omit for skip)",
  "reason": "brief explanation of why this action was chosen",
  "supersedes_ids": ["PRM-xxx", "PRM-yyy"]  // only for merge/supersede — IDs of old promotions to replace
}`;

  const existingText =
    input.existingPromotions.length === 0
      ? "(none)"
      : input.existingPromotions
          .map(
            (p) =>
              `- [${p.id}] (${p.category}) ${p.rule}`
          )
          .join("\n");

  const user = `## Rule to promote

Category: ${input.category}
Scope: ${input.scope}
Rule: ${input.rule}
Finding IDs: ${input.findingIds.join(", ")}

## Existing active promotions (same project/scope)

${existingText}`;

  return { system, user };
}
