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
  const system = `You are a memory distiller for an AI coding agent. Your job is to evaluate groups of related findings and distill worthy groups into concise, actionable rules.

## Quality gate — apply BEFORE distilling each group

REJECT a group (omit from output) if ANY of these apply:
- One-time config fix (e.g., "set statusline separator to |", "change port to 8080")
- Code-level fix, not an agent behavior rule (e.g., "strip markdown fences before JSON.parse", "add null check")
- Too vague to act on (e.g., "be more careful with APIs", "test thoroughly")
- Project-specific trivia that won't recur (e.g., "this repo uses tabs not spaces")

PROMOTE a group if ALL of these apply:
- Actionable: states "when X, do Y" with concrete trigger and action
- Transferable: would help the agent in future sessions on similar tasks
- Not a code fix: describes agent workflow/behavior, not a specific code change

## Constraints

- Keep rules under 100 words.
- Include ALL finding IDs from each group in the output.
- When merging findings, use the NARROWEST correct scope. Do not add qualifiers like "even for X" unless ALL findings in the group support it.
- For errors: state what to do instead (not just what went wrong).
- For learnings: state what to do (not what was learned).

<example>
<input>
{
  "group_id": 1,
  "project": "my-project",
  "project_path": "/path/to/my-project",
  "scope": "project",
  "category": "error",
  "findings": [
    {"id": "ERR-001", "summary": "When editing a file, always read it first — Edit tool errors without a prior Read", "details": "Agent tried Edit without Read, got tool constraint error, had to retry.", "session": "abc"},
    {"id": "LRN-001", "summary": "Read files before Write to verify the target path exists and content is as expected", "details": "Agent wrote to wrong path because it didn't check first.", "session": "def"}
  ]
}
</input>

<correct-output>
{
  "promotions": [{
    "finding_ids": ["ERR-001", "LRN-001"],
    "scope": "project",
    "project": "my-project",
    "project_path": "/path/to/my-project",
    "category": "error",
    "rule": "Read existing files before Edit or Write to verify file state and target path. For new files where the path is known, Write directly without a prior Read."
  }]
}
</correct-output>

<incorrect-output reason="Over-generalized — added 'even for new files' which only ERR-001 implies and LRN-001 contradicts">
{
  "promotions": [{
    "finding_ids": ["ERR-001", "LRN-001"],
    "scope": "project",
    "project": "my-project",
    "project_path": "/path/to/my-project",
    "category": "error",
    "rule": "Always read a file before attempting to write or edit it, even for new files or when you believe you know the content."
  }]
}
</incorrect-output>

<incorrect-output reason="One-time config fix, not a reusable agent behavior rule — REJECT this group">
{
  "promotions": [{
    "finding_ids": ["LRN-042"],
    "scope": "project",
    "project": "my-project",
    "project_path": "/path/to/my-project",
    "category": "correction",
    "rule": "Show only directory basename in statusline, separate fields with | delimiter"
  }]
}
</incorrect-output>

<incorrect-output reason="Code-level fix, not agent behavior — REJECT this group">
{
  "promotions": [{
    "finding_ids": ["ERR-055"],
    "scope": "project",
    "project": "my-project",
    "project_path": "/path/to/my-project",
    "category": "error",
    "rule": "Strip markdown code fences before calling JSON.parse on LLM responses"
  }]
}
</incorrect-output>
</example>

## Return format

Return ONLY valid JSON. If no groups pass the quality gate, return {"promotions": []}.
{
  "promotions": [
    {
      "finding_ids": ["LRN-...", "ERR-..."],
      "scope": "project",
      "project": "project-name",
      "project_path": "/path/to/project",
      "category": "learning",
      "rule": "concise rule text"
    }
  ]
}`;

  const user = `Distill the following finding groups into promotion rules:\n\n${JSON.stringify(groups, null, 2)}`;

  return { system, user };
}
