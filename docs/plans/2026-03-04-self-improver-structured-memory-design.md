# Self-Improver Structured Memory Design

**Date**: 2026-03-04
**Scope**: `skills/claude-self-improver/SKILL.md` + existing MEMORY.md entries

## Problem

MEMORY.md entries accumulate without expiry. No dates on individual entries, no mechanism to remove stale or superseded findings. The ~200 line auto-load limit means unbounded growth is dangerous.

## Design

### New Entry Format

```markdown
- <distilled rule> *(added: YYYY-MM-DD, confirmed: YYYY-MM-DD, sessions: abc123, def456)*
```

- `added`: date entry was first promoted
- `confirmed`: date it was last re-observed by a new session analysis
- `sessions`: list of session IDs that reported this finding

### Three Rules Applied Before Writing

1. **Supersede**: When a new finding semantically contradicts an existing entry, replace the old one with the new one. The new entry gets `added: today`.

2. **Merge on re-observation**: When a new finding matches an existing entry (same concept), update `confirmed` date and append new session IDs. Do not add a duplicate.

3. **Staleness sweep**: Before writing, remove any entry where `confirmed` is >30 days old. This keeps MEMORY.md bounded.

### Migration

Old entries with `*(from sessions X, Y, YYYY-MM-DD)*` are treated as `added: <date>, confirmed: <date>` when the self-improver encounters them. No manual migration needed — entries get rewritten in-place when touched.

### Changes to SKILL.md

1. **Step 3c** — Add supersede and merge logic to existing entry checks
2. **Step 3d** — Update entry format template to use `added`/`confirmed`/`sessions`
3. **New sub-step in 3d** — Staleness sweep before writing (remove entries with `confirmed` >30 days old)
4. **Step 4 (global)** — Same format and rules apply to `~/.claude/MEMORY.md`
