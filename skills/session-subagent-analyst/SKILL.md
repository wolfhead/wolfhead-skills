---
name: session-subagent-analyst
description: "Use when dispatched as a subagent to analyze a Claude Code session transcript for a performance review. Read the condensed JSON file at the path given in your prompt. Follow the checklist and write LEARNINGS.md and ERRORS.md files to the output directory specified in your prompt. Triggers: 'analyze subagent', 'analyze session transcript', 'session performance review subagent'."
---

# Session Subagent Analyst

Analyze one condensed session JSON file and write LEARNINGS.md and ERRORS.md to the output directory given in your prompt. Follow the checklist exactly.

## Input

Read from your prompt:
- **File path**: path to the condensed JSON file
- **Output directory**: where to write LEARNINGS.md and ERRORS.md

**Read the entire file in one call** — use `limit: 10000` to avoid chunked reads that waste tokens on context accumulation.

Extract from the condensed JSON `metadata` field:
- **Session ID**: `metadata.session_id`
- **Project name**: last component of `metadata.project_path` (e.g., `wolfhead_skills`)
- **Project path**: `metadata.project_path` (absolute path)

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

## Concepts

**Learning (LRN)**: Something the agent should do differently next time. Forward-looking behavioral observation. The value is the rule it teaches. Categories:
- `best_practice` — agent used a suboptimal approach; a better one exists (e.g., used sed instead of Edit, spawned subagent for a single tool call)
- `correction` — user explicitly corrected the agent's behavior or output
- `knowledge_gap` — agent lacked knowledge that a skill or specialization could provide
- `insight` — non-trivial suggestion for improving skills or workflows

**Error (ERR)**: An actual failure that produced error output and cost time/tokens. Backward-looking incident record. The value is the impact assessment. Examples:
- Command returned non-zero exit code
- Tool call returned `is_error: true`
- API returned an error response
- Agent hit a doom loop (3+ attempts at same failing operation)

## Main Session Checklist

Check each item. Only report findings — skip items with nothing notable.

- [ ] **Skill timing**: Were skills invoked at the right time? Too early (before enough context)? Too late (after user already decided)? Missed entirely?
- [ ] **Skill arguments**: Were skill invocations given good arguments? Too verbose? Missing context?
- [ ] **User corrections**: Did the user correct the agent? How many times? What pattern?
- [ ] **Rejected interactions**: Were any AskUserQuestion or tool calls rejected by the user? What does this suggest?
- [ ] **Flow efficiency**: How many turns? Were subagents spawned unnecessarily (task could have been a direct tool call)? Token usage proportional to task complexity?
- [ ] **Gaps**: Were there situations where a skill or agent specialization was clearly missing?

## Output — Write Files Directly

After analysis, create the output directory and write two files. Use the output directory, session ID, project name, and project path provided in your prompt.

```bash
mkdir -p <output-directory>
```

**CRITICAL: Copy the header and entry format EXACTLY as shown below. Do not rename fields, change capitalization, add `.md` to titles, or alter punctuation.**

**Write `LEARNINGS.md`** — header MUST be exactly these 6 lines:

```
# Learnings
                                          ← blank line
**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <project-path>
**Analyzed**: <YYYY-MM-DD>
```

Then `---` separator, then entries. Each entry MUST use this exact structure:

```
## [LRN-YYYYMMDD-XXX] <category>

**Priority**: low | medium | high
**Status**: pending
**Area**: <area>
**Occurrences**: <N>

### Summary
<one-line finding>

### Details
<context from session>

### Metadata
- Category: best_practice | correction | knowledge_gap | insight
- Evidence: <what you observed>
- Context: <the situation>

---
```

**Write `ERRORS.md`** — header MUST be exactly these 6 lines:

```
# Errors
                                          ← blank line
**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <project-path>
**Analyzed**: <YYYY-MM-DD>
```

Then `---` separator, then entries. Each entry MUST use this exact structure:

```
## [ERR-YYYYMMDD-XXX] <description>

**Priority**: low | medium | high
**Status**: pending
**Area**: <area>
**Occurrences**: <N>

### Summary
<what failed>

### Error
<actual error output if available>

### Context
<what was being attempted, what went wrong>

### Metadata
- Impact: <time/tokens/failures cost>

---
```

**Empty results:** If no learnings found, write LEARNINGS.md with just the header and `---` (no entries). Same for errors.


**Re-scan behavior:** If the files already exist, overwrite them.

**Category mapping from checklist items:**
- User corrections / preferences → LRN with category `best_practice`
- Suboptimal approaches (wrong tool, unnecessary subagents) → LRN with category `best_practice`
- Skill suggestions → LRN with category `insight`
- Gaps (missing skill or specialization) → LRN with category `knowledge_gap`
- Tool failures (`is_error: true`, non-zero exit) → ERR
- Doom loops (3+ attempts at same failing operation) → ERR

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

### When to report a best_practice learning:
- Agent used the wrong tool for the job (sed instead of Edit, cat instead of Read)
- Agent spawned a subagent for something a single tool call could handle
- Agent kept dead/unused code or artifacts
- User corrects the agent's tool or workflow choice
- User interrupts or rejects an approach and redirects to a different one

### When to report an error:
- Tool call returned `is_error: true` or command returned non-zero exit code
- Agent spent 3+ attempts on a failing approach without changing strategy
- Agent repeated the same failing operation without changing approach
- API or external service returned an error that cost significant time

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

Suboptimal approach with context (LRN entry):
```markdown
## [LRN-20260304-002] best_practice

**Priority**: medium
**Status**: pending
**Area**: backend
**Occurrences**: 1

### Summary
Use Edit tool instead of sed for file modifications

### Details
Agent used sed with pipe delimiters on a Dockerfile path containing /usr/lib/, causing 'bad flag in substitute command'. The Edit tool handles paths correctly and is the preferred approach.

### Metadata
- Category: best_practice
- Evidence: Agent ran sed, got 'bad flag in substitute command'
- Context: Editing a Dockerfile RUN command. Sed delimiter conflicted with path slashes.

---
```

Error with context (ERR entry):
```markdown
## [ERR-20260304-001] npm install failure

**Priority**: medium
**Status**: pending
**Area**: config
**Occurrences**: 2

### Summary
npm install failed — project uses pnpm, not npm

### Error
npm ERR! ERESOLVE could not resolve

### Context
Agent attempted `npm install` to add a dependency. Project uses pnpm workspaces with pnpm-lock.yaml. Command failed with dependency resolution error. Agent then tried `pnpm install` which succeeded.

### Metadata
- Impact: 1 failed command, ~30s wasted

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
