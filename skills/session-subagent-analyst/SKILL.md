---
name: session-subagent-analyst
description: "Use when dispatched as a subagent to analyze a Claude Code session or subsession transcript for a performance review. Read the condensed JSON file at the path given in your prompt. Follow the checklist to produce a structured JSON report. Triggers: 'analyze subagent', 'analyze session transcript', 'session performance review subagent'."
---

# Session Subagent Analyst

Analyze one condensed session/subsession JSON file and produce a structured JSON report. Follow the checklist exactly.

## Input

Read the condensed JSON file path from your prompt. The file contains:
- `metadata` — session ID, slug, model, tokens, turn durations
- `conversation` — human messages, assistant turns, tool results
- `skills` — skill invocations with name, args, result
- `subagents` — nested subagent invocations (may be empty for subsessions)
- `tool_failures` — tool results with `is_error: true`
- `api_errors` — API errors with retry info
- `compactions` — context compaction events

## Determine Analysis Type

Check the file path or metadata to determine type:
- **Main session** (`main.json` or no `agentId` in records): Use the Main Session Checklist
- **Subsession** (`subagents/*.json` or `agentId` present): Use the Subsession Checklist

## Main Session Checklist

Check each item. Only report findings — skip items with nothing notable.

- [ ] **Skill timing**: Were skills invoked at the right time? Too early (before enough context)? Too late (after user already decided)? Missed entirely?
- [ ] **Skill arguments**: Were skill invocations given good arguments? Too verbose? Missing context?
- [ ] **User corrections**: Did the user correct the agent? How many times? What pattern?
- [ ] **Rejected interactions**: Were any AskUserQuestion or tool calls rejected by the user? What does this suggest?
- [ ] **Flow efficiency**: How many turns? Were subagents spawned unnecessarily (task could have been a direct tool call)? Token usage proportional to task complexity?
- [ ] **Gaps**: Were there situations where a skill or agent specialization was clearly missing?

## Subsession Checklist

Check each item. Only report findings — skip items with nothing notable.

- [ ] **Task completion**: Did the subagent accomplish what it was asked to do? Check the first human message (the task) against the final output.
- [ ] **Doom loop**: Are there 3+ consecutive identical or near-identical tool calls with the same error? Flag with the tool name and error.
- [ ] **Redundant operations**: Same file read multiple times? Overlapping search queries? Sequential operations that could be parallel?
- [ ] **Tool failures**: List each `is_error: true` result. Did the subagent recover or get stuck?
- [ ] **Skill compliance**: If a skill was invoked, did the subagent follow its documented steps? "deviated" = skipped steps or ignored instructions.
- [ ] **Token efficiency**: Compare output tokens to task complexity. Flag if output seems 5x+ more than the task warrants (e.g., simple lookup generating 10k tokens).

## Output Format

Output ONLY this JSON (no other text):

```json
{
  "analysis_type": "main_session|subsession",
  "file_analyzed": "<path to the file you read>",
  "skill_suggestions": [
    {
      "skill_name": "<name>",
      "caller_suggestion": "<how the caller could use it better, or null>",
      "skill_suggestion": "<how the skill itself could improve, or null>"
    }
  ],
  "anti_patterns": [
    {
      "pattern": "<short name>",
      "description": "<what happened>",
      "impact": "<time/tokens/failures cost>"
    }
  ],
  "user_preferences": [
    {
      "preference": "<detected pattern>",
      "scope": "global|project",
      "evidence": "<what you observed>"
    }
  ],
  "gaps": [
    {
      "description": "<situation where a skill or specialization was missing>",
      "proposed_skill": "<suggested name and brief description>"
    }
  ]
}
```

**Field rules:**
- Omit empty arrays (if no anti_patterns found, don't include the key)
- `skill_suggestions`: only include if there are actual non-trivial suggestions. "Skill worked fine" is not a suggestion.
- `anti_patterns`: concrete patterns only. "Agent used Read" is not an anti-pattern. "Agent read the same 500-line file 4 times in one turn" is.
- `user_preferences`: only include if evidence appears 2+ times in the session. One correction is not a preference.
- `gaps`: only include if there was a clear situation where a skill would have helped and none exists.

## Example

Input: A subsession where a subagent was asked to "Research Claude Code session format" and made 3 sequential WebSearch calls followed by 3 sequential WebFetch calls.

Output:
```json
{
  "analysis_type": "subsession",
  "file_analyzed": "/tmp/session-analyst/sess-001/subagents/agent-abc123.json",
  "anti_patterns": [
    {
      "pattern": "Sequential web research",
      "description": "3 WebSearch calls followed by 3 WebFetch calls executed sequentially. All searches were independent and could have been dispatched in parallel.",
      "impact": "Added ~45s wall-clock time. Parallel execution would reduce to ~15s."
    }
  ]
}
```

Note: no `skill_suggestions`, `user_preferences`, or `gaps` keys because none were found.
