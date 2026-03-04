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

### 2. Scout — Discover Sources

Spawn one scout subagent (cheap model) to find the right sources for this topic. The scout does NOT extract information — it only identifies where to look.

**Scout instructions:**

```
Topic: [the question]
Task: Find 3-6 specific sources relevant to this topic.
For each source, return:
  - URL or identifier (e.g., GitHub repo URL, docs page URL, specific forum thread)
  - What type of source it is (official docs, GitHub repo, blog post, forum thread)
  - Why it's likely relevant
Do NOT read or summarize the sources. Just find them.
```

The scout searches broadly (web search, GitHub search) so that the extraction subagents don't have to.

### 3. Extract — Targeted Subagents Per Source

Take the scout's source list and spawn one subagent per source (cheap model, in parallel). Each subagent gets a specific URL or location and a specific question to answer from that source.

**Extraction subagent instructions:**

```
Source: [specific URL or location from scout]
Question: [what to extract from this source]
Task: Read this specific source and extract facts relevant to the question.
Return: Raw facts only. No conclusions or opinions.
If the source is inaccessible or irrelevant: Say so. Do not guess.
```

Every extraction subagent has a guided, specific job:
- A specific source to read (not "search the web")
- A specific question to answer from that source
- No freedom to wander or draw conclusions

Scale to the scout's findings:
- Scout found 2-3 good sources → 2-3 extraction subagents
- Scout found 5-6 sources → pick the 3-4 most relevant, skip the rest

### 4. Synthesize

Cross-reference all extraction subagent findings with the stronger model:

- **Sources agree** → High confidence. State the answer directly.
- **Sources disagree** → Tell the user. Present both positions. Do not silently pick one.
- **Gaps found** → State what could not be verified. Do not fill gaps with training data.

### 5. Deliver

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
| Subagents do broad unfocused searching | Scout finds sources, extractors read specific URLs |
| Subagents draw conclusions | Subagents return raw facts only |

## Example

**User:** "Are OpenClaw skills compatible with Claude Code?"

**Wrong approach:**
> "No, they use different runtimes and formats. You'd need to port skills manually."

(Confident, wrong — answered from stale training data without checking.)

**Right approach:**

1. **Scope:** Need to verify current cross-compatibility between OpenClaw SKILL.md and Claude Code

2. **Scout:** Spawn scout subagent → finds sources:
   - `https://github.com/openclaw/openclaw` (official repo)
   - `https://github.com/anthropics/claude-code` (Claude Code docs)
   - `https://github.com/jdrhyne/agent-skills` (cross-agent skills project)
   - A blog post comparing the two platforms

3. **Extract:** Spawn 3 targeted subagents:
   - Subagent A → read OpenClaw repo for skill format docs
   - Subagent B → read Claude Code docs for skill loading mechanism
   - Subagent C → read agent-skills repo for cross-compatibility evidence

4. **Synthesize:** All three confirm SKILL.md works across platforms — skills are instructions, not executable code

5. **Answer:** "Yes — skills in SKILL.md format work across OpenClaw, Claude Code, and other ACP harnesses. They're markdown instructions that agents adapt to their runtime, so the same skill file works on multiple platforms."
