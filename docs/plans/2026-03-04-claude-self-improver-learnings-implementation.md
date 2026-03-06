# claude-self-improver .learnings/ Adoption Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite claude-self-improver SKILL.md to stage findings to `.learnings/` using self-improving-agent entry format with Pattern-Key and Recurrence-Count, instead of writing directly to CLAUDE.md/MEMORY.md.

**Architecture:** Single-file rewrite of `skills/claude-self-improver/SKILL.md`. No scripts or code — this is a pure Markdown skill file that instructs Claude how to behave. The rewrite changes the output target (`.learnings/` instead of CLAUDE.md), adopts the LRN entry format, and replaces semantic deduplication with Pattern-Key grep.

**Tech Stack:** Markdown (SKILL.md)

**Design doc:** `docs/plans/2026-03-04-claude-self-improver-learnings-design.md`

---

### Task 1: Rewrite SKILL.md — Frontmatter and Overview

**Files:**
- Modify: `skills/claude-self-improver/SKILL.md:1-18`

**Step 1: Update frontmatter description**

Change the description to reflect the new behavior. Remove references to "CLAUDE.md and MEMORY.md" and "openclaw-session-analyst". New description should say it stages findings to `.learnings/` using the self-improving-agent entry format.

Old:
```yaml
description: "Use when you want to automatically apply high-confidence improvements from session analysis reports to CLAUDE.md and MEMORY.md files. Reads reports from ~/.wolfhead_skills/claude-session-analyst/ and ~/.wolfhead_skills/openclaw-session-analyst/, backs up target files, and appends preferences and anti-pattern reminders. Triggers: 'self improve', 'auto improve', 'apply session improvements', 'improve from reviews'."
```

New:
```yaml
description: "Use when you want to stage session analysis findings as .learnings/ entries for later promotion. Reads reports from ~/.wolfhead_skills/claude-session-analyst/, extracts findings, and writes them as structured LRN entries to ~/.claude/.learnings/ (global) or ~/.claude/projects/<path>/.learnings/ (project). Uses Pattern-Key deduplication and Recurrence-Count tracking. Triggers: 'self improve', 'auto improve', 'apply session improvements', 'improve from reviews'."
```

**Step 2: Update overview paragraph**

Old:
```markdown
Read session analysis reports and apply high-confidence, low-risk findings (preferences and anti-pattern reminders) to CLAUDE.md and MEMORY.md files. Back up before modifying.
```

New:
```markdown
Read session analysis reports and stage findings as structured `.learnings/` entries for later promotion. Uses Pattern-Key deduplication and Recurrence-Count tracking aligned with the self-improving-agent-claude workflow.
```

**Step 3: Update process checklist**

Replace the 6-step checklist with:
```markdown
## Process

- [ ] 1. Gather reports
- [ ] 2. Extract findings
- [ ] 3. Deduplicate and update counts
- [ ] 4. Write new entries
- [ ] 5. Scan for promotion readiness
- [ ] 6. Write improvement report
```

**Step 4: Verify changes**

Run: `head -20 skills/claude-self-improver/SKILL.md`
Expected: New frontmatter, no mention of "CLAUDE.md and MEMORY.md" in overview.

**Step 5: Commit**

```bash
git add skills/claude-self-improver/SKILL.md
git commit -m "feat(claude-self-improver): update frontmatter and overview for .learnings/ output"
```

---

### Task 2: Rewrite Step 1 — Gather Reports

**Files:**
- Modify: `skills/claude-self-improver/SKILL.md:19-35`

**Step 1: Remove openclaw-session-analyst source**

Replace the entire "### 1. Gather Reports" section. Remove `~/.wolfhead_skills/openclaw-session-analyst/` line. Only source is `~/.wolfhead_skills/claude-session-analyst/`.

New section:
```markdown
### 1. Gather Reports

Read review `.md` files from:
- `~/.wolfhead_skills/claude-session-analyst/`

Use arguments from the calling agent or user to filter:
- "improve from latest" → read only the most recent report
- "improve from last N" → read the N most recent reports
- "improve since YYYY-MM-DD" → read reports dated on or after that date
- No argument → read all reports

List files with:
```bash
ls -t ~/.wolfhead_skills/claude-session-analyst/*.md 2>/dev/null
```
```

**Step 2: Verify**

Run: `grep -n "openclaw" skills/claude-self-improver/SKILL.md`
Expected: No matches.

**Step 3: Commit**

```bash
git add skills/claude-self-improver/SKILL.md
git commit -m "feat(claude-self-improver): remove openclaw source, only read claude-session-analyst"
```

---

### Task 3: Rewrite Step 2 — Extract Findings

**Files:**
- Modify: `skills/claude-self-improver/SKILL.md:37-52`

**Step 1: Replace the extract findings section**

New section:
```markdown
### 2. Extract Findings

From each report, extract findings and assign structured metadata:

**Preferences** — found in "User Preferences" or "User Interaction Analysis" sections.
- Category: `best_practice`
- Pattern-Key: `best_practice.<snake_case_descriptor>` (e.g., `best_practice.direct_output`, `best_practice.plan_before_execute`)
- Scope: `Global` or `Project` (as stated in the report)
- Project path (if project-scoped, infer from the report's session context)
- Source report filename

**Anti-patterns** — found in "Anti-patterns" or "Usage Patterns → Anti-patterns" sections.
- Category: `correction`
- Pattern-Key: `correction.<snake_case_descriptor>` (e.g., `correction.parallel_file_conflicts`, `correction.worktree_doom_loop`)
- Recommendation (how to avoid)
- Source report filename

**Knowledge gaps** — found in "Gaps" or "Gap Analysis" sections.
- Category: `knowledge_gap`
- Pattern-Key: `knowledge_gap.<snake_case_descriptor>`
- Source report filename

**Skill suggestions** — found in "Per-Skill Performance" (skill_suggestion fields) and "Skill Suggestions" sections.
- Category: `insight`
- Pattern-Key: `insight.<snake_case_descriptor>`
- Log these but mark as `Status: wont_fix`

**Pattern-Key rules:**
- Must be deterministic: the same finding always maps to the same key
- Use lowercase snake_case after the category prefix
- Be specific: `correction.parallel_file_conflicts` not `correction.file_issue`
- Derive from the finding's core concept, not the session or report
```

**Step 2: Commit**

```bash
git add skills/claude-self-improver/SKILL.md
git commit -m "feat(claude-self-improver): rewrite extract step with categories and Pattern-Keys"
```

---

### Task 4: Rewrite Step 3 — Deduplicate and Update Counts

**Files:**
- Modify: `skills/claude-self-improver/SKILL.md:54-91`

**Step 1: Replace the entire filter/deduplicate section**

This is the biggest change. Replace the old confidence assessment, hard minimum, semantic dedup, valid target files, scope determination, and idempotency sections with the new Pattern-Key approach.

New section:
```markdown
### 3. Deduplicate and Update Counts

For each extracted finding:

**Determine target `.learnings/` path:**

| Scope | Target |
|-------|--------|
| Global | `~/.claude/.learnings/LEARNINGS.md` |
| Project | `~/.claude/projects/<project-path>/.learnings/LEARNINGS.md` |

Where `<project-path>` uses Claude Code's convention: absolute path with `/` replaced by `-` (e.g., `-Users-meixueting-work-wolfhead_skills`).

**Search for existing entry:**

```bash
grep -n "Pattern-Key: <key>" <target-dir>/LEARNINGS.md
```

**If found (existing entry):**
1. Read the existing entry
2. Increment `Recurrence-Count` by 1
3. Update `Last-Seen` to today's date
4. Append new source report filename to the `Reports` metadata line
5. Add `See Also` link if referencing a new related entry
6. Update `Priority` based on new count:
   - Count 1 → `low`
   - Count 2 → `medium`
   - Count 3+ → `high`
7. Do NOT create a new entry — update in place

**If not found (new entry):**
- Will be created in step 4 (Write New Entries)

**No hard minimum for staging.** Every finding gets written or updated, regardless of how many reports mention it. The threshold is for promotion readiness, not for capture.
```

**Step 2: Commit**

```bash
git add skills/claude-self-improver/SKILL.md
git commit -m "feat(claude-self-improver): rewrite dedup with Pattern-Key grep and Recurrence-Count"
```

---

### Task 5: Rewrite Steps 4 and 5 — Write New Entries and Scan for Promotion

**Files:**
- Modify: `skills/claude-self-improver/SKILL.md:93-125`

**Step 1: Replace old backup and apply sections with two new sections**

Remove the old "### 4. Backup Target Files" and "### 5. Apply Changes" sections entirely. Replace with:

```markdown
### 4. Write New Entries

For findings not found in step 3, create `.learnings/` directory if needed and append new entries.

**Create directory if missing:**

```bash
mkdir -p <target-dir>
```

If the target `LEARNINGS.md` doesn't exist, create it with this header:

```markdown
# Learnings

Corrections, insights, and knowledge gaps captured from session analysis.

**Categories**: correction | best_practice | knowledge_gap | insight
**Statuses**: pending | ready_to_promote | wont_fix

---
```

**Append new LRN entry:**

```markdown
## [LRN-YYYYMMDD-XXX] <category>

**Logged**: YYYY-MM-DDTHH:MM:SSZ
**Priority**: low
**Status**: pending
**Area**: <infer from report context: frontend | backend | infra | tests | docs | config>

### Summary
<one-line finding text>

### Details
<context from session analyst report — what happened, in which sessions>

### Suggested Action
<see mapping below>

### Metadata
- Source: claude-session-analyst
- Pattern-Key: <category.snake_case_descriptor>
- Recurrence-Count: 1
- First-Seen: YYYY-MM-DD
- Last-Seen: YYYY-MM-DD
- Reports: <source report filename>
- Scope: Global | Project
- See Also:

---
```

**Suggested Action mapping:**

| Category | Suggested Action |
|----------|-----------------|
| `best_practice` | Promote to CLAUDE.md under Learned Preferences |
| `correction` | Promote to CLAUDE.md under Anti-Pattern Reminders |
| `knowledge_gap` | Add to memory/MEMORY.md |
| `insight` | Skill suggestion — review and consider |

**For `insight` entries (skill suggestions):** Set `Status: wont_fix` instead of `pending`. Add note: "Skill suggestion only — logged for reference, not for promotion."

**ID generation:** `LRN-YYYYMMDD-XXX` where XXX is a sequential 3-digit number. Check existing entries in the file to determine the next number for today's date.

### 5. Scan for Promotion Readiness

After all new entries are written and existing entries are updated, scan all entries in each target `LEARNINGS.md` for promotion readiness.

**An entry is ready for promotion when ALL criteria are met:**
- `Recurrence-Count >= 3`
- Seen across 2+ distinct sessions (count unique report filenames in `Reports` metadata)
- `Last-Seen` is within 30 days of `First-Seen`
- Current `Status` is `pending` (not already `ready_to_promote` or `wont_fix`)

**For entries meeting all criteria:**
- Update `Status: pending` → `Status: ready_to_promote`
- Update `Priority` to `high` if not already

**Do NOT promote entries yourself.** Mark them as ready and report them. The self-improving-agent-claude promotion workflow handles actual promotion to CLAUDE.md/MEMORY.md.
```

**Step 2: Commit**

```bash
git add skills/claude-self-improver/SKILL.md
git commit -m "feat(claude-self-improver): rewrite apply step to write LRN entries and scan promotion"
```

---

### Task 6: Rewrite Step 6 — Improvement Report and Quality Standards

**Files:**
- Modify: `skills/claude-self-improver/SKILL.md:127-164`

**Step 1: Replace report template and quality standards**

New section:
```markdown
### 6. Write Improvement Report

Write a summary report to:
```
~/.wolfhead_skills/claude-self-improver/YYYY-MM-DD-improvements-report.md
```

Template:
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
| <key> | N | low→medium / unchanged | pending/ready_to_promote |

## Entries Ready for Promotion

| Pattern-Key | Summary | Count | Scope |
|-------------|---------|-------|-------|
| <key> | <one-line text> | N | Global/Project |

## Skill Suggestions (logged only)

| Skill | Suggestion | Source |
|-------|-----------|--------|
| <name> | <suggestion text> | <report filename> |
```

## Quality Standards

- **Append only.** Never modify or delete existing `.learnings/` entries, except to increment Recurrence-Count, update dates, and change Status.
- **Pattern-Key is sacred.** The same finding must always map to the same key. When in doubt, be more specific.
- **No direct CLAUDE.md writes.** This skill only stages to `.learnings/`. Promotion is handled by the self-improving-agent-claude workflow.
- **Conservative.** When in doubt about a Pattern-Key match, create a new entry rather than incorrectly merging.
- **No skill modifications.** Log skill suggestions as `insight` entries with `Status: wont_fix`.
- **Idempotent.** Running twice on the same reports only increments counts on existing entries. No duplicate entries created.
- **Create dirs as needed.** If target `.learnings/` directory doesn't exist, create it with template header.
```

**Step 2: Verify the complete SKILL.md has no references to old behavior**

Run: `grep -n "Backup\|Back up\|CLAUDE\.md and MEMORY\|openclaw-session-analyst" skills/claude-self-improver/SKILL.md`
Expected: No matches (the skill no longer backs up or writes to CLAUDE.md directly).

**Step 3: Commit**

```bash
git add skills/claude-self-improver/SKILL.md
git commit -m "feat(claude-self-improver): rewrite report template and quality standards for .learnings/"
```

---

### Task 7: Final Verification

**Step 1: Read the complete SKILL.md end-to-end**

Run: `cat skills/claude-self-improver/SKILL.md`

Verify:
- Frontmatter mentions `.learnings/`, not CLAUDE.md/MEMORY.md
- No `openclaw-session-analyst` references
- No "Backup" step
- No direct CLAUDE.md write instructions
- Process has 6 steps: Gather → Extract → Deduplicate → Write → Scan → Report
- LRN entry format matches the design doc
- Pattern-Key and Recurrence-Count are documented
- Promotion readiness criteria (>=3, 2+ sessions, 30-day window) are specified
- Quality standards mention Pattern-Key, no direct writes, idempotency

**Step 2: Check for internal consistency**

- Step 2 defines categories (best_practice, correction, knowledge_gap, insight)
- Step 4 maps categories to Suggested Actions — verify they match
- Step 5 promotion criteria reference fields defined in step 4's entry format

**Step 3: Commit if any fixes needed**

```bash
git add skills/claude-self-improver/SKILL.md
git commit -m "fix(claude-self-improver): final verification fixes"
```
