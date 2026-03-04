# Claude Self-Improver — Design

**Date**: 2026-03-04

## Overview

A skill that reads session analysis reports, extracts actionable findings, and directly applies high-confidence, low-risk improvements to CLAUDE.md and MEMORY.md files. Also includes output path changes for both session analysts.

## Changes to Existing Skills

### claude-session-analyst

Change report output path from:
- `docs/reviews/YYYY-MM-DD-sessions-review.md`

To:
- `~/.wolfhead_skills/claude-session-analyst/YYYY-MM-DD-<slug>-review.md`

### openclaw-session-analyst

Change report output path from:
- `docs/reviews/YYYY-MM-DD-openclaw-sessions-review.md`

To:
- `~/.wolfhead_skills/openclaw-session-analyst/YYYY-MM-DD-<slug>-review.md`

## New Skill: claude-self-improver

### Trigger

Invoked by an external agent (OpenClaw or wrapper) after session analysis reports are produced. Can also be invoked manually.

### Input

Reads `*.md` review files from:
- `~/.wolfhead_skills/claude-session-analyst/`
- `~/.wolfhead_skills/openclaw-session-analyst/`

The calling agent can specify which files or use defaults (latest N, since date, all unprocessed).

### Process

1. **Gather reports** — find and read review `.md` files from both analyst directories
2. **Extract findings** — parse preferences, anti-patterns, and skill suggestions from each report
3. **Cross-reference** — deduplicate findings, count frequency across sessions, determine scope
4. **Filter** — only act on findings observed in 2+ sessions (high confidence, low risk)
5. **Determine scope** — decide whether each finding targets global `~/.claude/CLAUDE.md`, project-level CLAUDE.md, or MEMORY.md
6. **Check idempotency** — fuzzy-match against existing entries to avoid duplicates
7. **Backup** — copy each target file to `~/.wolfhead_skills/claude-self-improver/backups/YYYY-MM-DD-HH-MM-<filename>` before modifying
8. **Apply** — append preference or anti-pattern entries to the appropriate file
9. **Report** — output summary of what was changed, what was skipped, and backup locations

### Scope Determination

| Finding type | Cross-project? | Target |
|---|---|---|
| Preference | Yes | Global `~/.claude/CLAUDE.md` |
| Preference | No (single project) | Project-level CLAUDE.md or MEMORY.md |
| Anti-pattern | Tool misuse (general) | Global `~/.claude/CLAUDE.md` |
| Anti-pattern | Project-specific | Project-level CLAUDE.md |
| Skill suggestion | — | Logged only, not applied |

### What It Applies (now)

- **User preferences**: appended to the appropriate CLAUDE.md under a `## Learned Preferences` section
- **Anti-pattern reminders**: appended under a `## Anti-Pattern Reminders` section

### What It Skips (for now)

- **Skill modifications**: logged in the report output but not applied
- **Low-confidence findings**: observed in <2 sessions, logged but not applied
- **Risky changes**: anything that would modify or remove existing content

### Idempotency

Before appending, check if a semantically similar entry already exists in the target file. If so, skip. This prevents duplicate entries across multiple runs.

### Backup Strategy

Before modifying any file, copy it to:
```
~/.wolfhead_skills/claude-self-improver/backups/YYYY-MM-DD-HH-MM-<filename>
```

The report output includes backup paths so changes can be reverted.

### Output

The skill writes a summary report to:
```
~/.wolfhead_skills/claude-self-improver/YYYY-MM-DD-improvements-report.md
```

Containing:
- Applied changes (what, where, why, backup path)
- Skipped findings (what, why — low confidence, duplicate, skill-related)
- Skill suggestions (logged for future action)
