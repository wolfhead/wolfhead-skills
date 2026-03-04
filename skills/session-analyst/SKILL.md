---
name: session-analyst
description: "Use when the user wants to review past sessions, analyze skill performance, identify missing skills, detect user preferences, or improve agent workflows. Triggers: 'review session', 'review sessions', 'analyze session', 'what went well', 'session review', 'how did that go', 'improve skills', 'session summary', 'what happened', 'retrospective', 'debrief'."
---

# Session Analyst

Orchestrate session transcript analysis to produce a self-improvement report. Dispatch cheap/fast subagents for analysis work, then synthesize their findings into one unified report.

Does NOT modify skill files — observe, analyze, and report only.

## Process

- [ ] 1. Search for sessions
- [ ] 2. Preprocess each session
- [ ] 3. Dispatch analysis subagents
- [ ] 4. Synthesize report

### 1. Search for Sessions

Determine target sessions from user input. Use the bundled search script:

```bash
python3 <skill-dir>/scripts/search_sessions.py --project "$PWD" --latest 5 --min-turns 3
```

Where `<skill-dir>` is the directory containing this SKILL.md (resolve via the skill's installation path).

**Argument mapping:**
- "review this session" / "last session" → `--latest 1`
- "review last N sessions" → `--latest N`
- "review today's sessions" → `--date YYYY-MM-DD`
- "review sessions since Monday" → `--since YYYY-MM-DD`
- No argument → `--latest 5` (default)

The script returns a JSON array of session objects with `path`, `session_id`, `modified`, `size_bytes`, and `turn_count`.

### 2. Preprocess Each Session

For each session path from step 1, extract condensed data:

```bash
python3 <skill-dir>/scripts/extract_session.py <session.jsonl> --output-dir /tmp/session-analyst/<session-id>/
```

This creates:
```
/tmp/session-analyst/<session-id>/
├── main.json              # Main session condensed data
├── subagents/
│   ├── agent-xxx.json     # Condensed subsession data
│   └── ...
```

### 3. Dispatch Analysis Subagents

For each condensed JSON file (both `main.json` and every `subagents/*.json`), dispatch one analysis subagent.

**Before dispatching**, read `<skill-dir>/../session-subagent-analyst/SKILL.md` once and store its full body (everything after the YAML frontmatter). Include this content in every subagent prompt. Subagents cannot load skills on their own — the orchestrator must provide the instructions inline.

Use the Agent tool with these exact parameters:
- `subagent_type`: `"general-purpose"` (NOT `session-subagent-analyst` — that is a skill, not an agent type)
- `model`: `"haiku"` (cheap/fast model for analysis work)
- `description`: `"Analyze <main|subagent> <session-id>"`
- `prompt`: Include the file path, context, and the full sub-skill instructions:

```
Analyze the session transcript at: <path to condensed JSON file>

Context: This is part of a multi-session performance review.
Parent session slug: <slug from metadata>

<paste full session-subagent-analyst SKILL.md body here>
```

Dispatch all subagents in parallel. Collect all JSON reports.

### 4. Synthesize Report

Read all subagent JSON reports. Merge findings across all sessions into one unified report. Write to `docs/reviews/YYYY-MM-DD-sessions-review.md` (create directory if needed).

**Merge rules:**
- **Skill Suggestions**: Group by skill name. Deduplicate similar suggestions. Note frequency.
- **Anti-patterns**: Group by pattern name. Count occurrences across sessions.
- **User Preferences**: Only promote to the report if observed in 2+ sessions (single-session observations are noise).
- **Gaps**: Deduplicate. Note frequency.

## Report Template

```markdown
# Session Analysis Report
**Date**: YYYY-MM-DD | **Sessions analyzed**: N
**Session list**: <slug-1>, <slug-2>, ...

---

## 1. Skill Suggestions

### <skill-name>
**Observed in**: <N> sessions
**Caller suggestions**: <how invoker could use skill better>
**Skill suggestions**: <non-trivial improvements to the skill itself>

(Omit skill if no suggestions. Omit Caller/Skill suggestions subsection if empty.)

---

## 2. Anti-patterns

**<pattern-name>**: <description of recurring inefficiency>
- Observed in: <N>/<total> sessions
- Impact: <what it costs — time, tokens, failures>
- Recommendation: <how to fix>

(Omit entire section if none found.)

---

## 3. User Preferences

| Preference | Scope | Frequency | Suggested Entry |
|-----------|-------|-----------|----------------|
| <pattern> | Global/Project | <N>/<total> sessions | <what to add to CLAUDE.md or memory> |

(Omit entire section if none found.)

---

## 4. Gaps

**<gap-name>**: <situation where a skill or specialization was missing>
- Observed in: <N>/<total> sessions
- Proposed skill: <name and brief description>

(Omit entire section if none found.)
```

## Quality Standards

- **Non-trivial only.** Skip obvious observations like "agent used Read to read a file."
- **Be specific.** "Brainstorming skill invoked after user had already decided" > "skill could improve."
- **Caller matters.** Often the issue is invocation (timing, args) not the skill itself.
- **Cross-session patterns matter most.** Single-session findings are less actionable than patterns appearing in 3+ sessions.
- **Token awareness.** Flag subagents using 5x+ expected tokens for their task.
