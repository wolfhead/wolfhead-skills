# Design: Clarify LRN vs ERR in session-subagent-analyst

**Date**: 2026-03-04
**Scope**: `skills/session-subagent-analyst/SKILL.md` only
**Motivation**: The LRN/ERR boundary is fuzzy — "anti-patterns" is a legacy concept not present in self-improving-agent-claude. Align classification to match the upstream model.

## Decision

Align session-subagent-analyst's classification with self-improving-agent-claude:

- **LRN (Learning)**: Forward-looking behavioral observation. The value is the rule it teaches.
- **ERR (Error)**: Actual failure that produced error output. The value is the incident record with impact.

"Anti-pattern" is dropped as a concept. What was previously called an anti-pattern splits into:
- Suboptimal approach (no crash) → LRN with category `best_practice`
- Actual failure (error output) → ERR

## Changes

### 1. Add "Concepts" section

Insert after "Determine Analysis Type", before "Main Session Checklist". Defines LRN and ERR with categories and examples, aligned to self-improving-agent-claude.

LRN categories: `best_practice`, `correction`, `knowledge_gap`, `insight`
ERR scope: `is_error: true`, non-zero exit, API errors, doom loops (3+ failed attempts)

### 2. Update category mapping

Replace:
```
- Anti-patterns / tool failures / doom loops → ERR entries
```

With:
```
- Suboptimal approaches (wrong tool, unnecessary subagents) → LRN with category `best_practice`
- Tool failures (`is_error: true`, non-zero exit) → ERR
- Doom loops (3+ attempts at same failing operation) → ERR
```

### 3. Update reporting criteria

Rename "When to report an anti-pattern" → "When to report an error" and scope to actual failures.

Move behavioral items (wrong tool, unnecessary subagents, dead code) to a new "When to report a best_practice learning" section.

### 4. Update examples

- Move the "Sed misuse" ERR example → LRN with category `best_practice` (the lesson is "use Edit instead of sed")
- Add a pure failure ERR example (e.g., npm install fails because project uses pnpm)

## Non-changes

- **claude-session-analyst**: Orchestrator only, no classification logic. No changes.
- **claude-self-improver**: Deduplicates by Summary text, classification-agnostic. No changes.
- **Output format**: LRN and ERR entry structure unchanged. Only classification rules change.
