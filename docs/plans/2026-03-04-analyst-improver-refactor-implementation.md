# Analyst + Improver Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor claude-session-analyst to write per-session LEARNINGS.md/ERRORS.md files, and rewrite claude-self-improver as a simple aggregator that promotes findings to project MEMORY.md and global CLAUDE.md.

**Architecture:** Session analyst drops the merged report step (old step 4). Instead, each session gets its own directory with LEARNINGS.md and ERRORS.md. Subagent analyst output format changes from JSON to structured markdown. Self-improver scans recent session dirs, groups by project, promotes per-project then global.

**Tech Stack:** Markdown skill files (SKILL.md), Python scripts (unchanged)

**Design doc:** `docs/plans/2026-03-04-analyst-improver-refactor-design.md`

---

### Task 1: Update session-subagent-analyst Output Format

The subagent analyst currently outputs JSON. Update it to output LEARNINGS.md and ERRORS.md content instead, with project metadata.

**Files:**
- Modify: `skills/session-subagent-analyst/SKILL.md`

**Step 1: Read the current SKILL.md**

Run: `cat skills/session-subagent-analyst/SKILL.md`

**Step 2: Rewrite the Output Format section**

Replace the JSON output format section (lines 53-89) with a new output format that produces two markdown blocks: one for learnings and one for errors.

The subagent should output its findings as two clearly delimited blocks:

````markdown
## Output Format

Output your findings as two markdown sections separated by `===ERRORS===`. If a section has no findings, output just the header line.

```
===LEARNINGS===

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

===ERRORS===

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
````

**Category mapping from current JSON fields:**
- `user_preferences` → LRN entries with category `best_practice`
- `skill_suggestions` → LRN entries with category `insight`
- `anti_patterns` → ERR entries
- `gaps` → LRN entries with category `knowledge_gap`

**Keep unchanged:**
- Input section (how to read the condensed JSON)
- Determine Analysis Type section
- Main Session Checklist
- Subsession Checklist
- Reporting Criteria section
- Examples section (update examples to use new markdown format instead of JSON)

**Step 3: Update the examples**

Replace the JSON examples with equivalent markdown examples. For instance:

Old:
```json
{
  "preference": "Uses GitLab, not GitHub",
  "scope": "project",
  "evidence": "Agent ran `gh pr create`, user said 'this is GitLab'",
  "context": "Agent assumed GitHub when creating a merge request."
}
```

New:
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

**Step 4: Update field rules**

Replace the JSON field rules with markdown equivalents:
- "Omit keys with no findings" → "If no learnings found, output `===LEARNINGS===` with nothing after it. Same for errors."
- Keep the substantive rules (non-trivial only, concrete patterns, always include context)

**Step 5: Verify**

Run: `grep -c "```json" skills/session-subagent-analyst/SKILL.md`
Expected: 0 (no JSON output blocks remain, though JSON examples in the "INCORRECT" section may still have JSON for showing what NOT to do — that's fine)

**Step 6: Commit**

```bash
git add skills/session-subagent-analyst/SKILL.md
git commit -m "feat(session-subagent-analyst): output LEARNINGS.md + ERRORS.md format instead of JSON"
```

---

### Task 2: Rewrite claude-session-analyst SKILL.md

Remove the merged report step. Instead, write per-session LEARNINGS.md + ERRORS.md to `~/.wolfhead_skills/claude-session-analyst/<session_id>/`.

**Files:**
- Modify: `skills/claude-session-analyst/SKILL.md`

**Step 1: Read current SKILL.md**

Run: `cat skills/claude-session-analyst/SKILL.md`

**Step 2: Update frontmatter**

Change description to reflect per-session output:

```yaml
description: "Use when the user wants to review past Claude Code sessions. Dispatches subagents to analyze each session, writes per-session LEARNINGS.md and ERRORS.md files. Triggers: 'review session', 'review sessions', 'analyze session', 'session review', 'retrospective', 'debrief'."
```

**Step 3: Update overview paragraph**

Old:
```markdown
Orchestrate session transcript analysis to produce a self-improvement report. Dispatch cheap/fast subagents for analysis work, then synthesize their findings into one unified report.
```

New:
```markdown
Orchestrate session transcript analysis. Dispatch cheap/fast subagents to analyze each session, then write per-session LEARNINGS.md and ERRORS.md files with project metadata.
```

**Step 4: Update process checklist**

Old: 4 steps (Search → Preprocess → Dispatch → Synthesize)
New: 4 steps (Search → Preprocess → Dispatch → Write per-session output)

```markdown
## Process

- [ ] 1. Search for sessions
- [ ] 2. Preprocess each session
- [ ] 3. Dispatch analysis subagents
- [ ] 4. Write per-session output
```

**Step 5: Keep steps 1-3 unchanged**

Steps 1 (Search), 2 (Preprocess), and 3 (Dispatch) remain exactly as they are. The search script, extract script, and subagent dispatch logic are all unchanged.

One change in step 3: update the note about subagent output. The subagents now return markdown (LEARNINGS + ERRORS sections) instead of JSON.

**Step 6: Replace step 4 "Synthesize Report" with "Write Per-Session Output"**

Remove the entire current step 4 (Synthesize Report) and the Report Template section. Replace with:

```markdown
### 4. Write Per-Session Output

For each session analyzed, collect the subagent's output and write it to a per-session directory.

**Output directory:** `~/.wolfhead_skills/claude-session-analyst/<session_id>/`

Create the directory:
```bash
mkdir -p ~/.wolfhead_skills/claude-session-analyst/<session_id>
```

**Determine project metadata** from the session's condensed JSON:
- `Project`: short project name (last component of the project path, e.g., `wolfhead_skills`)
- `Project-Path`: absolute project path from the session metadata

**Write `LEARNINGS.md`:**

Take all LRN entries from the subagent output (main session + all subsessions). Prepend the file header:

```markdown
# Learnings

**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <absolute project path>
**Analyzed**: <ISO-8601 timestamp>

---

(LRN entries from subagent output here)
```

**Write `ERRORS.md`:**

Take all ERR entries from the subagent output. Prepend the file header:

```markdown
# Errors

**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <absolute project path>
**Analyzed**: <ISO-8601 timestamp>

---

(ERR entries from subagent output here)
```

**Re-scan behavior:** If the directory already exists (session was analyzed before), overwrite the files. Keep only the latest analysis.

**Empty results:** If a session produced no learnings, write LEARNINGS.md with just the header. Same for errors.
```

**Step 7: Update Quality Standards**

Keep existing quality standards but remove references to "cross-session patterns" (that's now the self-improver's job). Add:

```markdown
- **Per-session only.** Do not merge findings across sessions. Each session gets its own directory.
- **Project metadata required.** Every LEARNINGS.md and ERRORS.md must have Project and Project-Path in the header.
```

**Step 8: Remove the old Report Template section entirely**

The merged report template (`# Session Analysis Report...`) is no longer needed.

**Step 9: Verify**

Run: `grep -n "Synthesize\|unified report\|Merge rules\|Report Template" skills/claude-session-analyst/SKILL.md`
Expected: No matches.

Run: `grep -n "per-session\|LEARNINGS\.md\|ERRORS\.md\|Project-Path" skills/claude-session-analyst/SKILL.md`
Expected: Multiple matches confirming new content.

**Step 10: Commit**

```bash
git add skills/claude-session-analyst/SKILL.md
git commit -m "feat(claude-session-analyst): per-session LEARNINGS.md + ERRORS.md output instead of merged report"
```

---

### Task 3: Rewrite claude-self-improver SKILL.md

Complete rewrite as a simple aggregator + promoter.

**Files:**
- Modify: `skills/claude-self-improver/SKILL.md`

**Step 1: Read current SKILL.md**

Run: `cat skills/claude-self-improver/SKILL.md`

**Step 2: Replace the entire file**

New frontmatter:

```yaml
---
name: claude-self-improver
description: "Use when you want to promote session analysis findings to project memory and global config. Scans recent session analysis output, groups by project, deduplicates, and promotes to project memory/MEMORY.md and ~/.claude/CLAUDE.md. Triggers: 'self improve', 'auto improve', 'apply session improvements', 'improve from reviews', 'promote learnings'."
---
```

New content:

```markdown
# Claude Self-Improver

Scan recent session analysis output, group findings by project, deduplicate, and promote to project memory/MEMORY.md (per-project) and ~/.claude/CLAUDE.md (global cross-project patterns).

## Process

- [ ] 1. Scan recent sessions
- [ ] 2. Read and group findings
- [ ] 3. Per-project promotion
- [ ] 4. Global promotion
- [ ] 5. Write improvement report

### 1. Scan Recent Sessions

Find all session directories under `~/.wolfhead_skills/claude-session-analyst/` with files updated within 3 days:

```bash
find ~/.wolfhead_skills/claude-session-analyst/ -name "LEARNINGS.md" -mtime -3
find ~/.wolfhead_skills/claude-session-analyst/ -name "ERRORS.md" -mtime -3
```

Use arguments from the calling agent or user to override the window:
- "improve from last 7 days" → `-mtime -7`
- "improve from today" → `-mtime -1`
- No argument → `-mtime -3` (default)

### 2. Read and Group Findings

Read each LEARNINGS.md and ERRORS.md found in step 1. Extract the `Project` and `Project-Path` from the file header.

Group all findings by `Project-Path`. Each project gets its own collection of learnings and errors from all sessions that touched that project.

### 3. Per-Project Promotion

For each project:

1. Collect all LRN and ERR entries for that project across sessions
2. Deduplicate — if multiple sessions produced the same finding (similar Summary text), keep the most detailed version and note frequency
3. Read the target file: `~/.claude/projects/<project-path>/memory/MEMORY.md`
   - `<project-path>` uses Claude Code convention: absolute path with `/` replaced by `-`
4. Check for existing entries — skip any finding already present in MEMORY.md (grep the summary text)
5. Back up the target file before modifying:
   ```bash
   mkdir -p ~/.wolfhead_skills/claude-self-improver/backups/
   cp <target-file> ~/.wolfhead_skills/claude-self-improver/backups/$(date +%Y-%m-%d-%H-%M)-$(basename <target-file>)
   ```
6. Append new findings under the appropriate section:

**For learnings**, append under `## Session Learnings`:
```markdown
## Session Learnings

- <finding text> *(from session <id>, <date>)*
```

**For errors**, append under `## Session Errors`:
```markdown
## Session Errors

- **<error summary>**: <recommendation> *(from session <id>, <date>)*
```

If the sections don't exist, create them at the end of the file. If the file doesn't exist, create it with a header:
```markdown
# Project Memory
```

### 4. Global Promotion

After all per-project promotions are done:

1. Review all findings across ALL projects from step 2
2. Identify patterns appearing in 2+ different projects (cross-project patterns)
3. Read `~/.claude/CLAUDE.md`
4. Check for existing entries — skip if already present
5. Back up before modifying
6. Append cross-project findings:

**For preferences/learnings**, append under `## Learned Preferences`:
```markdown
## Learned Preferences

- <preference text> *(observed across N projects, <date>)*
```

**For anti-patterns/errors**, append under `## Anti-Pattern Reminders`:
```markdown
## Anti-Pattern Reminders

- **<pattern>**: <recommendation> *(observed across N projects, <date>)*
```

If the sections don't exist, create them at the end of the file.

### 5. Write Improvement Report

Write a summary report to:
```
~/.wolfhead_skills/claude-self-improver/YYYY-MM-DD-improvements-report.md
```

Template:
```markdown
# Self-Improvement Report
**Date**: YYYY-MM-DD | **Sessions scanned**: N | **Projects**: N

## Per-Project Promotions

### <project-name>
**Target**: ~/.claude/projects/<path>/memory/MEMORY.md

| Finding | Type | Source Session |
|---------|------|---------------|
| <summary> | learning/error | <session_id> |

### <next project>
...

## Global Promotions

| Finding | Type | Projects |
|---------|------|----------|
| <summary> | preference/anti-pattern | <project1>, <project2> |

## Skipped (already present)

| Finding | Target | Reason |
|---------|--------|--------|
| <summary> | <file> | already present |
```

## Quality Standards

- **Backup always.** Never modify CLAUDE.md or MEMORY.md without backing up first.
- **Append only.** Never modify or delete existing content in target files.
- **Idempotent.** Running twice on the same data produces no duplicate entries.
- **Per-project first, global second.** Always complete all per-project promotions before starting global.
- **Conservative.** When in doubt about dedup, keep both entries rather than incorrectly merging.
- **Skip trivial findings.** Don't promote obvious observations like "agent used Read to read a file."
```

**Step 3: Verify the rewrite**

Run: `grep -n "Pattern-Key\|Recurrence-Count\|\.learnings/" skills/claude-self-improver/SKILL.md`
Expected: No matches (all removed).

Run: `grep -n "per-project\|MEMORY\.md\|CLAUDE\.md\|backup" skills/claude-self-improver/SKILL.md`
Expected: Multiple matches confirming new content.

Run: `grep -n "mtime\|Session Learnings\|Session Errors\|Learned Preferences\|Anti-Pattern Reminders" skills/claude-self-improver/SKILL.md`
Expected: Multiple matches for key sections.

**Step 4: Commit**

```bash
git add skills/claude-self-improver/SKILL.md
git commit -m "feat(claude-self-improver): rewrite as aggregator + promoter to MEMORY.md and CLAUDE.md"
```

---

### Task 4: End-to-End Verification

**Step 1: Verify all three skill files are internally consistent**

Read all three files and check:

1. `session-subagent-analyst/SKILL.md` outputs `===LEARNINGS===` and `===ERRORS===` markdown blocks
2. `claude-session-analyst/SKILL.md` step 3 mentions subagents return markdown (not JSON)
3. `claude-session-analyst/SKILL.md` step 4 writes per-session dirs with LEARNINGS.md + ERRORS.md
4. `claude-self-improver/SKILL.md` reads from `~/.wolfhead_skills/claude-session-analyst/<session_id>/LEARNINGS.md`

Run:
```bash
echo "=== subagent-analyst ===" && grep -c "LEARNINGS\|ERRORS" skills/session-subagent-analyst/SKILL.md
echo "=== session-analyst ===" && grep -c "per-session\|LEARNINGS\|ERRORS\|Project-Path" skills/claude-session-analyst/SKILL.md
echo "=== self-improver ===" && grep -c "LEARNINGS\|ERRORS\|MEMORY\.md\|CLAUDE\.md\|mtime" skills/claude-self-improver/SKILL.md
```

Expected: All counts > 0.

**Step 2: Check no stale references**

Run:
```bash
grep -r "JSON report\|unified report\|Synthesize\|merged report\|Pattern-Key\|Recurrence-Count\|openclaw" skills/claude-session-analyst/SKILL.md skills/claude-self-improver/SKILL.md skills/session-subagent-analyst/SKILL.md
```

Expected: No matches.

**Step 3: Verify data flow chain**

The chain should be:
1. subagent-analyst outputs `===LEARNINGS===` / `===ERRORS===` markdown
2. session-analyst parses that and writes to `~/.wolfhead_skills/claude-session-analyst/<session_id>/LEARNINGS.md`
3. self-improver finds those via `find ... -mtime -3` and promotes to `memory/MEMORY.md` / `CLAUDE.md`

Read each file's output/input sections and confirm they match.

**Step 4: Commit any fixes**

```bash
git add skills/
git commit -m "fix: final verification fixes for analyst-improver refactor"
```
