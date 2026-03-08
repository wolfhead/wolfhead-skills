---
name: research-workflow
description: "Use when the user asks about current technology, tools, APIs, libraries, compatibility, recent changes, or any factual topic where training data may be outdated. Also use when the user explicitly asks to research or investigate something. Forces search-first verification — never guess from training data on verifiable questions."
---

# Research Workflow

<HARD-RULE>
If the question involves current state of technology, tools, APIs, libraries, compatibility, or any factual claim that could have changed since training cutoff — MUST search before answering. No exceptions. Do NOT answer from training data and then offer to search. Search FIRST.
</HARD-RULE>

## When to Search vs Answer Directly

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

## Process

### 1. Scope the Question

Before searching, clarify internally:
- What specific claim needs verification?
- What would a wrong answer look like? (This guides what to check.)

If the question is ambiguous, ask the user one clarifying question before searching.

### 2. Search and Read

**Date anchoring:** ALWAYS include the current year (or month+year) in search queries when recency matters — e.g., "Next.js server actions 2026" not "Next.js server actions". This is the single highest-impact trick for getting relevant results.

**Query strategy:** Run 2-3 web searches with different phrasings to cast a wide net:
- One specific/technical query (e.g., "Next.js 15 server actions breaking changes")
- One broader query (e.g., "Next.js server actions 2026")
- One from a different angle if needed (e.g., "Next.js server actions migration guide")

**Reading sources:** When fetching a page, always ask a focused question — don't dump the whole page into context. Extract only what's relevant to the user's question. Prioritize sources in this order:
1. Official documentation and changelogs
2. GitHub repos (READMEs, issues, releases)
3. Recent blog posts and technical articles
4. Forum threads (Stack Overflow, Reddit, HN)

**Handling fetch failures:** If `web_fetch` returns empty or partial content (common with JS-heavy sites), try:
- The GitHub raw URL instead of the rendered page
- A blog/article discussing the same topic
- An alternative source from search results
- Do NOT treat a failed fetch as "no information exists"

**Parallelism:** For broad or multi-faceted topics, spawn 2-3 parallel subagents — each searching a different angle. Each subagent should search, read, and summarize with relevance judgments.

### 3. Cross-Reference and Answer

- **Sources agree** → State the answer directly with confidence.
- **Sources disagree** → Tell the user. Present both positions. Do not silently pick one.
- **Gaps found** → State what could not be verified. Do not fill gaps with training data.

## Delivery

- Direct and confident when sources agree
- No source URL lists unless user asks or sources conflict
- No "according to my research" preamble
- If conflicts or gaps exist, mention them naturally within the answer

## Anti-Patterns

| Wrong | Right |
|-------|-------|
| Answer from training data, then offer to search | Search first, then answer |
| Search without the current year in query | Include year/month for recency |
| One source is enough | Cross-reference 2-3 sources minimum |
| Silently pick one conflicting source | Tell the user sources disagree |
| Dump a list of URLs | Just give the correct answer |
| "I couldn't find anything" then guess | State the gap, stop there |
| Fetch failed → assume no info exists | Try alternative URLs or sources |
| Fetch entire page with no focus | Ask a specific question when reading |
| Separate "find URLs" and "read URLs" steps | Search and read in one pass |
