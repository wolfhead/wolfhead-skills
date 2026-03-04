# Wolfhead Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up the wolfhead_skills project and create the first skill (research-workflow) that forces agents to search and verify before answering.

**Architecture:** A flat `skills/` directory containing skill folders, each with a `SKILL.md`. The research-workflow skill instructs agents to spawn cheap subagents for parallel source gathering, then synthesize findings with a stronger model.

**Tech Stack:** Markdown (SKILL.md format), OpenClaw-native conventions

---

### Task 1: Create README.md

**Files:**
- Create: `README.md`

**Step 1: Write README**

```markdown
# Wolfhead Skills

A collection of AI agent skills for OpenClaw, Claude Code, and other ACP-compatible harnesses.

Skills are markdown-based instructions (SKILL.md) that agents read and adapt to their environment. They work across platforms because they're guidance, not executable code.

## Installation

### OpenClaw
Copy or symlink the `skills/` directory into your workspace:
```bash
cp -r skills/* ~/.openclaw/skills/
```

Or add this repo as an extra skills directory in `~/.openclaw/openclaw.json`:
```json
{
  "skills": {
    "load": {
      "extraDirs": ["/path/to/wolfhead_skills/skills"]
    }
  }
}
```

### Claude Code
Copy skill folders into `.claude/skills/` in your project or `~/.claude/skills/` globally.

## Available Skills

| Skill | Description |
|-------|-------------|
| [research-workflow](skills/research-workflow/) | Search-first research with parallel subagent source gathering |

## Adding New Skills

Create a folder under `skills/` with a `SKILL.md`:

```
skills/my-skill/
  SKILL.md
```

The `SKILL.md` must have YAML frontmatter with `name` and `description` fields.

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add project README with installation and usage instructions"
```

---

### Task 2: Create LICENSE file

**Files:**
- Create: `LICENSE`

**Step 1: Write MIT license**

Standard MIT license text with copyright holder "Wolfhead" and year 2026.

**Step 2: Commit**

```bash
git add LICENSE
git commit -m "docs: add MIT license"
```

---

### Task 3: Create research-workflow SKILL.md

**Files:**
- Create: `skills/research-workflow/SKILL.md`

**Step 1: Write the skill file**

```markdown
---
name: research-workflow
description: Use when the user asks a question about current technology, tools, APIs, or any topic where training data may be outdated. Forces search-first verification with parallel subagent research before answering.
---

# Research Workflow

## Overview

Get correct answers by searching and verifying first. Never answer verifiable questions from training data alone.

<HARD-RULE>
If the question involves current state of technology, tools, APIs, libraries, compatibility, or any factual claim that could have changed since your training cutoff — you MUST search before answering. No exceptions.
</HARD-RULE>

## When to Use

- User asks about a tool, library, or API's current behavior
- User asks "does X support Y" or "is X compatible with Y"
- User asks about recent changes, releases, or announcements
- Any question where the answer might have changed since your training data
- User explicitly asks you to research something

## When NOT to Use

- Pure logic, math, or reasoning questions
- Questions about stable, well-established concepts (e.g., "what is a linked list")
- Creative writing or opinion questions
- Questions the user explicitly says don't need research

## The Pattern

### 1. Scope the Question

Before searching, clarify what you need to find out:
- What is the specific factual claim to verify?
- What would a wrong answer look like? (This tells you what to check)
- Is this a single fact or does it require multiple pieces of information?

### 2. Fan Out — Parallel Subagent Research

Spawn 2-4 subagents in parallel using cheap models (DeepSeek, Haiku). Each subagent targets a different source:

| Subagent | Source Focus | Search Strategy |
|----------|-------------|-----------------|
| A | Official docs & announcements | Search for official project pages, changelogs, release notes |
| B | GitHub repos & issues | Search repos, issues, discussions for technical details |
| C | Community & blogs | Search forums, blog posts, Stack Overflow, Reddit |
| D | (Optional) Code & examples | Search for actual code samples, implementations |

**Subagent instructions:**
- Return raw facts only — no conclusions or opinions
- Include the source of each fact (so the main agent can cross-reference)
- If you find nothing relevant, say so explicitly
- Search broadly first, then narrow down

Adapt the number of subagents to complexity:
- Simple factual check → 2 subagents
- Complex topic with multiple facets → 3-4 subagents

### 3. Synthesize

As the main agent (stronger model), cross-reference all subagent findings:

- **Sources agree** → High confidence. State the answer directly.
- **Sources disagree** → Tell the user about the conflict. Present both sides. Let them decide or suggest further investigation.
- **Gaps found** → Explicitly state what you couldn't verify. Don't fill gaps with training data guesses.

### 4. Deliver

Give the answer directly:
- Clean, confident, correct
- No source URL lists (unless user asks or sources conflict)
- No academic formatting
- No "according to my research" preamble — just answer the question
- If you had to flag conflicts or gaps, do it naturally within the answer

## Anti-Patterns

| Wrong | Right |
|-------|-------|
| Answer first, then maybe search | Search first, then answer |
| "Based on my training data..." | Search, verify, then state facts |
| One source = enough | Cross-reference 2-3 sources minimum |
| Silently pick one conflicting source | Tell the user sources disagree |
| Long source citation lists | Just give the correct answer |
| "I couldn't find anything" then guess | State the gap, don't fill it with guesses |

## Example

**User:** "Does OpenClaw support cross-compatible skills with Claude Code?"

**Wrong (training data guess):**
"No, they use different formats and aren't compatible."

**Right (search-first):**
1. Spawn subagents to search OpenClaw docs, GitHub, community posts
2. Find: acpx supports pasting skills into any ACP harness; SKILL.md format works across platforms because skills are instructions, not executable code
3. Answer: "Yes. Skills in SKILL.md format work across OpenClaw, Claude Code, and other ACP harnesses. They're markdown-based instructions that agents adapt to their environment, so the same skill file works on multiple platforms."
```

**Step 2: Verify the SKILL.md is well-formed**

Check that:
- Frontmatter has `name` and `description`
- `name` uses lowercase-hyphens only
- `description` starts with "Use when"
- Content has Overview, When to Use, the workflow, and anti-patterns

**Step 3: Commit**

```bash
git add skills/research-workflow/SKILL.md
git commit -m "feat: add research-workflow skill for search-first verified answers"
```

---

### Task 4: Final verification

**Step 1: Verify project structure**

```bash
find . -not -path './.git/*' -type f | sort
```

Expected output:
```
./LICENSE
./README.md
./docs/plans/2026-03-04-wolfhead-skills-design.md
./docs/plans/2026-03-04-wolfhead-skills-implementation.md
./skills/research-workflow/SKILL.md
```

**Step 2: Verify git log**

```bash
git log --oneline
```

Expected: 4 commits (design doc + README + LICENSE + research-workflow skill)
