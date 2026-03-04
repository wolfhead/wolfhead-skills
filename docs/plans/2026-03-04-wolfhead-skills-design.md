# Wolfhead Skills - Project Design

## Overview

A collection of cross-compatible AI agent skills (SKILL.md format) primarily targeting OpenClaw, with compatibility across Claude Code, Codex, and other ACP harnesses. Skills are markdown-based instructions that agents read and adapt to their environment.

## Distribution

Git repository. No marketplace publishing initially. Can be added to ClawHub or Claude Code marketplace later.

## Project Structure

```
wolfhead_skills/
├── skills/
│   └── <skill-name>/
│       └── SKILL.md
├── docs/
│   └── plans/
├── README.md
└── LICENSE
```

- Single repo containing all skills
- Each skill is a folder under `skills/` with a `SKILL.md` file
- OpenClaw-native structure (no `.claude-plugin/` initially)
- Can add platform-specific configs later as needed

## Skill Format

Each `SKILL.md` follows the OpenClaw convention:

```yaml
---
name: skill-name
description: Use when [triggering conditions]
---
```

Followed by markdown content with instructions, workflow phases, and rules.

## First Skill: research-workflow

### Problem

AI agents often answer verifiable questions from training data without checking current sources. This leads to confident but wrong answers (e.g., claiming skills aren't cross-compatible when they are). Users shouldn't have to manually prompt the agent to search first.

### Design

**Core principle**: Get the right answer. Search and verify before responding. Never guess from training data on verifiable questions.

**Workflow**:

1. **Scope** - Clarify the research question. Identify what's verifiable vs. general knowledge.

2. **Fan out** - Spawn multiple subagents (cheap model: DeepSeek/Haiku) in parallel, each searching different sources (web, GitHub, docs, forums). Each returns raw facts, not conclusions.

3. **Synthesize** - Main agent (stronger model) cross-references all findings. Where sources agree = high confidence. Where they conflict = flag for the user.

4. **Deliver** - Give the answer directly. Clean, confident, correct. No mandatory source URLs unless the user asks or sources conflict.

### Hard Rules

- Verifiable questions about current tech/tools/APIs must trigger search — no exceptions
- Cross-reference at least 2-3 sources before concluding
- If sources disagree, tell the user instead of silently picking one
- State what couldn't be verified (gaps in research)
- No academic formatting, no mandatory citation lists
- No research reports saved to files unless user asks

### Architecture

- OpenClaw as orchestrator spawns cheap subagents for parallel source gathering
- Subagents use cheaper models (DeepSeek, Haiku) to minimize cost
- Main agent uses stronger model for synthesis and final answer
- Number and focus of subagents adapts to the question complexity

## Future Skills (Planned)

- ACP/Claude Code orchestration (delegate coding tasks via ACP)
- Company IT system integration (domain-specific)
- Additional productivity and development workflow skills
