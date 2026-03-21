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
