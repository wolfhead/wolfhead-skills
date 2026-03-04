# Claude Self-Improver Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a skill that reads session analysis reports and directly applies high-confidence, low-risk preference and anti-pattern findings to CLAUDE.md/MEMORY.md files, with backups.

**Architecture:** Three changes — (1) update output paths in both analyst skills, (2) create the new `claude-self-improver` skill. The skill is a pure SKILL.md (no scripts) that instructs Claude to read reports, extract findings, back up files, and append entries.

**Tech Stack:** Markdown skill files, shell commands for backup/directory creation.

---

### Task 1: Update claude-session-analyst output path

**Files:**
- Modify: `skills/claude-session-analyst/SKILL.md:80`

**Step 1: Edit the output path**

Change line 80 from:
```
Read all subagent JSON reports. Merge findings across all sessions into one unified report. Write to `docs/reviews/YYYY-MM-DD-sessions-review.md` (create directory if needed).
```
To:
```
Read all subagent JSON reports. Merge findings across all sessions into one unified report. Write to `~/.wolfhead_skills/claude-session-analyst/YYYY-MM-DD-<slug>-review.md` (create directory if needed). Use the session slug from metadata for the filename.
```

**Step 2: Commit**

```bash
git add skills/claude-session-analyst/SKILL.md
git commit -m "chore: change claude-session-analyst output path to ~/.wolfhead_skills/"
```

---

### Task 2: Update openclaw-session-analyst output path

**Files:**
- Modify: `skills/openclaw-session-analyst/SKILL.md:79`

**Step 1: Edit the output path**

Change line 79 from:
```
Read all subagent JSON reports. Merge findings across all sessions into one unified report. Write to `docs/reviews/YYYY-MM-DD-openclaw-sessions-review.md`.
```
To:
```
Read all subagent JSON reports. Merge findings across all sessions into one unified report. Write to `~/.wolfhead_skills/openclaw-session-analyst/YYYY-MM-DD-<slug>-review.md` (create directory if needed). Use the session slug or agent ID from metadata for the filename.
```

**Step 2: Commit**

```bash
git add skills/openclaw-session-analyst/SKILL.md
git commit -m "chore: change openclaw-session-analyst output path to ~/.wolfhead_skills/"
```

---

### Task 3: Create claude-self-improver SKILL.md

**Files:**
- Create: `skills/claude-self-improver/SKILL.md`

**Step 1: Write the skill file**

```markdown
---
name: claude-self-improver
description: "Use when you want to automatically apply high-confidence improvements from session analysis reports to CLAUDE.md and MEMORY.md files. Reads reports from ~/.wolfhead_skills/claude-session-analyst/ and ~/.wolfhead_skills/openclaw-session-analyst/, backs up target files, and appends preferences and anti-pattern reminders. Triggers: 'self improve', 'auto improve', 'apply session improvements', 'improve from reviews'."
---

# Claude Self-Improver

Read session analysis reports and apply high-confidence, low-risk findings (preferences and anti-pattern reminders) to CLAUDE.md and MEMORY.md files. Back up before modifying.

## Process

- [ ] 1. Gather reports
- [ ] 2. Extract findings
- [ ] 3. Filter and deduplicate
- [ ] 4. Backup target files
- [ ] 5. Apply changes
- [ ] 6. Write improvement report

### 1. Gather Reports

Read review `.md` files from:
- `~/.wolfhead_skills/claude-session-analyst/`
- `~/.wolfhead_skills/openclaw-session-analyst/`

Use arguments from the calling agent or user to filter:
- "improve from latest" → read only the most recent report from each directory
- "improve from last N" → read the N most recent reports
- "improve since YYYY-MM-DD" → read reports dated on or after that date
- No argument → read all reports

List files with:
```bash
ls -t ~/.wolfhead_skills/claude-session-analyst/*.md 2>/dev/null
ls -t ~/.wolfhead_skills/openclaw-session-analyst/*.md 2>/dev/null
```

### 2. Extract Findings

From each report, extract:

**Preferences** — found in the "User Preferences" or "User Interaction Analysis" sections. Each preference has:
- The preference text
- Scope: `Global` or `Project` (as stated in the report)
- Project path (if project-scoped, infer from the report's session context)
- Source report filename

**Anti-patterns** — found in the "Anti-patterns" or "Usage Patterns → Anti-patterns" sections. Each has:
- Pattern name and description
- Recommendation (how to avoid)
- Source report filename

**Skill suggestions** — found in "Per-Skill Performance" (skill_suggestion fields) and "Gap Analysis". Log these but do NOT apply them.

### 3. Filter and Deduplicate

**Confidence filter:** Only act on findings observed in 2+ reports. Single-report findings are logged but skipped.

**Deduplication:** Group findings by semantic similarity. Two preferences are "similar" if they describe the same behavior (e.g., "user prefers direct output" and "provide lists directly without deep analysis" are the same). Keep the most specific wording.

**Scope determination:**
| Finding type | Cross-project evidence? | Target file |
|---|---|---|
| Preference | Yes (2+ different projects) | `~/.claude/CLAUDE.md` |
| Preference | No (single project) | `~/.claude/projects/<project-path>/CLAUDE.md` or project MEMORY.md |
| Anti-pattern | General tool misuse | `~/.claude/CLAUDE.md` |
| Anti-pattern | Project-specific | `~/.claude/projects/<project-path>/CLAUDE.md` |

**Idempotency check:** Before adding any entry, read the target file and check if a similar entry already exists. If the key concept is already present (even in different wording), skip it. Report it as "already present".

### 4. Backup Target Files

Before modifying ANY file, back it up:

```bash
mkdir -p ~/.wolfhead_skills/claude-self-improver/backups/
cp <target-file> ~/.wolfhead_skills/claude-self-improver/backups/$(date +%Y-%m-%d-%H-%M)-$(basename <target-file>)
```

Record the backup path for the improvement report.

### 5. Apply Changes

**For preferences**, append to the target file under a `## Learned Preferences` section. If the section doesn't exist, create it at the end of the file.

Format:
```markdown
## Learned Preferences

- <preference text> *(observed in N sessions, added YYYY-MM-DD)*
```

If the section already exists, append new entries to it.

**For anti-patterns**, append to the target file under a `## Anti-Pattern Reminders` section.

Format:
```markdown
## Anti-Pattern Reminders

- **<pattern-name>**: <recommendation to avoid it> *(observed in N sessions, added YYYY-MM-DD)*
```

### 6. Write Improvement Report

Write a summary report to:
```
~/.wolfhead_skills/claude-self-improver/YYYY-MM-DD-improvements-report.md
```

Template:
```markdown
# Self-Improvement Report
**Date**: YYYY-MM-DD | **Reports analyzed**: N

## Applied Changes

| Finding | Type | Target File | Backup |
|---------|------|-------------|--------|
| <summary> | preference/anti-pattern | <path> | <backup path> |

## Skipped Findings

| Finding | Reason |
|---------|--------|
| <summary> | low confidence (1 session) / already present / skill-related |

## Skill Suggestions (logged only)

| Skill | Suggestion | Source |
|-------|-----------|--------|
| <name> | <suggestion text> | <report filename> |
```

## Quality Standards

- **Append only.** Never modify or delete existing content in CLAUDE.md or MEMORY.md.
- **Back up always.** Never skip the backup step.
- **Conservative.** When in doubt, skip and log rather than apply.
- **No skill modifications.** Log skill suggestions but never touch SKILL.md files.
- **Idempotent.** Running twice on the same reports produces no duplicate entries.
```

**Step 2: Commit**

```bash
git add skills/claude-self-improver/SKILL.md
git commit -m "feat: add claude-self-improver skill"
```

---

### Task 4: Verify skill structure

**Step 1: Check that the skill directory is properly structured**

```bash
ls -la skills/claude-self-improver/
cat skills/claude-self-improver/SKILL.md | head -5
```

Expected: SKILL.md exists with proper YAML frontmatter.

**Step 2: Verify output directories can be created**

```bash
mkdir -p ~/.wolfhead_skills/claude-session-analyst/
mkdir -p ~/.wolfhead_skills/openclaw-session-analyst/
mkdir -p ~/.wolfhead_skills/claude-self-improver/backups/
ls ~/.wolfhead_skills/
```

Expected: all three directories exist.
