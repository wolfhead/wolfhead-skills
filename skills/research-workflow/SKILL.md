---
name: research-workflow
description: "Use when the user asks about current technology, tools, APIs, libraries, compatibility, recent changes, or any factual topic where training data may be outdated or wrong. Also use when the user explicitly asks to research or investigate something. Forces search-first verification with parallel subagent source gathering before answering — never guess from training data on verifiable questions."
---

# Research Workflow

## Overview

Get correct answers by searching and verifying first. Never answer verifiable questions from training data alone. Spawn cheap subagents in parallel to gather from multiple sources, then synthesize with a stronger model.

<HARD-RULE>
If the question involves current state of technology, tools, APIs, libraries, compatibility, or any factual claim that could have changed since training cutoff — MUST search before answering. No exceptions. Do NOT answer from training data and then offer to search. Search FIRST.
</HARD-RULE>

## Decision: Search or Answer Directly?

```
User asks a question
  ├── About current tech/tools/APIs/compatibility? → SEARCH FIRST
  ├── "Does X support Y?" → SEARCH FIRST
  ├── About recent changes/releases? → SEARCH FIRST
  ├── User says "research this" or "look into this"? → SEARCH FIRST
  ├── Pure logic/math/reasoning? → Answer directly
  ├── Stable concepts (e.g., "what is a linked list")? → Answer directly
  └── Creative/opinion questions? → Answer directly
```

When in doubt, search. The cost of an unnecessary search is low. The cost of a confident wrong answer is high.

## The Pattern

### 1. Scope

Before spawning subagents, clarify internally:
- What specific claim needs verification?
- What would a wrong answer look like? (This guides what to check.)
- Single fact or multiple pieces of information?

If the question is ambiguous, ask the user one clarifying question before searching.

### 2. Fan Out — Parallel Subagent Research

Spawn 2-4 subagents using cheap models (DeepSeek, Haiku). Each targets a different source type:

| Subagent | Focus | What to search |
|----------|-------|----------------|
| A | Official sources | Project docs, changelogs, release notes, official blogs |
| B | Code & repos | GitHub repos, issues, discussions, pull requests |
| C | Community | Forums, blog posts, Stack Overflow, Reddit, Dev.to |
| D | (Complex topics only) | Code samples, implementations, tutorials |

**Subagent instructions template:**

```
Search for: [specific question]
Focus on: [source type]
Return: Raw facts only. No conclusions or opinions.
Include: Where each fact came from (so I can cross-reference).
If nothing relevant found: Say so explicitly. Do not guess.
```

Scale subagent count to complexity:
- Simple factual check (e.g., "does X support Y?") → 2 subagents
- Multi-faceted topic (e.g., "how does X compare to Y?") → 3-4 subagents

### 3. Synthesize

Cross-reference all subagent findings with the stronger model:

- **Sources agree** → High confidence. State the answer directly.
- **Sources disagree** → Tell the user. Present both positions. Do not silently pick one.
- **Gaps found** → State what could not be verified. Do not fill gaps with training data.

### 4. Deliver

Give the answer:
- Direct and confident when sources agree
- No source URL lists unless user asks or sources conflict
- No "according to my research" preamble
- No academic formatting
- If conflicts or gaps exist, mention them naturally within the answer

## Anti-Patterns

| Wrong | Right |
|-------|-------|
| Answer from training data, then offer to search | Search first, then answer |
| "Based on my knowledge..." | Verify, then state as fact |
| One source is enough | Cross-reference 2-3 sources minimum |
| Silently pick one conflicting source | Tell the user sources disagree |
| Dump a list of URLs | Just give the correct answer |
| "I couldn't find anything" then guess from training data | State the gap, stop there |
| Spawn subagents that draw conclusions | Subagents return raw facts only |

## Example

**User:** "Are OpenClaw skills compatible with Claude Code?"

**Wrong approach:**
> "No, they use different runtimes and formats. You'd need to port skills manually."

(Confident, wrong — answered from stale training data without checking.)

**Right approach:**
1. Scope: Need to verify current cross-compatibility between OpenClaw SKILL.md and Claude Code
2. Spawn 2 subagents — one searches official docs/repos, one searches community posts
3. Findings: acpx supports pasting skills into any ACP harness; SKILL.md format works across platforms because skills are instructions, not executable code
4. Answer: "Yes — skills in SKILL.md format work across OpenClaw, Claude Code, and other ACP harnesses. They're markdown instructions that agents adapt to their runtime, so the same skill file works on multiple platforms."
