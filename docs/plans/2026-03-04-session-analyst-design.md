# Session Analyst Skill Design

**Date**: 2026-03-04
**Status**: Approved
**Platform**: Claude Code first, OpenClaw later

## Overview

A meta-skill (`session-analyst`) that acts as a "manager" reviewing the performance of skills, agents, and user interactions within a session. It reads session transcripts, analyzes execution patterns, and produces a structured review report. It does **not** modify any skill files — it only observes and reports.

## Key Design Decisions

1. **Analyst only, not a fixer** — produces findings, suggestions, and gap analysis. How to improve is a separate concern.
2. **On-demand invocation** — user explicitly triggers the analysis, not automatic.
3. **Propose only** — no modifications to skill files, only a structured report.
4. **Python preprocessor** — extracts relevant signals from large JSONL session files before agent analysis, keeping context small and focused.
5. **Fan-out analysis** — parallel subagents analyze each subagent transcript independently, main agent synthesizes.
6. **Main session entry only** — the preprocessor validates the target is a main session, not a subagent file.
7. **Claude Code first** — uses Claude Code session file format. OpenClaw support added later with a separate parser.

## Architecture

```
User invokes: /session-analyst [session-id | latest N]
         │
         ▼
┌──────────────────────────┐
│  1. RESOLVE SESSION      │
│  - Find JSONL file(s)    │
│  - Validate main session │
│    (not subagent)        │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  2. PYTHON PREPROCESSOR  │
│  extract_session.py      │
│                          │
│  Reads raw JSONL →       │
│  outputs condensed JSON  │
│  (parent + per subagent) │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  3. MAIN AGENT READS     │
│  condensed parent JSON   │
│  - Maps overall flow     │
│  - Identifies skills     │
│  - Lists subagents       │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  4. FAN-OUT ANALYSIS     │──► Subagent per subagent transcript
│  (parallel dispatch)     │    ┌────────────────────────────┐
│                          │    │ Reads condensed subagent   │
│                          │    │ JSON + parent context      │
│                          │    │ Identifies: failures,      │
│                          │    │ retries, inefficiencies,   │
│                          │    │ skill compliance issues    │
│                          │    │ Returns structured report  │
│                          │    └────────────────────────────┘
│  5. SYNTHESIZE           │◄── Collect all subagent reports
│  - Cross-reference       │
│  - Deduplicate           │
│  - Prioritize            │
│                          │
│  6. PRODUCE REPORT       │
│  (4-section markdown)    │
└──────────────────────────┘
         │
         ▼
   docs/reviews/YYYY-MM-DD-session-<slug>-review.md
```

## Python Preprocessor (`extract_session.py`)

### Input
- Path to a parent session JSONL file

### Validation
- Reads the first record. If `isSidechain: true` or `agentId` is present, exits with error:
  `"Error: Target file is a subagent session (agentId: <id>), not a main session."`

### Extraction (parent session)
- **Session metadata**: ID, slug, project path, start/end timestamps, total duration, model, CLI version
- **Conversation flow**: sequence of user turns (text content) and assistant responses (text only, no thinking blocks)
- **Skills invoked**: Skill tool calls with skill name, args, and result
- **Subagent map**: for each Task tool call — agentId, description, prompt, subagent_type, result status, duration, token usage, output file path
- **Tool failures**: any `tool_result` with `is_error: true`, including the tool name and error content
- **User corrections**: user messages that follow a tool rejection (detected by rejected tool_result patterns or re-prompts)
- **System errors**: `api_error` records with retry info
- **Turn durations**: from `turn_duration` system records
- **Compaction events**: `compact_boundary` records with token counts

### Extraction (per subagent)
- Same structure, scoped to the subagent JSONL file
- Linked to parent via `sessionId` and `agentId`

### Output
- One JSON file per session: `/tmp/session-analyst/<session-id>.json`
- Contains nested `subagents` array with each subagent's condensed data

### Platform Detection
```python
import os
CLAUDE_DIR = os.path.expanduser("~/.claude")
OPENCLAW_DIR = os.path.expanduser("~/.openclaw")

if os.path.isdir(CLAUDE_DIR):
    platform = "claude-code"
elif os.path.isdir(OPENCLAW_DIR):
    platform = "openclaw"  # Future
```

## Report Output Format

Saved to `docs/reviews/YYYY-MM-DD-session-<slug>-review.md`:

```markdown
# Session Review: <session-slug>
**Date**: YYYY-MM-DD
**Session ID**: <uuid>
**Duration**: Xm Ys
**Model**: claude-opus-4-6
**Total tokens**: X (input: X, output: X, cached: X)

---

## 1. Per-Skill Performance

### Skill: <skill-name>
**Invoked by**: <caller context>
**Times used**: N

#### Findings
- What happened during execution
- How the skill was followed (or not)

#### Caller Suggestions
- How the invoking agent/user could use this skill better
- Wrong timing, missing context, bad arguments

#### Skill Suggestions
- Non-trivial improvements to the skill itself
- Unclear instructions, missing edge cases, wrong assumptions

#### Conclusion
Overall assessment: effective / partially effective / ineffective

---

## 2. Usage Patterns

### Recurring Patterns
- Patterns across tool usage and agent behavior

### Anti-Patterns
- Doom loops, premature completion, unnecessary subagent spawning

### Efficiency Observations
- Token waste, redundant tool calls, subagents where direct calls suffice

---

## 3. Gap Analysis

### Missing Skills
- Situations where no skill applied but one should have
- Proposed skill concept + rationale

### Missing Agent Specializations
- Subagent types that would have been useful

---

## 4. User Interaction Analysis

### Communication Patterns
- Instruction clarity, context provided, feedback style

### Detected Preferences
- Recurring choices or corrections suggesting a preference

### Memory Suggestions
| Preference | Scope | Suggested Entry |
|-----------|-------|----------------|
| Always uses TypeScript | Global | Add to CLAUDE.md |
| Prefers fan-out pattern | Project | Add to project CLAUDE.md |
```

## Invocation

```
/session-analyst              → most recent session
/session-analyst <session-id> → specific session
/session-analyst latest 3     → 3 most recent sessions (separate reports)
```

## File Structure

```
skills/
  session-analyst/
    SKILL.md              # Skill instructions
    extract_session.py    # Python preprocessor
```

## Dependencies

- Python 3 (standard library only — json, os, glob, sys, datetime)
- Claude Code session files at `~/.claude/projects/`

## Future Extensions

- OpenClaw session parser (separate Python module)
- Cross-session trend analysis (analyze multiple sessions for recurring patterns)
- Integration with beads for tracking improvement tasks
- Automatic preference extraction → CLAUDE.md updates (separate skill)
