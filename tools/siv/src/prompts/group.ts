/**
 * Build the grouping prompt for LLM-based semantic similarity grouping.
 *
 * The LLM groups insights by same actionable advice — insights that
 * give the same concrete recommendation end up together, regardless
 * of project or category.
 */

export interface GroupOutput {
  groups: Record<string, string[]>;
}

export function buildGroupPrompt(insights: Array<{
  id: string;
  category: string;
  summary: string;
  details: string;
  project: string;
  current_group?: string;
}>): {
  system: string;
  user: string;
} {
  const system = `You are an insight deduplication engine. Group insights that give the SAME actionable advice.

## Grouping criteria

Two insights belong in the same group ONLY if:
- They recommend the same concrete action (e.g., both say "Read before Write")
- They could be merged into one rule without losing distinct advice

Two insights do NOT belong together if:
- They share a topic/domain but give different advice
- Merging them would produce a vague umbrella rule

## Pre-assigned groups

Some insights have a \`current_group\` field — these MUST keep that exact group key. Only assign group keys to insights without \`current_group\`. Use existing group keys as anchors: if a new insight matches an existing group, assign it to that same key.

## Key label format

Each group key: 2-5 words, snake_case, describing the specific advice (not the domain).
An insight belongs to exactly one group.
Insights with no similar peers get their own group.

<example>
Input insights:
- A: "Always Read files before Write/Edit to verify target location"
- B: "Don't attempt Edit without a prior Read, even if you think you know the content"
- C: "Check file existence with 'test -f' before Read for uncertain paths"
- D: "When building CLI tools, have agents return structured JSON instead of calling CLI commands"
- E: "When editing files via LLM, use structured edit instructions instead of returning full file content"

Correct grouping:
{
  "groups": {
    "read_before_write": ["A", "B"],
    "check_existence_before_read": ["C"],
    "structured_json_over_tool_calls": ["D"],
    "structured_edits_over_full_file": ["E"]
  }
}

WRONG grouping (over-grouped by domain):
{
  "groups": {
    "verify_file_state": ["A", "B", "C"],
    "agent_architecture": ["D", "E"]
  }
}

Why wrong:
- C gives different advice than A/B (existence check != read-before-write)
- D and E are different recommendations despite both being about agent architecture
</example>

## Return format

Return ONLY valid JSON:
{
  "groups": {
    "group_key": ["ID-1", "ID-2"],
    ...
  }
}

Every insight ID from the input must appear exactly once in the output.`;

  const user = `Group these insights by same actionable advice:\n\n${JSON.stringify(insights, null, 2)}`;

  return { system, user };
}
