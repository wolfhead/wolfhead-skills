---
name: claude-self-improver
description: "Use when you want to promote session analysis findings to project memory and global config. Scans recent session analysis output, groups by project, deduplicates, and promotes to project memory/MEMORY.md and ~/.claude/CLAUDE.md. Triggers: 'self improve', 'auto improve', 'apply session improvements', 'improve from reviews', 'promote learnings'."
---

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
