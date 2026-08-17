---
name: think-tank
description: "Use when the user explicitly invokes think-tank or asks for a deep multi-agent discussion to settle a major design or direction decision — e.g. '深入讨论并定型', '开个智囊团', 'convene the think tank', 'panel this decision'. For settling architecture choices, project direction, or high-stakes plans where the user wants deliberation done internally and only decision-grade questions escalated. Not a default replacement for brainstorming on routine feature design."
---

# Think Tank

<HARD-GATE>
- Do NOT take any implementation action until the human approves the final spec.
- Do NOT enter panel deliberation until the big goal is confirmed by the human.
- Do NOT run deep convergence rounds or the devil's advocate until the human has confirmed the direction brief (step 4). Goal confirmation is not direction confirmation.
- Every question to the human MUST be a decision memo (options + analysis + recommendation). Open-ended questions are FORBIDDEN, with two exceptions: clarifying the big goal, and the direction-brief confirmation — both must still offer candidate interpretations / stated assumptions to react to.
- Panel agents MUST run on the session's model tier. Downgrading panel agents to a smaller/cheaper model is FORBIDDEN — a cheap reviewer produces cheap consensus.
</HARD-GATE>

## Overview

The human is the decision-maker, not an information source. A panel of agents deliberates internally — proposing, attacking, converging — and surfaces only decision-grade questions, each packaged as a decision memo with a clear recommendation. The human sets the goal, rules on escalated decisions, and approves the result. Everything else happens inside the panel and is logged for audit.

## Who Decides What

| Question | Decider |
|---|---|
| The big goal / success criteria | Human, always |
| Depends on values only the human holds (budget, taste, risk appetite, business priority) | Human — **even if the panel already agrees** |
| Irreversible or expensive to change later (schema, public API shape, library/platform choice) | Human — **even if the panel already agrees** |
| Panel still split after 3 rounds | Human |
| Everything else | Panel decides; logged in the spec under "Decisions made for you" |

The two "even if the panel agrees" rows exist because same-model agents share blind spots: fast convergence is weak evidence of correctness.

## Process

### 1. Goal gate
Restate the goal and success criteria back to the human. If ambiguous, ask now — with candidate interpretations attached. Deliberation before goal confirmation is wasted tokens.

**Calibrate the human's domain judgment in the same exchange.** Name the domains the topic spans and place the human in one of three registers per domain — expert (full technical detail; can arbitrate panel disputes in this domain), conversant (business framing plus the key technical commitments), delegating (value judgments only). Infer an initial guess from how they talk and confirm it in one line; never quiz — self-assessment is unreliable in both directions. **Calibration is living state, not intake data**: the quality of the human's actual interventions is the ground truth, and it outranks any self-report — revise the register when their corrections show more (or less) depth than assumed. Calibration is per-domain, not a single scalar — the same person is often expert in one involved domain and generalist in another.

What calibration changes and what it never changes:
- It sets the register of decision memos and routes arbitration — an expert human can arbitrate two-touch technical deadlocks in their domain instead of the panel guessing.
- An expert human's technical claims enter the panel as high-weight *evidence*, not unquestionable override — the panel may still verify (experts share blind spots too; that is what the devil's advocate is for). The human can always pull rank explicitly; that is authority, and it needs no expertise.
- It NEVER shrinks the escalation set: value-judgment and irreversibility escalations happen at every expertise level, because authority is not expertise — and low-expertise domains still hold facts nobody else has (business realities routinely surface from "delegating"-register humans). Lower expertise means more scaffolding per question, never fewer questions.

### 2. Context survey
Read the relevant code, docs, and recent history before convening anyone. The panel argues about the real system, not a guess.

**Hunt for prior art before assuming greenfield.** If the code isn't reachable — or the topic sounds like something the organization plausibly already runs — ask directly: "does an existing system/design/doc for this exist, and where?" One question, asked at survey time. (Observed failure: a panel designed a complete bidding system from scratch; the owner later revealed a production system for the same problem plus an already-designed upgrade doc. Much of the deliberation re-derived known ground — the genuinely novel pieces only became visible after reconciliation. "The code isn't in this project" means the code is elsewhere, not that it doesn't exist.)

### 3. Direction round
- **Proposer** drafts a complete solution.
- **Reviewer** (fresh context — do not share the proposer's reasoning, only the proposal itself) reviews once under the Review Contract below. One round is enough to surface the load-bearing structure.
- Scale to stakes: 1 proposer + 1 reviewer by default; add a specialist reviewer only when the topic genuinely spans domains.

### 4. Direction checkpoint (human)
Before any further rounds, present a **direction brief** (self-containment rule applies). **The brief is layered, so it does not depend on calibration being right**: a business-language spine first (what the system IS, operationally, 5–10 bullets), then the technical mainline (formulas, structure) beneath it — the reader picks their depth. Both layers carry:
- **The load-bearing assumptions the design leans on, each phrased as "this design assumes X — is that true?"** Requirement-level assumptions surface and get corrected here; that is the checkpoint's purpose, and it is far cheaper now than after convergence.
- The strongest rejected alternative and why.

The human confirms, corrects, or redirects. A correction here restarts the direction round cheaply; without this checkpoint the human receives a polished spec whose shape they never blessed. (Observed failure: in a live run, two requirement-level corrections — "there is no budget constraint" and "the margin cap was a proxy for delivery commitments" — surfaced only in late escalations, costing full revision rounds; the owner described receiving the finished spec as "opening a blind box.")

### 5. Convergence rounds
- Proposer revises per review; the same reviewer re-reviews with its context intact. Repeat until converged or 3 rounds.
- **Converged means: zero open BLOCKER/MAJOR findings.** Not zero disagreements.

### 6. Devil's advocate
After convergence, one agent gets the consensus and a single goal: break it. Attack the premises the panel stopped questioning, not the details. This pass is mandatory — it is the insurance against shared blind spots. Prefer a different model family here (see Model Policy).

### 7. Escalation triage
Run every settled and unsettled point through the "Who Decides What" table. Hits go to the human; everything else the panel decides and logs.

### 8. Decision memos
For each escalated point, present:
- 2–3 options, each with its analysis and cost
- A clear recommendation and why
- "What new information would change this recommendation"

One memo per decision. Batch independent memos into one message rather than dribbling them out.

**Format follows complexity.** Option-list widgets (AskUserQuestion-style) are for crisp decisions whose options each fit in a sentence. A complex or multi-factor decision gets a prose memo in the message body — the situation first, then each option as a full paragraph, the question last — and the human replies freely. Cramming a tradeoff into option-box labels destroys the self-containment the memo exists to provide.

**Dependency sequencing.** Never ask the human to decide the fate of something relative to a new artifact they have not yet seen or validated ("once the new X lands, should the old Y retire?"). Deliver and validate X first; ask about Y after. A decision contingent on an unseen artifact is unanswerable, and the human is right to bounce it.

**Self-containment rule.** The human has read none of the panel's discussion — every memo must be answerable from the memo alone: what part of the system this decides, and what visibly changes downstream under each choice. **Register follows calibration**: for a domain the human is expert in, lead with the technical form — formulas, precise structure — because experts experience business-gloss-only memos as opacity (they cannot verify what they cannot see); for conversant/delegating domains, open in business language with notation only as supporting detail after the framing. In every register, the self-containment test holds: could the human answer from this memo alone, with zero panel context? (Observed failures, one per direction: a memo asked a business owner to pick budget semantics via the bare dual formula "ṽ=(1−λ)v" — rightly answered "how could I possibly know"; reframed as "when the 100k runs out, which number hit 100k?", instantly answerable. Later, the same owner — an expert in the ad domain — found a business-language-only direction brief too shallow to verify against their own expectations. Both are register miscalibrations, not language failures.)

### 9. Finalize
Write the spec. It MUST contain a **"Decisions made for you"** section — every point the panel self-decided, with one-line rationale each, so the human can veto by scanning instead of participating. Self-review the spec once under the Review Contract (single pass, fix inline, no re-review loop). Then ask the human to approve. On approval, hand off to the normal planning/implementation pipeline (e.g. writing-plans).

## Review Contract

Embed this verbatim in every reviewer dispatch, the devil's-advocate dispatch, and doc self-review. It is what keeps review at the right altitude — do not paraphrase it thinner.

> Tag every finding with a severity, judged by one test — "if this ships as-is, will the final outcome visibly differ for the user?":
> - BLOCKER: a stated goal cannot be met; building on this design wastes the work.
> - MAJOR: outcome safety, quality, or cost visibly degrades.
> - MINOR: real improvement, but the user would not notice the difference.
>
> Rules:
> 1. Your verdict gates ONLY on BLOCKERs and MAJORs. Approve when none remain open — even if MINORs remain.
> 2. MINORs go in a final "Notes (non-blocking)" list, one line each. The proposer applies or ignores them silently; they are never debated and never appear in the must-fix list.
> 3. Identify the load-bearing problem first. If one foundational flaw invalidates or rescopes other findings, say which findings are derivative and compress them to one line each instead of elaborating — a foundational fix will moot them.
> 4. Elaborate at most the 3 highest-leverage blocking findings; every other blocking finding gets at most two lines.
> 5. When unsure between MAJOR and MINOR, apply the outcome test again; if still unsure, it is MINOR.

**Two-touch circuit breaker:** when the same finding has gone proposer→reviewer→proposer→reviewer without resolution, stop debating it. BLOCKER/MAJOR → escalation triage (it is probably a value judgment in disguise). MINOR → proposer decides, disagreement logged, discussion over.

Why a contract instead of "please focus on what matters": tested against a planted-flaw spec, uninstructed reviewers marked 11–16 findings as must-fix — log rotation and wording nits gating approval alongside fatal architecture flaws. With the contract, the same scenario produced ~7 blocking findings, trivia demoted to non-blocking notes, and zero fatal flaws lost. The contract changes the output shape; exhortations do not.

## Model Policy

- All panel roles inherit the session's model. Never downgrade.
- Interleave a frontier model from a **different family** for at least one adversarial role (devil's advocate is the best slot, or an extra spec review). Different families have non-overlapping blind spots. On Claude Code with the codex plugin: dispatch a read-only Codex review at reasoning effort `high` or `xhigh`.

## Harness Notes

- **Claude Code:** spawn panel roles with the Agent tool; keep a reviewer's context across rounds via SendMessage to the same agent. Deliver decision memos through AskUserQuestion, recommended option first.
- **No subagents available:** run the deliberation as explicit role-separated self-debate — label each turn (PROPOSER / REVIEWER / DEVIL'S ADVOCATE) and still obey the Review Contract and round limits. Weaker than fresh-context agents; say so in the spec.

## Red Flags

| Thought | Reality |
|---|---|
| "The panel agrees, no need to bother the human" | Check the table: value-judgment and irreversible decisions escalate even on consensus. |
| "I'll just ask the human, it's quicker" | Only decision memos go to the human. Do the analysis first. |
| "This finding is small but worth one more round" | MINORs are never debated. Log it and move on. |
| "Skip the devil's advocate, the design is clearly solid" | "Clearly solid" is what shared blind spots feel like. Mandatory. |
| "The human confirmed the goal, so the direction is implied" | Goal ≠ direction. Skipping the direction brief hands the human a blind box; requirement corrections arrive late and cost full rounds. |
| "Business language is always the safe choice for the human" | Calibration decides. For a domain expert, hiding the formulas is the blind box again — they cannot verify what they cannot see. |
| "The human has been in this conversation, so my track names / variable names are known context" | They read none of the panel's documents. Panel-invented labels (track letters, config keys, section names) are never shared vocabulary — every memo re-introduces its subject from the business fact up. Expert register changes depth, not context-independence. |
| "Use a cheaper model for the reviewer to save tokens" | Cheap reviewer = cheap consensus. FORBIDDEN. |
