# Design: claude-self-improver adopts .learnings/ data structure

## Goal

Rewrite claude-self-improver to stage findings to `.learnings/` using the self-improving-agent entry format instead of writing directly to CLAUDE.md/MEMORY.md. Adopt Pattern-Key and Recurrence-Count for deduplication and promotion gating.

## Current Flow

```
session-analyst reports → claude-self-improver → CLAUDE.md/MEMORY.md (direct write)
```

## New Flow

```
session-analyst reports → claude-self-improver → ~/.claude/.learnings/ or
                                                  ~/.claude/projects/<path>/.learnings/
                                                        ↓
                          self-improving-agent-claude promotion workflow → CLAUDE.md/MEMORY.md
```

## Changes to claude-self-improver

### Step 1: Gather Reports (changed)

- **Remove** `~/.wolfhead_skills/openclaw-session-analyst/` as a source
- Only read from `~/.wolfhead_skills/claude-session-analyst/`

### Step 2: Extract Findings (changed)

From each session analyst report, extract findings and assign:

- **Category** (aligned with self-improving-agent):
  - User preference → `best_practice`
  - Anti-pattern → `correction`
  - Knowledge gap → `knowledge_gap`
  - Skill suggestion → `insight`

- **Pattern-Key**: stable identifier for deduplication
  - Format: `<category>.<snake_case_descriptor>`
  - Examples: `best_practice.direct_output`, `correction.parallel_file_conflicts`, `insight.edit_coordinator_skill`
  - Must be deterministic — same finding always gets same key

- **Scope**: `Global` or `Project` (from report context)
- **Project path**: if project-scoped, the project's absolute path

### Step 3: Filter & Deduplicate (rewritten — adopts self-improving-agent approach)

For each extracted finding:

1. Determine target `.learnings/` path:
   - Global → `~/.claude/.learnings/LEARNINGS.md`
   - Project → `~/.claude/projects/<project-path>/.learnings/LEARNINGS.md`

2. Search for existing entry: `grep -n "Pattern-Key: <key>" <target>/LEARNINGS.md`

3. **If found (existing entry):**
   - Increment `Recurrence-Count`
   - Update `Last-Seen` to today's date
   - Append new source report filename to `See Also` in metadata
   - Update `Priority`: count 1 = `low`, count 2 = `medium`, count 3+ = `high`

4. **If not found (new entry):**
   - Create new LRN entry (see format below)
   - `Recurrence-Count: 1`
   - `First-Seen: <today>`
   - `Last-Seen: <today>`
   - `Priority: low`

5. **No hard minimum for staging.** Every finding gets written or updated.

6. **Promotion readiness scan:** After all updates, scan for entries matching ALL criteria:
   - `Recurrence-Count >= 3`
   - Seen across 2+ distinct sessions (check `See Also` links)
   - `Last-Seen` within 30 days of `First-Seen`
   - Mark matching entries: `Status: ready_to_promote`

### Step 4: Backup (removed)

No longer needed — not modifying CLAUDE.md/MEMORY.md directly. The `.learnings/` files are append-only staging.

### Step 5: Apply Changes (rewritten)

Create `.learnings/` directory if it doesn't exist (with template files from `self-improving-agent-claude/assets/`).

Write entries to `LEARNINGS.md` using this format:

```markdown
## [LRN-YYYYMMDD-XXX] <category>

**Logged**: YYYY-MM-DDTHH:MM:SSZ
**Priority**: low | medium | high
**Status**: pending | ready_to_promote
**Area**: <from report context>

### Summary
<one-line finding text>

### Details
<context from session analyst report — what happened, which sessions>

### Suggested Action
<for best_practice: "Promote to CLAUDE.md under Learned Preferences">
<for correction: "Promote to CLAUDE.md under Anti-Pattern Reminders">
<for knowledge_gap: "Add to memory/MEMORY.md">
<for insight: "Skill suggestion — review and consider">

### Metadata
- Source: claude-session-analyst
- Pattern-Key: <category.snake_case_descriptor>
- Recurrence-Count: <N>
- First-Seen: YYYY-MM-DD
- Last-Seen: YYYY-MM-DD
- Reports: <comma-separated source report filenames>
- Scope: Global | Project
- See Also: <LRN IDs of related entries>

---
```

For skill suggestions (`insight` category), set `Status: wont_fix` with note: "Skill suggestion only — logged for reference."

### Step 6: Write Improvement Report (updated)

Same report format but updated to reflect new output:

```markdown
# Self-Improvement Report
**Date**: YYYY-MM-DD | **Reports analyzed**: N

## New Entries Created

| Pattern-Key | Category | Target | Priority |
|-------------|----------|--------|----------|
| <key> | best_practice/correction/... | <.learnings/ path> | low/medium/high |

## Existing Entries Updated

| Pattern-Key | New Count | Priority Change | Status |
|-------------|-----------|----------------|--------|
| <key> | N | low→medium | pending/ready_to_promote |

## Entries Ready for Promotion

| Pattern-Key | Summary | Count | Target CLAUDE.md |
|-------------|---------|-------|------------------|
| <key> | <text> | N | global/project |

## Skill Suggestions (logged only)

| Skill | Suggestion | Source |
|-------|-----------|--------|
| <name> | <text> | <report> |
```

## .learnings/ Locations

| Scope | Path |
|-------|------|
| Global | `~/.claude/.learnings/` |
| Project | `~/.claude/projects/<project-path>/.learnings/` |

Where `<project-path>` uses Claude Code's convention: absolute path with `/` replaced by `-` (e.g., `-Users-meixueting-work-wolfhead_skills`).

## What Doesn't Change

- Session analyst reports remain the input format
- Skill suggestions still logged but not promoted
- Improvement report still generated
- The skill is still invoked with same triggers ("self improve", "auto improve", etc.)

## Quality Standards

- **Append only.** Never modify or delete existing `.learnings/` entries (except incrementing Recurrence-Count and updating dates on existing entries).
- **Pattern-Key is sacred.** Same finding must always map to the same key.
- **No direct CLAUDE.md writes.** Self-improver only stages to `.learnings/`. Promotion is handled by the self-improving-agent-claude workflow.
- **Idempotent.** Running twice on the same reports only increments counts, doesn't create duplicates.
- **Create dirs as needed.** If target `.learnings/` doesn't exist, create with template files.

## Relationship to Other Skills

- **self-improving-agent-claude**: Handles real-time capture AND promotion. The self-improver feeds into the same `.learnings/` pool.
- **claude-session-analyst**: Produces the reports that the self-improver reads. No changes needed.
- **openclaw-session-analyst**: No longer consumed by this skill (removed as source).
