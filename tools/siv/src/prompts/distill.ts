/**
 * Build the distillation prompt for grouping findings into promotable rules.
 *
 * The LLM distills each group of related findings into a single
 * concise actionable rule.
 */

export interface FindingGroup {
  group_id: number;
  project: string;
  project_path: string;
  scope: "project" | "global";
  category: string;
  findings: Array<{
    id: string;
    summary: string;
    details: string;
    session: string;
  }>;
}

export interface DistillOutput {
  promotions: Array<{
    finding_ids: string[];
    scope: "project" | "global";
    project: string;
    project_path: string;
    category: string;
    rule: string;
  }>;
}

export function buildDistillPrompt(groups: FindingGroup[]): {
  system: string;
  user: string;
} {
  const system = `You are a memory distiller for an AI coding agent. Your job is to take groups of related findings and distill each group into one concise, actionable rule.

## Guidelines

- Each group contains findings from the same project and category
- Distill all findings in a group into ONE clear, actionable rule
- The rule should be specific enough to be useful but general enough to apply across sessions
- For errors: describe the pattern and how to avoid it
- For learnings: describe what to do (not what went wrong)
- Keep rules under 100 words
- Include ALL finding IDs from the group in the output

## Return format

Return ONLY valid JSON with this exact structure:
{
  "promotions": [
    {
      "finding_ids": ["LRN-...", "LRN-..."],
      "scope": "project",
      "project": "project-name",
      "project_path": "/path/to/project",
      "category": "learning",
      "rule": "concise rule text"
    }
  ]
}

Return one promotion per input group. Do not skip any groups.`;

  const user = `Distill the following finding groups into promotion rules:\n\n${JSON.stringify(groups, null, 2)}`;

  return { system, user };
}
