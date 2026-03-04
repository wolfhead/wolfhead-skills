# Analyst Context Improvement — Design

**Date**: 2026-03-04

## Problem

The session-subagent-analyst over-generalizes user corrections into durable preferences. Example: user said "i only need you list the test case" during a specific task → analyst reported "Direct output over deep analysis" as a general preference. This is a situational correction, not a durable preference.

## Root Cause

The subagent reports preferences without sufficient context about the situation. Downstream consumers (claude-session-analyst, claude-self-improver) can't distinguish situational corrections from durable preferences because they lack the "why."

## Changes

### 1. session-subagent-analyst: report freely with context

**Remove:** The 2+ occurrence threshold for `user_preferences` (line 94: "only include if evidence appears 2+ times in the session").

**Add `context` field** to `user_preferences` and `anti_patterns`:

```json
"user_preferences": [
  {
    "preference": "<detected pattern>",
    "scope": "global|project",
    "evidence": "<what you observed>",
    "context": "<the situation: what was the task, what did the agent do, why did the user react>"
  }
]
```

```json
"anti_patterns": [
  {
    "pattern": "<short name>",
    "description": "<what happened>",
    "impact": "<time/tokens/failures cost>",
    "context": "<the situation: what was the agent trying to do, what went wrong>"
  }
]
```

**Add reporting criteria** — guide the subagent on what's worth reporting:

Report a user preference when:
- User explicitly states a rule or preference ("always use X", "I prefer Y")
- User corrects the agent's tool or workflow choice
- User interrupts or rejects an approach and redirects
- User repeats the same type of correction across different tasks
- User expresses frustration, criticism, or disappointment about agent behavior

Report an anti-pattern when:
- Agent used the wrong tool for the job
- Agent spent 3+ attempts or significant time on a failing approach
- Agent kept dead/unused code or artifacts
- Agent spawned a subagent for something a single tool call could handle
- Agent repeated the same failing operation without changing approach

Do NOT report:
- Normal tool usage
- Successful operations
- Style inferences from how the user writes

**Add correct/incorrect examples:**

CORRECT:
```json
{
  "preference": "Uses GitLab, not GitHub",
  "scope": "project",
  "evidence": "Agent ran `gh pr create`, user said 'this is GitLab'",
  "context": "Agent assumed GitHub when creating a merge request. User corrected to use GitLab CLI."
}
```

INCORRECT (no context):
```json
{
  "preference": "Prefers direct output over deep analysis",
  "scope": "global",
  "evidence": "User interrupted twice"
}
```

### 2. claude-session-analyst: judge based on context

Update the synthesis merge rule for User Preferences from:

> "Only promote to the report if observed in 2+ sessions (single-session observations are noise)."

To:

> "Include all preferences from subagent reports. Preserve the context field. When synthesizing, distinguish between situational corrections (user redirected agent on a specific task) and durable preferences (user stated a general rule or corrected the same type of behavior across different tasks). Label each as Situational or Durable in the report."

Update the report template's User Preferences table to include a Type column:

```markdown
| Preference | Type | Scope | Frequency | Context | Suggested Entry |
|-----------|------|-------|-----------|---------|----------------|
| <pattern> | Situational/Durable | Global/Project | <N>/<total> sessions | <brief context> | <what to add> |
```
