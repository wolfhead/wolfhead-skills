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
| "I'll give it an owner and call it a follow-up task, not an open question" | An owner label and a "Blocker:" line don't convert doubt into a check — if no test or assertion was written AND no inline marker was attached, it's the forbidden note wearing a work-queue costume |
| "No time to investigate anything" | A check takes minutes; the escape hatch still requires a claim to attach to |
| "The user is waiting — skip the questions" | The questions are the skill; skipping them is not closing the session |
| "The session went smoothly — nothing to surface" | Smooth sessions hide unexecuted commands and unread code; check the history |
