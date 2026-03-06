# Design: Refactor claude-session-analyst + claude-self-improver

## Goal

Simplify the session analysis → self-improvement pipeline. Session analyst writes per-session `.learnings/` files with project metadata. Self-improver aggregates recent sessions, promotes per-project first, then global.

## Current Flow (complex)

```
session-analyst → merged cross-session report (free-form markdown)
  → self-improver → Pattern-Key dedup → .learnings/ staging
    → self-improving-agent-claude → CLAUDE.md/MEMORY.md
```

## New Flow (simple)

```
session-analyst (per-session, cheap model)
  → ~/.wolfhead_skills/claude-session-analyst/<session_id>/LEARNINGS.md
  → ~/.wolfhead_skills/claude-session-analyst/<session_id>/ERRORS.md
  (overwrite on re-scan, keep latest only)

self-improver (aggregator, cheap model)
  → scans session dirs updated within 3 days
  → groups by project-name
  → per-project: dedup + promote to project memory/MEMORY.md
  → global: cross-project patterns → promote to ~/.claude/CLAUDE.md
```

## Changes to claude-session-analyst

### Output format change

Instead of one merged report, write per-session findings using the `.learnings/` entry format.

**Output directory:** `~/.wolfhead_skills/claude-session-analyst/<session_id>/`

**Files:**
- `LEARNINGS.md` — preferences, best practices, knowledge gaps, skill suggestions
- `ERRORS.md` — anti-patterns, command failures, tool misuse

**Re-scan behavior:** If the session was already analyzed, overwrite the files (keep latest only). This makes re-scanning idempotent.

### Entry format

Both files use the self-improving-agent entry format with required metadata:

```markdown
# Learnings

**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <absolute project path>
**Analyzed**: <ISO-8601 timestamp>

---

## [LRN-YYYYMMDD-XXX] <category>

**Logged**: YYYY-MM-DDTHH:MM:SSZ
**Priority**: low | medium | high
**Status**: pending
**Area**: <area>

### Summary
<one-line finding>

### Details
<context from session>

### Metadata
- Source: claude-session-analyst
- Project: <project-name>
- Session: <session_id>
- Category: best_practice | correction | knowledge_gap | insight

---
```

For ERRORS.md, same format but with ERR IDs:

```markdown
# Errors

**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <absolute project path>
**Analyzed**: <ISO-8601 timestamp>

---

## [ERR-YYYYMMDD-XXX] <description>

**Logged**: YYYY-MM-DDTHH:MM:SSZ
**Priority**: low | medium | high
**Status**: pending
**Area**: <area>

### Summary
<what failed>

### Error
<actual error output>

### Context
<what was being attempted>

### Metadata
- Source: claude-session-analyst
- Project: <project-name>
- Session: <session_id>

---
```

### Required metadata fields

The file header MUST include:
- **Project**: short project name (e.g., `wolfhead_skills`, `openclaw`)
- **Project-Path**: absolute path (e.g., `/Users/meixueting/work/wolfhead_skills`)

These are used by the self-improver to group and route findings.

### What stays the same

- Search script (`scripts/search_sessions.py`) — unchanged
- Extract script (`scripts/extract_session.py`) — unchanged
- Subagent dispatch for analysis — unchanged
- The session-subagent-analyst skill — needs minor update to output in LRN/ERR format instead of JSON

### What changes in the session-subagent-analyst

The subagent currently produces a JSON report. Update it to produce `LEARNINGS.md` and `ERRORS.md` files directly, or return structured data that the orchestrator writes in the correct format.

### Synthesize step (step 4) — removed

The current step 4 "Synthesize Report" merges all subagent findings into one report. This is no longer needed — each session gets its own directory with its own files. No cross-session merging at this stage.

## Changes to claude-self-improver

### Complete rewrite

The self-improver becomes a simple aggregator + promoter.

### Process

1. **Scan recent sessions** — find all session directories under `~/.wolfhead_skills/claude-session-analyst/` updated within 3 days
2. **Read findings** — read all `LEARNINGS.md` and `ERRORS.md` from those directories
3. **Group by project** — use the `Project` / `Project-Path` metadata from file headers
4. **Per-project promotion** — for each project:
   - Collect all findings for that project
   - Deduplicate (LLM judgment — small set, cheap model can handle)
   - Promote to `~/.claude/projects/<project-path>/memory/MEMORY.md`
   - Append under `## Session Learnings` and `## Session Errors` sections
5. **Global promotion** — after all projects:
   - Find patterns that appear across 2+ projects
   - Promote cross-project findings to `~/.claude/CLAUDE.md`
   - Append under `## Learned Preferences` and `## Anti-Pattern Reminders` sections
6. **Write improvement report** — summary of what was promoted where

### Scanning

```bash
find ~/.wolfhead_skills/claude-session-analyst/ -name "LEARNINGS.md" -mtime -3
find ~/.wolfhead_skills/claude-session-analyst/ -name "ERRORS.md" -mtime -3
```

### Per-project promotion format

Append to `~/.claude/projects/<project-path>/memory/MEMORY.md`:

```markdown
## Session Learnings

- <finding text> *(from session <id>, <date>)*

## Session Errors

- **<error summary>**: <recommendation> *(from session <id>, <date>)*
```

### Global promotion format

Append to `~/.claude/CLAUDE.md`:

```markdown
## Learned Preferences

- <preference text> *(observed across N projects, <date>)*

## Anti-Pattern Reminders

- **<pattern>**: <recommendation> *(observed across N projects, <date>)*
```

### Idempotency

Before appending, check if the finding already exists in the target file (simple grep or LLM check on the summary text). Skip if already present.

### Backup

Before modifying any CLAUDE.md or MEMORY.md, back up to `~/.wolfhead_skills/claude-self-improver/backups/`.

## Key Simplifications

| Before | After |
|--------|-------|
| Merged cross-session report | Per-session LEARNINGS.md + ERRORS.md |
| Pattern-Key dedup | LLM judgment (small set) |
| Recurrence-Count tracking | Not needed (3-day window is small) |
| .learnings/ staging → separate promotion | Direct promotion to MEMORY.md / CLAUDE.md |
| Complex confidence filtering | Simple dedup on small dataset |
| 3-step pipeline (analyst → self-improver → self-improving-agent) | 2-step pipeline (analyst → self-improver) |

## Model Requirements

Both skills can run on cheap/fast models (deepseek, haiku, etc.):
- Session analyst subagents: read JSON, extract findings, write structured markdown
- Self-improver: read a handful of markdown files, deduplicate, append to targets

## Relationship to self-improving-agent-claude

The self-improving-agent-claude skill remains for **real-time capture** during sessions. This pipeline handles **post-hoc analysis**. They complement each other:
- Real-time: self-improving-agent-claude hooks → capture to project `.learnings/`
- Post-hoc: session-analyst → per-session analysis → self-improver → promote to MEMORY.md/CLAUDE.md
