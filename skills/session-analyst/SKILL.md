---
name: session-analyst
description: "Analyze Claude Code session transcripts to review skill, agent, and user performance. Produces a structured report with per-skill findings, usage pattern analysis, gap identification, and user interaction insights. Use when the user wants to review a past session, improve skills based on real execution data, identify missing skills, or detect user preferences. Triggers: 'review session', 'analyze session', 'what went well', 'session review', 'how did that go', 'improve skills'."
---

# Session Analyst

Performance analyst that reviews how skills, agents, and users performed in a session. Reads transcripts, identifies issues, and produces a structured report. Does NOT modify files — observe and report only.

## Process

### 1. Resolve Session

Determine which session(s) to analyze from user input:

```bash
# Find session directory for current project
PROJECT_KEY=$(echo "$PWD" | sed 's|/|-|g')
SESSION_DIR="$HOME/.claude/projects/$PROJECT_KEY"

# List sessions by modification time (most recent first)
ls -lt "$SESSION_DIR"/*.jsonl 2>/dev/null | head -10
```

- No argument → most recent `.jsonl` file
- Partial UUID → match against filenames
- `latest N` → N most recent files, analyze each separately

### 2. Run Preprocessor

Extract signals from the raw JSONL using the bundled Python script:

```bash
python3 <skill-dir>/extract_session.py <session.jsonl> --output /tmp/session-analyst-output.json
```

If the script exits with error code 1, the file is a subagent session — ask the user for a main session file instead.

Read the output JSON. It contains:
- `metadata` — session ID, slug, model, tokens, turn durations
- `conversation` — sequence of human messages, assistant turns, tool results
- `skills` — Skill tool invocations with name, args, result
- `subagents` — Task tool invocations with agent_id, type, status, duration, tokens
- `tool_failures` — tool results with `is_error: true`
- `api_errors` — API errors with retry info
- `compactions` — context compaction events
- `subagent_files` — paths to subagent JSONL files

### 3. Extract Subagent Transcripts

For each path in `subagent_files`, read the subagent JSONL directly with the Read tool (they're typically smaller than parent sessions). Alternatively, run the preprocessor in a mode that skips the main-session check — parse the raw JSONL for tool calls, results, and conversation flow.

### 4. Fan-Out Analysis

Dispatch one analysis subagent (haiku model) per subagent transcript, in parallel:

```
Agent tool (model: haiku):
  description: "Analyze subagent <agent-id>"
  prompt: |
    Analyze this subagent execution transcript for a session performance review.

    Parent session: <slug>
    Task given: "<description from subagents list>"
    Subagent type: <subagent_type>

    Transcript data:
    <paste condensed data>

    Report as JSON:
    {
      "agent_id": "<id>",
      "task": "<what it was asked to do>",
      "outcome": "success|partial|failure",
      "findings": ["<finding>"],
      "inefficiencies": ["<issue>"],
      "skill_compliance": "compliant|deviated|no-skill",
      "tool_failure_count": N,
      "doom_loop_detected": false,
      "suggestions": ["<suggestion>"]
    }
```

### 5. Analyze Parent Session

While subagents run, analyze the parent session condensed JSON for:
- **Skill usage**: Were skills invoked at the right time? With good arguments? Any missed invocations?
- **User patterns**: Instruction clarity, corrections, repeated preferences
- **Flow efficiency**: Turn count, token usage, unnecessary subagent spawning
- **Gaps**: Situations where a skill or agent specialization was missing

### 6. Synthesize Report

Combine parent analysis + all subagent reports. Write to:

```
docs/reviews/YYYY-MM-DD-session-<slug>-review.md
```

Create `docs/reviews/` if it doesn't exist.

## Report Template

```markdown
# Session Review: <slug>
**Date**: YYYY-MM-DD | **Session**: <uuid> | **Model**: <model>
**Duration**: <sum of turn_durations> | **Turns**: <N> | **Subagents**: <N>
**Tokens**: <total> (in: <N>, out: <N>, cached: <N>)
**Tool Failures**: <N> | **API Errors**: <N> | **Compactions**: <N>

---

## 1. Per-Skill Performance

### <skill-name>
**Context**: <what was happening when invoked>
**Used**: <N> times

**Caller suggestions**: <how invoker could use skill better — timing, args, context>
**Skill suggestions**: <non-trivial improvements to the skill itself>
**Verdict**: effective / partially effective / ineffective

(Omit Caller suggestions or Skill suggestions if none. Omit entire skill block if verdict is "effective" with no suggestions.)

---

## 2. Usage Patterns

(Include only subsections with findings. Omit empty subsections.)

**Patterns**: <recurring behaviors across tools and agents>
**Anti-patterns**: <doom loops, premature completion, over-spawning>
**Efficiency**: <token waste, redundant calls, subagents vs direct tools>

---

## 3. Gap Analysis

(Omit entire section if no gaps found. Omit individual subsections if empty.)

**Missing skills**: <situations needing a skill that doesn't exist — concept + rationale>
**Missing specializations**: <subagent types that would have helped>

---

## 4. User Interaction Analysis

**Communication**: <instruction clarity, context quality, feedback style>
**Preferences**: <recurring choices suggesting persistent preferences>

| Preference | Scope | Suggested Entry |
|-----------|-------|----------------|
| <pattern> | Global/Project | <what to add> |
```

## Quality Standards

- **Non-trivial only.** Skip obvious observations like "agent used Read to read a file."
- **Be specific.** "Brainstorming skill invoked after user had already decided" > "skill could improve."
- **Caller matters.** Often the issue is invocation (timing, args) not the skill itself.
- **Preference threshold.** One correction = observation. Three similar corrections = preference.
- **Token awareness.** Flag subagents using 5x+ expected tokens for their task.
