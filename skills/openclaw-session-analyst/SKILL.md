---
name: openclaw-session-analyst
description: "Use when the user wants to review past OpenClaw sessions, analyze cost efficiency, identify anti-patterns, or review model switching behavior. Triggers: 'review openclaw session', 'openclaw session review', 'analyze openclaw sessions', 'openclaw cost analysis', 'openclaw retrospective'."
---

# OpenClaw Session Analyst

Orchestrate OpenClaw session transcript analysis to produce a self-improvement and cost-efficiency report. Dispatch cheap/fast subagents for analysis work, then synthesize their findings into one unified report.

Does NOT modify skill files — observe, analyze, and report only.

## Process

- [ ] 1. Search for sessions
- [ ] 2. Preprocess each session
- [ ] 3. Dispatch analysis subagents
- [ ] 4. Synthesize report

### 1. Search for Sessions

Determine target sessions from user input. Use the bundled search script:

```bash
python3 <skill-dir>/scripts/search_sessions.py --agent main --latest 5 --min-turns 3
```

Where `<skill-dir>` is the directory containing this SKILL.md.

**Argument mapping:**
- "review this session" / "last session" → `--latest 1`
- "review last N sessions" → `--latest N`
- "review today's sessions" → `--date YYYY-MM-DD`
- "review sessions since Monday" → `--since YYYY-MM-DD`
- "review tool-runner agent" → `--agent tool-runner`
- No argument → `--agent main --latest 5` (default)

The script returns a JSON array of session objects with `path`, `session_id`, `agent_id`, `modified`, `size_bytes`, and `turn_count`.

### 2. Preprocess Each Session

For each session path from step 1, extract condensed data:

```bash
python3 <skill-dir>/scripts/extract_session.py <session.jsonl> --output-dir /tmp/openclaw-session-analyst/<session-id>/
```

This creates:
```
/tmp/openclaw-session-analyst/<session-id>/
└── main.json              # Condensed session data with cost tracking
```

### 3. Dispatch Analysis Subagents

For each `main.json`, dispatch one analysis subagent.

**Before dispatching**, read `<skill-dir>/../session-subagent-analyst/SKILL.md` once and store its full body. Include this content in every subagent prompt.

Use the Agent tool with:
- `subagent_type`: `"general-purpose"`
- `model`: Pick a model that can follow a checklist and produce structured JSON output.
- `description`: `"Analyze openclaw session <session-id>"`
- `prompt`: Include the file path, context, and the full sub-skill instructions:

```
Analyze the OpenClaw session transcript at: <path to main.json>

Context: This is an OpenClaw session analysis (not Claude Code). The condensed JSON includes
OpenClaw-specific fields: cost_by_model, model_switches, and cost-per-turn on assistant messages.
Pay special attention to cost efficiency and model switching patterns.

<paste full session-subagent-analyst SKILL.md body here>
```

Dispatch all subagents in parallel. Collect all JSON reports.

### 4. Synthesize Report

Read all subagent JSON reports. Merge findings across all sessions into one unified report. Write to `~/.wolfhead_skills/openclaw-session-analyst/YYYY-MM-DD-<slug>-review.md` (create directory if needed). Use the session slug or agent ID from metadata for the filename.

**Merge rules:**
- **Cost Analysis**: Aggregate cost_by_model across sessions. Identify most/least expensive sessions.
- **Anti-patterns**: Group by pattern name. Count occurrences across sessions.
- **User Preferences**: Include all preferences from subagent reports. Preserve the `context` field. Distinguish between situational corrections and durable preferences. Label each as `Situational` or `Durable` in the Type column.
- **Gaps**: Deduplicate. Note frequency.
- **Attribution**: Use `task_label` from subagent reports — never raw session IDs.

## Report Template

```markdown
# OpenClaw Session Analysis Report
**Date**: YYYY-MM-DD | **Sessions analyzed**: N | **Agent**: <agent-id>

---

## 1. Cost Analysis

| Model | Sessions | Turns | Input | Output | Cache | Total |
|-------|----------|-------|-------|--------|-------|-------|
| <model-id> | N | N | $X.XX | $X.XX | $X.XX | $X.XX |

**Total cost across sessions**: $X.XX
**Model switching patterns**: <observations about when/why models were switched>
**Cost efficiency**: <recommendations>

---

## 2. Anti-patterns

**<pattern-name>**: <description>
- Observed in: <N>/<total> sessions
- Context: <the situation where this occurred>
- Impact: <time/tokens/cost>
- Recommendation: <fix>

(Omit entire section if none found.)

---

## 3. User Preferences

| Preference | Type | Scope | Frequency | Context | Suggested Entry |
|-----------|------|-------|-----------|---------|----------------|
| <pattern> | Situational/Durable | Global/Project | <N>/<total> sessions | <brief context> | <what to add to config or memory> |

(Omit entire section if none found.)

---

## 4. Gaps

**<gap-name>**: <situation>
- Observed in: <N>/<total> sessions
- Proposed skill: <name and description>

(Omit entire section if none found.)

---

## 5. Tool Usage

| Tool | Calls | Failures | Failure Rate |
|------|-------|----------|--------------|
| <name> | N | N | N% |

(Omit if no notable findings.)
```

## Quality Standards

- **Non-trivial only.** Skip obvious observations.
- **Be specific.** "Model switched to deepseek mid-conversation without apparent reason" > "model switching observed."
- **Cost awareness.** Flag sessions where >50% of cost was cache writes that were never read.
- **Cross-session patterns matter most.** Single-session findings are less actionable.
