---
name: layered-design
description: >
  Use when a feature, system, or milestone needs design decisions from a human
  decision-maker — before writing an implementation plan, entering plan mode, or
  proposing an architecture. Triggers: "let's discuss the design", "帮我设计",
  a milestone/brief with open design questions, or a design conversation that is
  drifting into one-off Q&A. Use INSTEAD of generic brainstorming skills.
---

# Layered Design Discussion

Core principle: **a design discussion is a sequence of DECISIONS, not a pile of
questions — and only the decisions the current scope actually needs.**
Structure those decisions by dependency, ground each layer in research before
asking anything, present one decision at a time with full context, and verify
the design against concrete cases before closing a layer. Everything the
current scope does NOT need becomes a designed opening (an extension point
with recorded open questions), never a discussion item.

Born from a live failure (2026-08-14, game-design-again): the unstructured
default got corrected three times in one session — questions thrown one at a
time while the rest of the design stayed a black box; three unrelated proposals
bundled into one approval request; a hard-coded special case where an
abstraction was wanted. The method below is what the human kept steering
toward — and its case-check step caught two real design defects the proposals
had missed.

<HARD-GATE>
FORBIDDEN:
- Asking the human any design question before the alignment-point map (step 2)
  exists and has been shown to them
- Asking about a layer before that layer's research round (step 3) is done
- Bundling two decisions into one question — one question = one decision,
  carrying its own full context
- Presenting any component as a black box ("the planner then decides…") —
  show the mechanism: data shapes, tables, worked examples
- Closing a layer without its case check (step 5)
</HARD-GATE>

## Workflow

Copy this checklist and check items off as the discussion proceeds:

- [ ] 1. **Orient in plain language.** Restate what is being designed and what
      already constrains it (prior rulings, existing docs, code reality —
      verify claims against the code, don't trust memory). Confirm shared
      definitions of the core nouns (actors, units, boundaries) BEFORE any
      proposal: a design discussion built on unconfirmed vocabulary collapses
      later. The human has been away from the details — no jargon-first
      openings.
- [ ] 2. **Map the alignment points, filter by "must decide NOW", layer the
      rest by dependency.** Enumerate the open decisions, then sort each into:
      **decide now** (the current scope cannot be built without it) or
      **defer with a designed opening** (an extension point — a reserved
      slot, a registry, a named future home — plus its open questions
      recorded). Only decide-now items enter the layers; the discussion is
      NOT the place to unroll the whole architecture or roadmap. Group the
      decide-now items into layers such that each layer depends only on
      layers before it; settle upstream layers first. Show the map as a
      table (layer | decisions | depends on) WITH the deferred list beside
      it, so the human can promote or demote items. The map is the contract
      for the whole discussion; revisit it when an answer reshapes the
      terrain.
- [ ] 3. **Per layer: research BEFORE questions.** Survey how mature systems
      of the same class solve this problem (games → shipped games; infra →
      production systems; check the project's existing research docs first,
      commission new research only for the gaps). Discipline: [sourced] with
      the source named · [inference] marked as such · NOT FOUND stated
      explicitly, never guessed. Deliver a compact synthesis — the recurring
      patterns and which systems use each — not a link dump.
- [ ] 4. **Present ONE decision at a time, with full context.** For each
      decision: what it decides and what constrains it → the research verdict
      → a CONCRETE proposal (code sketch, data table, worked example the
      human can read) → alternatives as named options with one-line
      trade-offs → a recommendation. Then one question. Label every item
      "needs ruling" vs "for the record" so statements are not mistaken for
      questions. If an answer reveals an upstream misunderstanding, go back
      up the map — do not push forward on a cracked foundation.
- [ ] 5. **Close the layer with a case check.** Build a concrete case list —
      normal paths, transitions/handoffs, casualties/failures, boundaries,
      and (if applicable) both/all actors' perspectives — and walk each case
      through the designed entities and their interactions. Verdict per case:
      ✅ covered · 🔧 covered with a NAMED new rule (name it, fold it into the
      design) · ⛔ model defect (the layer reopens). The layer closes only
      when there is no ⛔ and the human approves the 🔧 additions. Expect this
      step to catch real defects — if every case is ✅ on the first pass, the
      case list is probably too soft.
- [ ] 6. **Record and hand off.** Write decisions to the project's ledger /
      design doc in the same session, marked by who decided. Deferred items
      get an explicit future home AND their open questions recorded as that
      future design's acceptance criteria. An entity with no consumer is not
      designed "for later" — defer it with its questions instead
      (vocabulary-before-consumers is a documented standards failure mode).

## Cross-boundary impacts — neither ignored nor elaborated

Deferring a topic never licenses being blind to it. Whenever a decide-now
decision **materially constrains work outside the current scope**, or
**outside work depends on this decision to be made a certain way**, that
impact MUST be surfaced — but treated at **seam depth**, which is:

1. **Name the dependency or impact** in one or two sentences ("the replay
   module will consume these ops; if ops aren't serializable, replay breaks").
2. **Design the structural closure that absorbs it** — an interface contract,
   a reserved slot, an invariant the neighbor may rely on, a compatibility
   rule. This is part of the CURRENT decision and may change which option
   wins.
3. **Record the neighbor's own open questions at the neighbor's future home**
   — not here.

The depth test: **what crosses the scope boundary is a CONTRACT, not an
implementation.** If you are detailing the neighbor's internals, you went too
deep — pull back to the contract. If the neighbor could be broken or
foreclosed by this decision and nothing was said, you went too shallow —
surface it. Both failure modes are real; the skill's scope discipline governs
how much you DESIGN, never what you are allowed to SEE.

## Red flags — stop and re-enter the workflow

| Thought | Reality |
|---|---|
| "I'll just ask this one quick question first" | Is the map built? Is this question's layer researched? If not, you are doing unstructured Q&A |
| "These three points are related, I'll bundle them" | Related ≠ one decision. Narrow context makes every bundled question harder to judge. Split them |
| "That component's internals are obvious" | Obvious to you. To the human it is a black box — show the table, the sketch, the worked example |
| "The design looks complete; cases are a formality" | The case check caught two real defects in its first live run. Soft case lists are the failure mode |
| "This entity will be needed later, design it now" | No consumer = no design. Record the open questions as future acceptance criteria instead |
| "While we're here, let's also settle this adjacent detail" | If it doesn't block the current scope, it doesn't enter the map — design the OPENING for it (slot, registry row, extension point) and move on. Unrolling the full roadmap in one discussion is scope creep applied to conversations |
| "That's out of scope, skip it" (about a real cross-boundary impact) | Deferring a TOPIC is not ignoring an IMPACT. If a decide-now decision constrains outside work or is depended on by it, surface it at seam depth (see Cross-boundary impacts) — silence here is how deferred modules get broken by today's rulings |
| "Research will slow us down" | One research round per layer is minutes of agent time; an undergrounded decision costs a redesign |
| "Their time is limited, so batch everything into one big accept/change list" | Batched approvals produce shallow decisions on narrow context — the exact failure this skill exists to prevent. What respects a decision-maker's time is one decision at a time, each arriving fully grounded and genuinely decidable |

## Example — the shape of one decision (step 4)

Correct (one decision, full context, concrete):

> **Layer 2, decision 1 of 2 — how squads are assigned to concurrent
> missions.** Background: one army group can hold several missions; v1 assigns
> by capability per tick. Research: Killzone 3 uses quota + sticky repair;
> F.E.A.R. uses slot templates that abort below minimum; StarCraft bots use a
> one-way priority ladder (sources in the survey doc). Proposal: per-verb slot
> predicates + sticky repair, tie-break by id — concretely: `{ attackByFire:
> u => hasVolley(u), … }` [8 more lines of the actual table]. Options: (a)
> sticky repair (recommended — proven at our scale), (b) priority ladder
> (churn-proof but starves low-priority), (c) utility bids (flexible,
> tuning-heavy). Needs ruling: option (a)?

Incorrect (bundled, abstract, black-box):

> A few questions: 1) how should squads be assigned to missions? 2) what
> should happen on casualties? 3) should reactions be toggleable? The
> allocator will handle assignment details internally.

## Relationship to other skills

- Replaces generic brainstorming for design work: brainstorming explores
  intent with unlayered questions and no research grounding; this skill exists
  because that failed with a real decision-maker.
- Research rounds dispatch research subagents with a bounded brief (what
  class of systems to survey, what to extract, the sourced/inference/NOT
  FOUND discipline) — this skill defines WHEN research happens (before each
  layer's questions) and its output discipline, not how to search.
- Output feeds writing-plans / plan mode: the closed layers plus the case
  registry ARE the design; planning starts after, not instead.
