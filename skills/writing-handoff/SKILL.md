---
name: writing-handoff
description: >
  Use when ending a work session that someone (or a future agent) must resume later —
  the user is switching projects, pausing multi-day work, or asks for a handoff /
  session handoff / 交接文档. Also use before context is lost at the end of a long
  agentic effort with pending next steps.
---

# Writing a Project Handoff

A handoff is **executable resume state for a reader with zero conversation memory** — not a
narrative of what happened. The test: could a fresh agent, given only this doc and the repo,
continue the work without asking what anything means?

The companion skill `resuming-from-handoff` consumes this format: every claim you write will be
*verified against reality* at pickup, so write claims that are checkable.

Ending a substantive session? Run `closing-session` first — the handoff should describe
post-triage reality, and surviving uncertainty attaches inline to claims (`UNTESTED:`,
`ASSUMED:`), never as a standalone list.

<HARD-GATE>
FORBIDDEN in a handoff:
- Relative dates ("yesterday", "two days ago", "this morning"). Every date is absolute (YYYY-MM-DD).
- Reconstructed or skeleton commands (`<N>`, `...`, "fill in the path"). Copy the exact command
  verbatim from the session. If a command was never actually run, mark it `UNTESTED:`; an
  unverified assumption gating a next action is marked inline as `ASSUMED: <what> — <why unverified>`.
- Decisions without a date and owner ("we decided..." → "USER decided 2026-07-08: ...").
- Claims with no way to check them. Pair each with its anchor (SHA, path, version, count).
</HARD-GATE>

## Location and naming

`docs/HANDOFF-<topic>.md` in the project repo (or the project's existing docs subdir — follow
repo convention if one exists). Update the existing handoff for the same effort in place rather
than creating siblings; superseded content is replaced, not appended. Commit it.

## Required sections (all of them; mark N/A explicitly rather than omitting)

```markdown
# HANDOFF — <topic> (resume here)
- Last updated: <YYYY-MM-DD>; valid as of this date — verify anything time-sensitive at pickup
- Branch: <branch> @ <SHA> (pushed? y/n) · Test suite: <command> → <N passed>

## Where things stand            ← one paragraph, current state only, no history tour
## Decision log                  ← dated, per-decision owner: "USER decided <date>: <verbatim gist>"
## Next action                   ← THE single next step, with the exact verbatim command(s),
                                   plus its precondition ("needs <date>'s data complete: check via <cmd>")
## Then, in order                ← queue; each item: owner, blocker (who/what), and why it matters
## Key results / evidence        ← numbers table with dates; where artifacts live (exact paths + host)
## Gotchas                       ← traps that cost time this session; each one line, actionable
```

## Rules

- **Absolute everything**: dates, paths (incl. host names for remote state), versions, SHAs.
- **Next action must be gated, not assumed**: if it depends on time/data/another team, state the
  gate and how to check it — the resumer verifies, they don't trust.
- Decisions the user made override anything an older doc or plan says — record them prominently;
  they are the part reality-checks cannot recover.
- Include what was **decided against** (retired questions), so the next session doesn't redo them.
- Length: whatever the content needs, but every line must earn its place — the resumer reads all of it.

## Common mistakes

| Mistake | Fix |
|---|---|
| "decided two days ago" | "USER decided 2026-07-08: ..." |
| Command skeleton with placeholders | Paste the exact command that ran; `UNTESTED:` prefix if it never ran |
| History narrative ("first we tried...") | State only; history lives in git log and result docs |
| Pending action with hidden precondition | Name the gate + the check command |
| New sibling handoff file each session | Update the same file; git history preserves the old versions |
