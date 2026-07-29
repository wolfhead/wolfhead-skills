---
name: resuming-from-handoff
description: >
  Use when starting or resuming work on a project after time away — the user says
  continue / pick up / resume / 接着上次, a HANDOFF doc exists in the repo, or you are
  the first session after another session's handoff.
---

# Resuming From a Handoff

Core principle: **a handoff is a hypothesis about the world, written in the past. Time has
passed. Verify it against reality before acting on it.** Docs go stale silently — commits land
after they're written, artifacts move, gates open or close, decisions get made in conversations
the doc never saw.

<HARD-GATE>
FORBIDDEN before the verification pass is complete and reported:
- Executing the handoff's "next action" commands
- Any training run, deployment, publish, or other expensive/irreversible operation
- Re-doing work the verification shows already completed

"The handoff says exactly what to do" is precisely why you verify — it says what to do
*as of when it was written*.
</HARD-GATE>

## Workflow

Copy this checklist and check items off:

- [ ] 1. **Locate** the newest handoff: `ls docs/HANDOFF-*.md docs/**/HANDOFF-*.md HANDOFF*.md`
      (pick by the doc's own "Last updated" date; `git log -1 -- <file>` as tiebreaker).
- [ ] 2. **Extract its claims** — branch/SHA anchors, artifact paths (+hosts), pending actions and
      their gates, dated decisions, "valid as of" date.
- [ ] 3. **Verify every checkable claim against reality:**
      - `git log <claimed-SHA>..HEAD` — commits AFTER the handoff? Read them; they may complete or
        invalidate the doc's next action. Check commit messages *and* new/changed result docs.
      - Anchors: branch exists/pushed, test suite count, claimed artifact paths (ssh to the named
        host if remote), running processes/containers the doc implies.
      - Gates: the next action's precondition (data complete? date passed? blocker answered?) —
        run the doc's own check command; don't assume time fixed it.
      - Dates: how old is the doc? Everything time-sensitive ages; a "pending" older than a day
        is a claim to verify, not a fact.
- [ ] 4. **Report the diff before acting** — three buckets, one line each:
      `CONFIRMED:` claims that held · `STALE:` claims reality contradicts (with evidence) ·
      `UNVERIFIABLE:` claims you cannot check from here (say what access would settle them).
      Then state the (possibly amended) resume plan. If anything STALE or UNVERIFIABLE touches
      the next action, get the user's confirmation before executing; if all checks pass, proceed.
- [ ] 5. **Resume** — and if the handoff was stale, update it (or the ledger) so the next reader
      inherits reality, not the old hypothesis.

## Red flags — stop and verify first

| Rationalization | Reality |
|---|---|
| "The handoff is only a day old" | One day = one production retrain, one data backfill, one decision |
| "User said continue quickly" | Verification is minutes; re-running finished work is hours |
| "git log looks clean" | Git can't see remote artifacts, running jobs, or conversation decisions — check the doc's non-git anchors too |
| "The doc's author was thorough" | Thorough then ≠ true now; staleness isn't an authorship flaw |

## Common mistakes

- Verifying only git and skipping remote/host claims (the doc names hosts for a reason).
- Silently fixing a stale next action without reporting the discrepancy — the user may know
  context you don't about *why* reality diverged.
- Reading the entire repo instead of the handoff + targeted verification (the doc exists to
  spare you that).
