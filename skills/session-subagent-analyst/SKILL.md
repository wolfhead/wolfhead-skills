---
name: session-subagent-analyst
description: "Use when dispatched as a subagent to analyze a Claude Code session transcript for a performance review. Read the condensed JSON file at the path given in your prompt. Follow the checklist and write LEARNINGS.md and ERRORS.md files to the output directory specified in your prompt. Triggers: 'analyze subagent', 'analyze session transcript', 'session performance review subagent'."
---

# Session Subagent Analyst

Analyze one condensed session JSON file and write LEARNINGS.md and ERRORS.md to the output directory given in your prompt. Follow the checklist exactly.

## Input

Read the condensed JSON file path and output parameters from your prompt:
- **File path**: path to the condensed JSON file
- **Output directory**: where to write LEARNINGS.md and ERRORS.md
- **Session ID**: for the file header
- **Project name**: for the file header
- **Project path**: for the file header

The condensed JSON file contains:
- `metadata` — session ID, slug, model, tokens, turn durations
- `conversation` — human messages, assistant turns, tool results
- `skills` — skill invocations with name, args, result
- `subagents` — nested subagent invocations (may be empty for subsessions)
- `tool_failures` — tool results with `is_error: true`
- `api_errors` — API errors with retry info
- `compactions` — context compaction events

## Determine Analysis Type

Decision tree:
1. If file path contains `subagents/` → **Subsession** (use Subsession Checklist)
2. If file path ends with `main.json` → **Main session** (use Main Session Checklist)
3. If metadata contains `agentId` field → **Subsession**
4. Otherwise → **Main session**

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
- [ ] **Doom loop**: Are there 3+ consecutive calls to the same tool with the same arguments producing the same error? Flag with the tool name and error. (Different arguments = different attempts, not a loop.)
- [ ] **Redundant operations**: Same file read multiple times? Overlapping search queries? Sequential operations that could be parallel?
- [ ] **Tool failures**: List each `is_error: true` result. Did the subagent recover or get stuck?
- [ ] **Skill compliance**: If a skill was invoked, did the subagent follow its documented steps? "deviated" = skipped steps or ignored instructions.
- [ ] **Token efficiency**: Compare output tokens to task complexity. Flag if output seems 5x+ more than the task warrants (e.g., simple lookup generating 10k tokens).

## Output — Write Files Directly

After analysis, create the output directory and write two files. Use the output directory, session ID, project name, and project path provided in your prompt.

```bash
mkdir -p <output-directory>
```

**Write `LEARNINGS.md`:**

```markdown
# Learnings

**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <project-path>
**Analyzed**: <ISO-8601 timestamp>

---

## [LRN-YYYYMMDD-XXX] <category>

**Priority**: low | medium | high
**Status**: pending
**Area**: <area>

### Summary
<one-line finding>

### Details
<context from session>

### Metadata
- Category: best_practice | correction | knowledge_gap | insight
- Evidence: <what you observed>
- Context: <the situation>

---

(repeat for each learning)
```

**Write `ERRORS.md`:**

```markdown
# Errors

**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <project-path>
**Analyzed**: <ISO-8601 timestamp>

---

## [ERR-YYYYMMDD-XXX] <description>

**Priority**: low | medium | high
**Status**: pending
**Area**: <area>

### Summary
<what failed>

### Error
<actual error output if available>

### Context
<what was being attempted, what went wrong>

### Metadata
- Impact: <time/tokens/failures cost>

---

(repeat for each error)
```

**Empty results:** If no learnings found, write LEARNINGS.md with just the header (no entries). Same for errors.

**Re-scan behavior:** If the files already exist, overwrite them.

**Category mapping from checklist items:**
- User corrections / preferences → LRN entries with category `best_practice`
- Skill suggestions → LRN entries with category `insight`
- Gaps → LRN entries with category `knowledge_gap`
- Anti-patterns / tool failures / doom loops → ERR entries

**Field rules:**
- LRN entries with category `insight`: only include if there are actual non-trivial suggestions. "Skill worked fine" is not a suggestion.
- ERR entries: concrete patterns only. Always include `Context` explaining the situation. "Agent used Read" is not an anti-pattern. "Agent read the same 500-line file 4 times in one turn" is.
- LRN entries with category `best_practice`: report anything that signals a user preference. Always include `Details` and `Metadata` explaining the situation. See reporting criteria below.
- LRN entries with category `knowledge_gap`: only include if there was a clear situation where a skill or specialization would have helped and none exists.

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

## Examples

### CORRECT — report like this:

User preference with context (LRN entry):
```markdown
## [LRN-20260304-001] best_practice

**Priority**: medium
**Status**: pending
**Area**: config

### Summary
Project uses GitLab, not GitHub

### Details
Agent ran `gh pr create`, user corrected: "this is GitLab". Agent assumed GitHub when creating a merge request.

### Metadata
- Category: best_practice
- Evidence: Agent ran `gh pr create`, user said 'this is GitLab'
- Context: Agent assumed GitHub when creating a merge request. User corrected to use GitLab CLI instead.

---
```

Anti-pattern with context (ERR entry):
```markdown
## [ERR-20260304-001] Sed misuse on Dockerfile

**Priority**: medium
**Status**: pending
**Area**: backend

### Summary
Used sed with pipe delimiters on a path containing /usr/lib/, causing 'bad flag in substitute command'

### Error
bad flag in substitute command

### Context
Editing a Dockerfile RUN command. Agent chose sed instead of Edit tool. Pipe delimiter conflicted with path slashes. Had to rewrite entire file via cat >.

### Metadata
- Impact: Tool error, had to rewrite entire file

---
```

### INCORRECT — do NOT report like this:

Missing context (rejected):
```markdown
## [LRN-20260304-002] best_practice

**Priority**: medium
**Status**: pending
**Area**: workflow

### Summary
Prefers direct output over deep analysis

### Metadata
- Category: best_practice
- Evidence: User interrupted twice
```
Why rejected: No context. What was the user's original question? Why did they interrupt? Without this, the main analyst cannot distinguish a situational correction from a durable preference. Missing Details section and Context in Metadata.

Missing context on anti-pattern (rejected):
```markdown
## [ERR-20260304-002] Faketime rabbit hole

**Priority**: medium
**Status**: pending
**Area**: unknown

### Summary
Spent ~45min on approach that doesn't work

### Metadata
- Impact: 45 minutes wasted
```
Why rejected: No context. What was the agent trying to do? Why didn't it work? What was the eventual solution? Missing Error and Context sections.
