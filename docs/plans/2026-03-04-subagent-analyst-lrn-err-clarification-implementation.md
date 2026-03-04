# Clarify LRN vs ERR in session-subagent-analyst Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align session-subagent-analyst's LRN/ERR classification with self-improving-agent-claude's model — drop "anti-pattern" concept, sharpen the boundary.

**Architecture:** Single-file edit to `skills/session-subagent-analyst/SKILL.md`. Four insertions/modifications, no downstream changes needed.

**Tech Stack:** Markdown skill document

---

### Task 1: Add Concepts section

**Files:**
- Modify: `skills/session-subagent-analyst/SKILL.md:39` (insert after "Determine Analysis Type" section, before "Main Session Checklist")

**Step 1: Insert Concepts section**

Insert this block after line 39 (after the "Otherwise → Main session" line), before "## Main Session Checklist":

```markdown
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
```

**Step 2: Commit**

```bash
git add skills/session-subagent-analyst/SKILL.md
git commit -m "docs(session-subagent-analyst): add Concepts section defining LRN vs ERR"
```

---

### Task 2: Update category mapping

**Files:**
- Modify: `skills/session-subagent-analyst/SKILL.md` — the "Category mapping from checklist items" block

**Step 1: Replace the category mapping block**

Find:
```markdown
**Category mapping from checklist items:**
- User corrections / preferences → LRN entries with category `best_practice`
- Skill suggestions → LRN entries with category `insight`
- Gaps → LRN entries with category `knowledge_gap`
- Anti-patterns / tool failures / doom loops → ERR entries
```

Replace with:
```markdown
**Category mapping from checklist items:**
- User corrections / preferences → LRN with category `best_practice`
- Suboptimal approaches (wrong tool, unnecessary subagents) → LRN with category `best_practice`
- Skill suggestions → LRN with category `insight`
- Gaps (missing skill or specialization) → LRN with category `knowledge_gap`
- Tool failures (`is_error: true`, non-zero exit) → ERR
- Doom loops (3+ attempts at same failing operation) → ERR
```

**Step 2: Commit**

```bash
git add skills/session-subagent-analyst/SKILL.md
git commit -m "docs(session-subagent-analyst): align category mapping with self-improving-agent model"
```

---

### Task 3: Update reporting criteria

**Files:**
- Modify: `skills/session-subagent-analyst/SKILL.md` — the "When to report an anti-pattern" section

**Step 1: Replace the anti-pattern reporting section**

Find:
```markdown
### When to report an anti-pattern:
- Agent used the wrong tool for the job (sed instead of Edit, cat instead of Read)
- Agent spent 3+ attempts or significant time on a failing approach
- Agent kept dead/unused code or artifacts
- Agent spawned a subagent for something a single tool call could handle
- Agent repeated the same failing operation without changing approach
```

Replace with:
```markdown
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
```

**Step 2: Commit**

```bash
git add skills/session-subagent-analyst/SKILL.md
git commit -m "docs(session-subagent-analyst): replace anti-pattern criteria with best_practice and error sections"
```

---

### Task 4: Update examples

**Files:**
- Modify: `skills/session-subagent-analyst/SKILL.md` — the CORRECT examples section

**Step 1: Replace the ERR example (sed misuse) with a pure failure example**

Find the existing ERR example block (starts with `Anti-pattern with context (ERR entry):`) and replace with:

```markdown
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

**Step 2: Add a best_practice LRN example after the existing LRN example**

Insert after the existing "User preference with context" example and before the new ERR example:

```markdown
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

**Step 3: Commit**

```bash
git add skills/session-subagent-analyst/SKILL.md
git commit -m "docs(session-subagent-analyst): update examples to reflect LRN/ERR boundary"
```

---
