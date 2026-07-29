# Closing Session — Design Spec

## Overview

A skill that runs at the end of a work session, before any handoff is written. It asks two
uncertainty-surfacing questions, then forces every surfaced item through a three-exit gate —
**investigate now**, **convert to executable check**, or **drop with reason** — so that no
free-floating uncertainty list ever reaches a future session.

Chained workflow: `closing-session` → (if work continues later) `writing-handoff`.

## Problem

Ending a session by asking the model "what are you least confident about?" reliably surfaces
6–7 items, and roughly 1 in 4 sessions one of them is a real defect worth reopening the session
for. But persisting that raw list into a handoff is harmful:

1. `resuming-from-handoff` treats **every** handoff line as a claim to verify before acting
   (its HARD-GATE). A list of minor uncertainties stalls the next action behind trivia — the
   resumer has no conversation memory and cannot tell trivial from load-bearing.
2. Model self-report of uncertainty is partly confabulated — it reconstructs plausible doubts
   rather than reading a verification log. The list is noisy at generation time.
3. Uncertainty lists in prose are stale anchors: they bias future sessions toward a frozen
   snapshot and rot silently.

The fix: capture the value **in-session** (where the context that can evaluate each item still
exists) and let nothing exit as prose.

## Design

### New skill: `skills/closing-session/SKILL.md`

**Description (trigger):** Use when a work session is ending — the user says wrapping up /
done for today / 收尾 / close the session, or a handoff is about to be written. Runs BEFORE
`writing-handoff`.

**Ordering rationale:** triage first, handoff second — the handoff then describes post-triage
reality. Handoff-first would be staled immediately by the triage.

### Step 1 — Select the question by session type

The question depends on what the session was about; ask only what applies:

| Session type | Question | Where the blind spot lives |
|---|---|---|
| Coding / implementation | Q1: **"What am I (the agent) least confident about in this session's work?"** — things asserted but not verified, commands proposed but never run, behavior assumed from reading code rather than executing it | The agent's actions |
| Strategy / planning / discussion | Q2: **"What is the user missing or not realizing about the situation?"** — risks, implications, or context the user hasn't engaged with | The user's mental model |
| Mixed session | Both | Both |

Answer honestly, from the session's actual history. V1 is self-report only. Transcript mining
(scanning the session for hedge markers and never-executed commands, e.g. as a `siv` feature)
is a future upgrade, out of scope here.

### Step 2 — Three-exit gate (HARD-GATE)

**Q1 items (work uncertainty)** MUST take exactly one exit:

| Exit | When | Result |
|------|------|--------|
| **Investigate now** | Item could invalidate completed work or the next action | Session reopens; do the investigation while context exists. Finding the 1-in-4 big one is the skill working, not failing. |
| **Convert to executable check** | Load-bearing, checkable, but can't be resolved now | A test or doctor-style assertion committed as code. Code fails loudly; markdown rots silently. |
| **Drop** | Neither of the above | One-line **falsifiable** reason ("covered by test X passing", not "seems unlikely"). |

**Q2 items (user blind spots)** have a different audience — the user, who is present right
now. Their only exit is **raise it now**: state the item and let the conversation resolve it.
A survivor is one that changes a decision → recorded as a dated decision (`USER decided
<date>: ...` — existing `writing-handoff` vocabulary) in the decision log or spec. Everything
else dies in the conversation. Q2 items never become checks, markers, or notes — telling the
user later defeats the point of telling them.

**FORBIDDEN:** exiting as "note it for later" in prose. No **free-floating** uncertainty list
survives as text — not in the handoff, not in a ledger file, not in memory. (The only textual
survivor is an inline marker attached to a concrete claim — Step 3.)

### Step 3 — Escape hatch (Q1 items, real time pressure only)

Q2 items get no escape hatch — raising one takes a sentence, so time pressure never justifies
deferring it. For Q1: if the user must leave now and an item can't be investigated and isn't
yet expressible as a check: it must **attach to a specific claim** in the handoff, inline —

- `UNTESTED:` on a command that was never run (existing `writing-handoff` vocabulary)
- `ASSUMED:` on a next-action gate ("ASSUMED: migration is reversible — never tested
  `migrate:down`")

If an item cannot attach to any concrete claim, that is the tell it was a vibe → drop.
Inline markers ride claims `resuming-from-handoff` already verifies. But `ASSUMED:` items
have no check command, so they land in that skill's `UNVERIFIABLE:` bucket — its Step 4 is
hardened so an `UNVERIFIABLE:` item touching the next action also requires user confirmation,
not just `STALE:` ones.

### Step 4 — Fork

- Work continues later → invoke `writing-handoff` (now describing post-triage state).
- Work is done for good → stop; no handoff.

### Red flags table (in SKILL.md)

The gate creates pressure to rationalize dropping. Counterweights, at minimum:

| Rationalization | Reality |
|---|---|
| "It's probably fine" → drop | Drop reasons must be falsifiable, not reassuring |
| "I'll note it in the handoff so we don't lose it" | Prose notes are the forbidden exit; attach to a claim or drop |
| "No time to investigate anything" | Converting to a check takes minutes; the escape hatch needs a claim to attach to |
| "The user is waiting, skip the questions" | The questions are the skill; skipping them is not closing the session |

## Changes to `writing-handoff`

Two lines only:

1. Pre-flight pointer near the top: "Ending a substantive session? Run `closing-session`
   first — the handoff should describe post-triage reality."
2. Add `ASSUMED:` alongside the existing `UNTESTED:` marker vocabulary (inline, attached to a
   gate or claim; never a standalone list).

## Non-goals

- **No standalone contract/invariants/assumptions file per project** — considered and
  rejected: markdown ledgers rot; surviving assumptions live as executable checks instead.
- **Minimal change to `resuming-from-handoff`** — inline markers attach to claims it already
  verifies; the only addition is Step 4 treating `UNVERIFIABLE:` items that touch the next
  action the same as `STALE:` ones, since `ASSUMED:` markers have no check command and would
  otherwise fall through ungated.
- **No transcript mining in V1** — future `siv` feature.
- **No fresh-instance/subagent review in V1** — heavier pattern, possible later composition.

## Testing

Per `docs/skill-design-best-practices.md`: pressure-test before shipping. Baseline scenarios:

1. **Noise pressure:** session with many trivial uncertainties — does the gate drop them with
   falsifiable reasons instead of letting them leak into the handoff?
2. **Time pressure:** "I have to leave right now" — does the escape hatch attach items to
   claims rather than emitting a prose list?
3. **Big-find scenario:** an item that invalidates the session's work — does the skill reopen
   the session rather than filing it away?
4. **Chain test:** full `closing-session` → `writing-handoff` run — does the handoff contain
   zero free-floating uncertainties?
5. **Session-type test:** a pure discussion/planning session — does the skill ask Q2 (not Q1),
   raise items in-conversation, and record survivors as dated decisions rather than checks?
