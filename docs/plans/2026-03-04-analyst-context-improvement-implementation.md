# Analyst Context Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make session analysis more accurate by having subagents report with context, and letting the main analyst judge situational vs durable findings.

**Architecture:** Two SKILL.md edits — (1) session-subagent-analyst gets context fields, reporting criteria, and examples; (2) claude-session-analyst gets updated merge rules and report template.

**Tech Stack:** Markdown skill files only.

---

### Task 1: Add context field and reporting criteria to session-subagent-analyst

**Files:**
- Modify: `skills/session-subagent-analyst/SKILL.md`

**Step 1: Add `context` field to `anti_patterns` in the JSON schema (lines 67-72)**

Change:
```json
  "anti_patterns": [
    {
      "pattern": "<short name>",
      "description": "<what happened>",
      "impact": "<time/tokens/failures cost>"
    }
  ],
```

To:
```json
  "anti_patterns": [
    {
      "pattern": "<short name>",
      "description": "<what happened>",
      "impact": "<time/tokens/failures cost>",
      "context": "<the situation: what was the agent trying to do, what went wrong>"
    }
  ],
```

**Step 2: Add `context` field to `user_preferences` in the JSON schema (lines 74-79)**

Change:
```json
  "user_preferences": [
    {
      "preference": "<detected pattern>",
      "scope": "global|project",
      "evidence": "<what you observed>"
    }
  ],
```

To:
```json
  "user_preferences": [
    {
      "preference": "<detected pattern>",
      "scope": "global|project",
      "evidence": "<what you observed>",
      "context": "<the situation: what was the task, what did the agent do, why did the user react>"
    }
  ],
```

**Step 3: Replace the `user_preferences` field rule (line 94)**

Change:
```
- `user_preferences`: only include if evidence appears 2+ times in the session. One correction is not a preference.
```

To:
```
- `user_preferences`: report anything that signals a user preference. Always include `context` explaining the situation. See reporting criteria below.
```

**Step 4: Add `context` requirement to `anti_patterns` field rule (line 93)**

Change:
```
- `anti_patterns`: concrete patterns only. "Agent used Read" is not an anti-pattern. "Agent read the same 500-line file 4 times in one turn" is.
```

To:
```
- `anti_patterns`: concrete patterns only. Always include `context` explaining the situation. "Agent used Read" is not an anti-pattern. "Agent read the same 500-line file 4 times in one turn" is.
```

**Step 5: Add reporting criteria section after the field rules (after line 95)**

Insert after the `gaps` field rule:

```markdown

## Reporting Criteria

### When to report a user preference:
- User explicitly states a rule ("always use X", "I prefer Y", "don't do Z")
- User corrects the agent's tool or workflow choice (e.g., used `gh` when project uses GitLab)
- User interrupts or rejects an approach and redirects to a different one
- User repeats the same type of correction across different tasks in the session
- User expresses frustration, criticism, or disappointment about agent behavior

### When to report an anti-pattern:
- Agent used the wrong tool for the job (sed instead of Edit, cat instead of Read)
- Agent spent 3+ attempts or significant time on a failing approach
- Agent kept dead/unused code or artifacts
- Agent spawned a subagent for something a single tool call could handle
- Agent repeated the same failing operation without changing approach

### Do NOT report:
- Normal tool usage ("agent used Read to read a file")
- Successful operations that worked as expected
- Style inferences from how the user writes ("user writes short messages" ≠ "user prefers brevity")
```

**Step 6: Add correct/incorrect examples after the reporting criteria**

Insert after the reporting criteria section:

```markdown

## Examples

### CORRECT — report like this:

User preference with context:
```json
{
  "preference": "Uses GitLab, not GitHub",
  "scope": "project",
  "evidence": "Agent ran `gh pr create`, user said 'this is GitLab'",
  "context": "Agent assumed GitHub when creating a merge request. User corrected to use GitLab CLI instead."
}
```

Anti-pattern with context:
```json
{
  "anti_patterns": [
    {
      "pattern": "Sed misuse on Dockerfile",
      "description": "Used sed with pipe delimiters on a path containing /usr/lib/, causing 'bad flag in substitute command'",
      "impact": "Tool error, had to rewrite entire file via cat >",
      "context": "Editing a Dockerfile RUN command. Agent chose sed instead of Edit tool. Pipe delimiter conflicted with path slashes."
    }
  ]
}
```

### INCORRECT — do NOT report like this:

Missing context (rejected):
```json
{
  "preference": "Prefers direct output over deep analysis",
  "scope": "global",
  "evidence": "User interrupted twice"
}
```
Why rejected: No context. What was the user's original question? Why did they interrupt? Without this, the main analyst cannot distinguish a situational correction from a durable preference.

Missing context on anti-pattern (rejected):
```json
{
  "pattern": "Faketime rabbit hole",
  "description": "Spent ~45min on approach that doesn't work",
  "impact": "45 minutes wasted"
}
```
Why rejected: No context. What was the agent trying to do? Why didn't it work? What was the eventual solution?
```

**Step 7: Remove the old example section (lines 97-116)**

Delete the old "## Example" section (the sequential web research example) since it's been replaced by the new examples section above that covers both correct and incorrect patterns.

**Step 8: Commit**

```bash
git add skills/session-subagent-analyst/SKILL.md
git commit -m "feat: add context fields and reporting criteria to session-subagent-analyst"
```

---

### Task 2: Update claude-session-analyst merge rules and report template

**Files:**
- Modify: `skills/claude-session-analyst/SKILL.md`

**Step 1: Update the User Preferences merge rule (line 85)**

Change:
```
- **User Preferences**: Only promote to the report if observed in 2+ sessions (single-session observations are noise).
```

To:
```
- **User Preferences**: Include all preferences from subagent reports. Preserve the `context` field. Distinguish between situational corrections (user redirected agent on a specific task) and durable preferences (user stated a general rule or corrected the same type of behavior across different tasks). Label each as `Situational` or `Durable` in the Type column.
```

**Step 2: Update the Anti-patterns report template section (lines 109-116)**

Change:
```markdown
## 2. Anti-patterns

**<pattern-name>**: <description of recurring inefficiency>
- Observed in: <N>/<total> sessions
- Impact: <what it costs — time, tokens, failures>
- Recommendation: <how to fix>

(Omit entire section if none found.)
```

To:
```markdown
## 2. Anti-patterns

**<pattern-name>**: <description of recurring inefficiency>
- Observed in: <N>/<total> sessions
- Context: <the situation where this occurred>
- Impact: <what it costs — time, tokens, failures>
- Recommendation: <how to fix>

(Omit entire section if none found.)
```

**Step 3: Update the User Preferences report template table (lines 120-124)**

Change:
```markdown
## 3. User Preferences

| Preference | Scope | Frequency | Suggested Entry |
|-----------|-------|-----------|----------------|
| <pattern> | Global/Project | <N>/<total> sessions | <what to add to CLAUDE.md or memory> |
```

To:
```markdown
## 3. User Preferences

| Preference | Type | Scope | Frequency | Context | Suggested Entry |
|-----------|------|-------|-----------|---------|----------------|
| <pattern> | Situational/Durable | Global/Project | <N>/<total> sessions | <brief context> | <what to add to CLAUDE.md or memory> |
```

**Step 4: Commit**

```bash
git add skills/claude-session-analyst/SKILL.md
git commit -m "feat: add context and situational/durable distinction to claude-session-analyst"
```

---

### Task 3: Update openclaw-session-analyst to match

**Files:**
- Modify: `skills/openclaw-session-analyst/SKILL.md`

**Step 1: Update the User Preferences merge rule (line 84)**

Change:
```
- **User Preferences**: Only promote if observed in 2+ sessions.
```

To:
```
- **User Preferences**: Include all preferences from subagent reports. Preserve the `context` field. Distinguish between situational corrections and durable preferences. Label each as `Situational` or `Durable` in the Type column.
```

**Step 2: Update the Anti-patterns report template section (lines 110-115)**

Change:
```markdown
**<pattern-name>**: <description>
- Observed in: <N>/<total> sessions
- Impact: <time/tokens/cost>
- Recommendation: <fix>
```

To:
```markdown
**<pattern-name>**: <description>
- Observed in: <N>/<total> sessions
- Context: <the situation where this occurred>
- Impact: <time/tokens/cost>
- Recommendation: <fix>
```

**Step 3: Update the User Preferences report template table (lines 119-124)**

Change:
```markdown
| Preference | Scope | Frequency | Suggested Entry |
|-----------|-------|-----------|----------------|
| <pattern> | Global/Project | <N>/<total> sessions | <what to add to config or memory> |
```

To:
```markdown
| Preference | Type | Scope | Frequency | Context | Suggested Entry |
|-----------|------|-------|-----------|---------|----------------|
| <pattern> | Situational/Durable | Global/Project | <N>/<total> sessions | <brief context> | <what to add to config or memory> |
```

**Step 4: Commit**

```bash
git add skills/openclaw-session-analyst/SKILL.md
git commit -m "feat: add context and situational/durable distinction to openclaw-session-analyst"
```
