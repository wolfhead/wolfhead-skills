---
name: claude-self-improver
description: "Use when you want to promote session analysis findings to project memory and global memory. Scans recent session analysis output, groups by project, deduplicates, applies promotion thresholds, and promotes to project memory/MEMORY.md and global ~/.claude/MEMORY.md. Triggers: 'self improve', 'auto improve', 'apply session improvements', 'improve from reviews', 'promote learnings'."
---

# Claude Self-Improver

Scan recent session analysis output, group findings by project, deduplicate, and promote to project `memory/MEMORY.md` (per-project) and `~/.claude/MEMORY.md` (global cross-project patterns). Only promote findings that meet the threshold — single-session findings are logged but not promoted.

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

Read each LEARNINGS.md and ERRORS.md found in step 1. Extract the `Project`, `Project-Path`, and `Session` from the file header. For each entry, also extract the `Occurrences` count.

Group all findings by `Project-Path`. Each project gets its own collection of learnings and errors from all sessions that touched that project.

**Deduplication:** If multiple sessions produced the same finding (similar Summary text), merge them:
- Keep the most detailed version
- Track which sessions reported it and total occurrences (sum of per-session `Occurrences`)

### 3. Per-Project Promotion

For each project:

**3a. Apply threshold:**

A finding is ready for promotion when it meets **either** criterion:
- **2+ sessions** reported the same finding (independently observed pattern)
- **3+ total occurrences** across sessions (high frequency, even if fewer sessions)

Findings below threshold are logged in the report as "below threshold" but NOT promoted.

**3b. Distill:**

Promoted findings must be **concise actionable rules**, not verbose descriptions. Distill each finding into a short prevention rule — what to do or avoid.

Example distillation:
- Before: "Agent launched 16 subagents with run_in_background: true. When it attempted to collect results via TaskOutput, the first batch produced 'No task found' errors..."
- After: "Use foreground agents (not `run_in_background`) when you need to collect results — background agents get cleaned up before TaskOutput can read them"

**3c. Check existing entries:**

1. Read the target file: `~/.claude/projects/<project-path>/memory/MEMORY.md`
   - `<project-path>` uses Claude Code convention: absolute path with `/` replaced by `-`
2. Check for **similar** existing entries — skip if the same concept is already present, even in different wording
3. Also check project `CLAUDE.md` at `~/.claude/projects/<project-path>/CLAUDE.md` — skip if already there

**3d. Back up and write:**

Back up the target file before modifying:
```bash
mkdir -p ~/.wolfhead_skills/claude-self-improver/backups/
cp <target-file> ~/.wolfhead_skills/claude-self-improver/backups/$(date +%Y-%m-%d-%H-%M)-$(basename <target-file>)
```

Append new findings under the appropriate section:

**For learnings**, append under `## Session Learnings`:
```markdown
## Session Learnings

- <distilled rule> *(N sessions, N occurrences, <date>)*
```

**For errors**, append under `## Session Errors`:
```markdown
## Session Errors

- **<error pattern>**: <how to avoid> *(N sessions, N occurrences, <date>)*
```

If the sections don't exist, create them at the end of the file. If the file doesn't exist, create it with a header:
```markdown
# Project Memory
```

### 4. Global Promotion

After all per-project promotions are done:

1. Review all findings across ALL projects from step 2
2. Identify patterns appearing in **2+ different projects** (cross-project patterns)
3. Read `~/.claude/MEMORY.md`
4. Check for existing entries — also check `~/.claude/CLAUDE.md` — skip if similar concept already present in either
5. Back up before modifying
6. Distill and append cross-project findings:

**For preferences/learnings**, append under `## Learned Preferences`:
```markdown
## Learned Preferences

- <distilled rule> *(observed across N projects, <date>)*
```

**For anti-patterns/errors**, append under `## Anti-Pattern Reminders`:
```markdown
## Anti-Pattern Reminders

- **<pattern>**: <how to avoid> *(observed across N projects, <date>)*
```

If the sections don't exist, create them at the end of the file. If the file doesn't exist, create it with a header:
```markdown
# Global Memory
```

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

| Finding | Sessions | Occurrences | Distilled Rule |
|---------|----------|-------------|----------------|
| <original summary> | N | N | <promoted rule text> |

### <next project>
...

## Global Promotions

| Finding | Projects | Distilled Rule |
|---------|----------|----------------|
| <summary> | <project1>, <project2> | <promoted rule text> |

## Below Threshold (not promoted)

| Finding | Sessions | Occurrences | Reason |
|---------|----------|-------------|--------|
| <summary> | 1 | N | single session |

## Skipped (already present)

| Finding | Target | Similar Entry |
|---------|--------|---------------|
| <summary> | <file> | <existing entry text> |
```

## Promotion Thresholds

| Level | Threshold | Target |
|-------|-----------|--------|
| Per-project | 2+ sessions OR 3+ total occurrences | `~/.claude/projects/<path>/memory/MEMORY.md` |
| Global | 2+ different projects | `~/.claude/MEMORY.md` |
| Below threshold | — | Logged in report only |

## Quality Standards

- **Threshold required.** Never promote single-session, low-occurrence findings. Log them in the report for future reference.
- **Distill before promoting.** Convert verbose findings into concise actionable rules. No incident reports in MEMORY.md.
- **Check all targets.** Before adding, check both MEMORY.md and CLAUDE.md for similar existing entries.
- **Backup always.** Never modify MEMORY.md without backing up first.
- **Append only.** Never modify or delete existing content in target files.
- **Idempotent.** Running twice on the same data produces no duplicate entries.
- **Per-project first, global second.** Always complete all per-project promotions before starting global.
- **Conservative.** When in doubt about dedup, keep both entries rather than incorrectly merging.
- **Skip trivial findings.** Don't promote obvious observations like "agent used Read to read a file."
