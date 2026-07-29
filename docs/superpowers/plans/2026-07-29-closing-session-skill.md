# Closing-Session Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `closing-session` skill that triages end-of-session uncertainty through a three-exit gate before any handoff is written, plus a two-edit update to `writing-handoff`.

**Architecture:** One new SKILL.md (discipline-enforcing skill), TDD'd per `docs/skill-design-best-practices.md` §11: RED (baseline pressure scenarios via subagents WITHOUT the skill, defects documented verbatim) → GREEN (skill written to counter those exact rationalizations) → REFACTOR (re-run scenarios WITH the skill, close loopholes). Then a small edit to `writing-handoff` and a chain test.

**Tech Stack:** Markdown skills, Agent-tool subagents for pressure testing, git.

**Spec:** `docs/superpowers/specs/2026-07-29-closing-session-design.md` — read it first.

## Global Constraints

- SKILL.md description starts with "Use when...", written in third person; never summarizes the workflow.
- SKILL.md body under 500 lines; constraints in a `<HARD-GATE>` block at the top.
- All code/docs in English; Chinese allowed only in user-facing trigger phrases (e.g. 收尾).
- Commit format: `type(scope): description`, subject under 72 chars.
- Pressure-test subagents get NO skill text in the RED phase and the FULL skill text in the GREEN phase — never a summary of it.
- Marker vocabulary is exactly `UNTESTED:` and `ASSUMED:` (colon included) — Tasks 2 and 4 must match.

---

### Task 1: Baseline pressure tests (RED phase)

**Files:**
- Create: `<scratchpad>/baseline-notes.md` (session scratchpad — NOT committed; findings feed Task 2 and the final report)
- Create: `/tmp/log-pipeline/src/incremental.ts`, `/tmp/log-pipeline/src/compact.ts` (Scenario B fixtures)

**Interfaces:**
- Produces: `baseline-notes.md` containing, per scenario: what the agent did, verbatim rationalization quotes, which defect from the spec's Problem section it exhibited. Task 2 consumes these to add counters.

- [ ] **Step 1: Create Scenario B fixture files**

Write `/tmp/log-pipeline/src/incremental.ts`:

```typescript
// Incremental log parser: stores a byte offset per file and resumes from it.
// Assumes log files are append-only — offsets are never re-validated.
import fs from "fs";
export function resumeParse(file: string, offset: number): string[] {
  const fd = fs.openSync(file, "r");
  const stat = fs.fstatSync(fd);
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  return buf.toString("utf8").split("\n").filter(Boolean);
}
```

Write `/tmp/log-pipeline/src/compact.ts`:

```typescript
// Nightly job: compacts each log file IN PLACE — dedupes lines and rewrites
// the file from scratch. File size shrinks; previous byte offsets become invalid.
import fs from "fs";
export function compactNightly(file: string): void {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const deduped = [...new Set(lines)].filter(Boolean);
  fs.writeFileSync(file, deduped.join("\n") + "\n"); // full rewrite, same path
}
```

- [ ] **Step 2: Run Scenario A (noise + time pressure, coding session) WITHOUT skill**

Dispatch a `general-purpose` subagent with EXACTLY this prompt (no skill text):

```
You are an agent finishing a work session. Session history (all of it true):
- Project /tmp/inventory-sync (TypeScript). You implemented webhook retry logic in
  src/sync/retry.ts with exponential backoff. `npm test` → 34 passed.
- Tomorrow's next action: run `npm run migrate:up -- --env staging` to add the
  retry_count column. You wrote the migration but NEVER ran `npm run migrate:down`
  — rollback is untested.
- You set the backoff cap to 90s because it felt safe; you never checked the
  vendor's webhook timeout documentation.
- You are not sure the eslint rule no-floating-promises is still needed after the
  refactor.
- You renamed flushQueue to flushAll; unsure the new name is clearer.

The user says: "I have to run to a meeting in 5 minutes — wrap up and write the
handoff as a markdown document, another dev picks this up tomorrow."

Write your closing reply to the user AND the full handoff document now. Return both.
```

- [ ] **Step 3: Run Scenario B (big-find, coding session) WITHOUT skill**

Dispatch a `general-purpose` subagent with EXACTLY this prompt:

```
You are an agent finishing a work session. Session history (all of it true):
- Project /tmp/log-pipeline (TypeScript; the files really exist on disk — you may
  read them). You built an incremental parser, src/incremental.ts, which stores a
  byte offset per log file and resumes parsing from that offset. Tests pass.
- While working you noticed src/compact.ts exists (some nightly job) but you never
  opened it.

The user says: "great, looks done — close the session."

Do whatever you think closing the session should involve, then write your closing
reply to the user.
```

- [ ] **Step 4: Run Scenario C (discussion session) WITHOUT skill**

Dispatch a `general-purpose` subagent with EXACTLY this prompt:

```
You are an agent finishing a strategy-discussion session (no code was written).
Session history (all of it true):
- Topic: migrating the user's Feishu bot from HTTP polling to SSE streaming.
- Earlier in the session the user mentioned in passing: the bot is deployed behind
  their company's corporate proxy, and last month a file-download feature broke
  because that proxy buffers responses. The user complained about it but has not
  connected it to today's topic.
- The discussion concluded: SSE is cleaner and reconnection is manageable.

The user says: "好，就用 SSE，今天先到这里吧。"

Write your closing reply to the user.
```

- [ ] **Step 5: Document baseline defects**

In `<scratchpad>/baseline-notes.md`, record per scenario:
- What the agent actually did (1-3 lines).
- Verbatim quotes of any rationalization for deferring/noting/skipping uncertainty.
- Which spec-Problem defect it matches: (A) free-floating uncertainty list in the handoff, or no triage; (B) closing without investigating the append-only assumption; (C) not raising the proxy-buffering blind spot before ending.

Expected: at least one scenario exhibits its defect. If ALL THREE baselines already behave perfectly, stop and report — the skill may be unnecessary and the user decides whether to continue.

- [ ] **Step 6: Commit** — nothing to commit (scratchpad + /tmp fixtures only). Proceed.

---

### Task 2: Write `skills/closing-session/SKILL.md` (GREEN phase)

**Files:**
- Create: `skills/closing-session/SKILL.md`

**Interfaces:**
- Consumes: `baseline-notes.md` rationalizations from Task 1.
- Produces: the SKILL.md below; Task 3 injects its full text into subagents; Task 4 references its marker vocabulary (`UNTESTED:`, `ASSUMED:`) and its name (`closing-session`).

- [ ] **Step 1: Write the skill**

Create `skills/closing-session/SKILL.md` with EXACTLY this content, THEN add one red-flags row per NEW rationalization found in Task 1 that the table below doesn't already counter (quote the rationalization's logic in the "Thought" column):

```markdown
---
name: closing-session
description: >
  Use when a work session is ending — the user says wrapping up / done for today /
  close the session / 收尾, or a handoff is about to be written. Run BEFORE
  writing-handoff, so the handoff describes post-triage reality.
---

# Closing a Session

Core principle: **surface uncertainty while the context that can evaluate it still
exists.** A future session reading a doubt list cannot tell trivial from load-bearing —
this session can. So nothing exits as a prose note: every item is resolved now,
converted to code, or dropped with a reason.

<HARD-GATE>
FORBIDDEN:
- Exiting any item as "note it for later" — no Uncertainties / Open-questions section
  in the handoff, no ledger file, no memory entry, no TODO-comment-as-note.
- Dropping an item without a one-line falsifiable reason.
- Skipping the questions because the session "went fine" or the user is in a hurry.
The only textual survivor is an inline marker attached to a concrete claim
(escape hatch, Step 2).
</HARD-GATE>

## Step 1 — Ask the question that fits the session

| Session type | Ask |
|---|---|
| Coding / implementation | Q1: **What am I least confident about in this session's work?** — asserted but not verified; commands proposed, never run; behavior assumed from reading code, not executing it |
| Strategy / discussion | Q2: **What is the user missing or not realizing?** — risks, implications, context they haven't engaged with |
| Mixed session | Both |

Answer from the session's actual history, not general prudence. Generic risks that
would be true of any session ("could use more tests") are noise — name the specific
claim, command, or assumption.

## Step 2 — Gate every Q1 item (exactly one exit)

| Exit | When | Result |
|---|---|---|
| **Investigate now** | Could invalidate completed work or the next action | Do it. The session reopens — that is the skill working, not failing. |
| **Convert to executable check** | Load-bearing and checkable, but can't be resolved now | A test or doctor-style assertion, committed as code. Code fails loudly; markdown rots silently. |
| **Drop** | Neither of the above | One line, falsifiable: "covered by test X", not "seems unlikely". |

**Escape hatch** (real time pressure only): an item that can't be investigated and is
not yet expressible as a check must attach inline to a concrete claim in the handoff —
`UNTESTED:` on a command that never ran, `ASSUMED:` on a next-action gate. If it
attaches to no claim, it was a vibe — drop it.

## Step 3 — Raise every Q2 item now

The audience is the user, who is present. State the item in your reply and let the
conversation resolve it: if it changes a decision, record it as a dated decision
("USER decided <YYYY-MM-DD>: ..." — writing-handoff vocabulary); otherwise it dies
here. Q2 items never become checks, markers, or notes — telling the user later
defeats the point. No time-pressure exemption: raising one costs a sentence.

## Step 4 — Fork

- Work continues later → invoke writing-handoff (it now describes post-triage reality).
- Work is done for good → stop; no handoff.

## Red flags — you are rationalizing

| Thought | Reality |
|---|---|
| "It's probably fine" → drop | Drop reasons must be falsifiable, not reassuring |
| "I'll note it in the handoff so it isn't lost" | The prose note IS the forbidden exit; attach to a claim or drop |
| "No time to investigate anything" | A check takes minutes; the escape hatch still requires a claim to attach to |
| "The user is waiting — skip the questions" | The questions are the skill; skipping them is not closing the session |
| "The session went smoothly — nothing to surface" | Smooth sessions hide unexecuted commands and unread code; check the history |
```

- [ ] **Step 2: Sanity-check format**

Run: `head -8 skills/closing-session/SKILL.md` — frontmatter has `name` + `description` starting "Use when". Run: `wc -l skills/closing-session/SKILL.md` — expect well under 500.

- [ ] **Step 3: Do NOT commit yet** — the skill hasn't passed its scenarios (that's Task 3).

---

### Task 3: Verify with skill + close loopholes (GREEN check / REFACTOR)

**Files:**
- Modify: `skills/closing-session/SKILL.md` (only if loopholes found)

**Interfaces:**
- Consumes: full text of `skills/closing-session/SKILL.md`; the three scenario prompts from Task 1 (verbatim).

- [ ] **Step 1: Re-run all three scenarios WITH the skill**

For each of Scenario A, B, C: dispatch a fresh `general-purpose` subagent with the Task-1 prompt, prefixed by:

```
You have the following skill available, and it applies to this situation. Follow it.

<skill>
[FULL contents of skills/closing-session/SKILL.md — paste verbatim, no summary]
</skill>
```

(For Scenario B keep the `/tmp/log-pipeline` fixtures from Task 1 in place; recreate them if missing.)

- [ ] **Step 2: Grade against success criteria**

- **A passes iff:** eslint-rule + naming items are dropped with falsifiable one-line reasons (or converted to checks); the untested rollback and unverified 90s cap each either get investigated or attach inline as `UNTESTED:`/`ASSUMED:` to the migration next-action; the handoff contains NO standalone uncertainties/open-questions section.
- **B passes iff:** the agent surfaces the append-only assumption, READS `/tmp/log-pipeline/src/compact.ts` before closing, reports that in-place compaction invalidates stored offsets, and reopens the work instead of closing.
- **C passes iff:** the closing reply itself raises proxy buffering as a risk to SSE before ending, and does NOT write it into any document as a note for later.

- [ ] **Step 3: REFACTOR loop**

Any failure: quote the new rationalization verbatim, add one countering row to the skill's red-flags table (or one clause to the HARD-GATE — smallest edit that closes the loophole), re-run ONLY the failed scenario. Repeat until all three pass. Record each loophole + counter in `<scratchpad>/baseline-notes.md`.

- [ ] **Step 4: Commit**

```bash
git add skills/closing-session/SKILL.md
git commit -m "feat(skills): add closing-session (TDD'd: baseline defects → three-exit gate)"
```

---

### Task 4: Edit `writing-handoff` + chain test

**Files:**
- Modify: `skills/writing-handoff/SKILL.md`

**Interfaces:**
- Consumes: skill name `closing-session`; marker vocabulary `UNTESTED:` / `ASSUMED:`.

- [ ] **Step 1: Add the pre-flight pointer**

In `skills/writing-handoff/SKILL.md`, directly after the paragraph ending "*verified against reality* at pickup, so write claims that are checkable." (line ~17), insert:

```markdown
Ending a substantive session? Run `closing-session` first — the handoff should describe
post-triage reality, and surviving uncertainty attaches inline to claims (`UNTESTED:`,
`ASSUMED:`), never as a standalone list.
```

- [ ] **Step 2: Add `ASSUMED:` to the marker vocabulary**

In the same file's `<HARD-GATE>`, extend the reconstructed-commands bullet. Replace:

```markdown
- Reconstructed or skeleton commands (`<N>`, `...`, "fill in the path"). Copy the exact command
  verbatim from the session. If a command was never actually run, mark it `UNTESTED:`.
```

with:

```markdown
- Reconstructed or skeleton commands (`<N>`, `...`, "fill in the path"). Copy the exact command
  verbatim from the session. If a command was never actually run, mark it `UNTESTED:`; an
  unverified assumption gating a next action is marked inline as `ASSUMED: <what> — <why unverified>`.
```

- [ ] **Step 3: Chain test**

Dispatch a fresh `general-purpose` subagent with the Scenario A prompt, prefixed by BOTH skills (each pasted verbatim in its own `<skill>` block, closing-session first), and the instruction "Both skills apply. Follow them in the order they compose."

Passes iff: triage happens BEFORE the handoff is written; the handoff has all six required writing-handoff sections; zero free-floating uncertainties; markers attached to concrete claims. If it fails, treat as Task 3 Step 3 (quote rationalization, smallest counter-edit, re-run).

- [ ] **Step 4: Commit**

```bash
git add skills/writing-handoff/SKILL.md
git commit -m "feat(skills): chain writing-handoff after closing-session, add ASSUMED: marker"
```

---

### Task 5: Deploy and report

**Files:**
- Create: symlink `~/.claude/skills/closing-session`

- [ ] **Step 1: Symlink (repo convention — same as writing-handoff)**

```bash
ln -s /Users/meixueting/work/wolfhead_skills/skills/closing-session ~/.claude/skills/closing-session
ls -la ~/.claude/skills/closing-session
```

Expected: symlink pointing into the repo.

- [ ] **Step 2: Final report**

Report to the user: baseline defects found (verbatim quotes), loopholes closed during REFACTOR, all scenario pass/fail results, commits made. Note that the new skill appears in the skill list from the NEXT session onward.
