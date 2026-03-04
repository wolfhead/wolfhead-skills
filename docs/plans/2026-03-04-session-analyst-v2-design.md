# Session Analyst v2 Design

**Goal**: Upgrade session-analyst to support multi-session analysis with proper subsession extraction, session search, structured subagent guidance via a sub-skill, and a focused self-improvement report format.

**Architecture**: One orchestrator skill (`session-analyst`) + one sub-skill for dispatched analysts (`session-subagent-analyst`). Two Python scripts handle data extraction and session discovery.

---

## Components

### 1. session-analyst (orchestrator skill)

Updated SKILL.md that orchestrates the full workflow:

1. **Search** — call `search_sessions.py` to find target sessions
2. **Preprocess** — call `extract_session.py` on each, producing output directories with main + subsession condensed JSONs
3. **Dispatch** — spawn cheap/fast subagents (one per file — main sessions and subsessions), all using `session-subagent-analyst` skill
4. **Synthesize** — collect all subagent reports, produce one unified report

The SKILL.md is purely orchestration logic + report template. All analysis intelligence lives in the sub-skill.

**Best practices fixes applied**:
- Description starts with "Use when...", no workflow summary
- Verb-first name consideration (keep `session-analyst` for continuity, or rename to `analyzing-sessions`)
- Script handles missing files gracefully
- `_truncate` uses named constant `CONTENT_PREVIEW_MAX_CHARS = 500`
- `<skill-dir>` placeholder explained in SKILL.md

### 2. session-subagent-analyst (sub-skill)

Dedicated skill loaded by all dispatched analysis subagents. Designed for a cheap, fast model with average reasoning ability.

**Key design principles**:
- Checklist-driven, not open-ended
- Concrete criteria with no ambiguity
- Example-driven — one good input/output pair
- Branches based on input type (main session vs subsession)

**Main session checklist**:
- Skill invocation timing — right skill at right time? Good arguments?
- User interaction patterns — instruction clarity, corrections, rejected prompts
- Flow efficiency — turn count, token usage, unnecessary subagent spawning
- Gaps — situations where a skill or specialization was missing

**Subsession checklist**:
- Task completion — did it accomplish the assigned task?
- Tool efficiency — flag >3 consecutive identical tool calls (doom loop), redundant file reads, redundant searches
- Tool failures — list `is_error: true` results and recovery behavior
- Skill compliance — if skill was invoked, did subagent follow its steps?
- Token awareness — flag output tokens exceeding 5x task complexity

**Output**: Structured JSON with defined fields and one-line definitions for each.

### 3. extract_session.py (upgraded)

**Current**: Outputs one JSON file. Rejects subagent files.

**Upgraded**: Outputs to a directory with main + subsession condensed JSONs.

```
/tmp/session-analyst/<session-id>/
├── main.json                          # Main session condensed data
├── subagents/
│   ├── agent-a07ea09920741a2f8.json   # Condensed subsession
│   ├── agent-a9ff6e5f29cddd141.json
│   └── ...
```

**Changes**:
- New `--output-dir` flag replaces `--output`
- Subsession extraction reuses same parsing logic, skips `is_main_session` check
- `main.json` includes `subagent_outputs` field listing paths to condensed subsession JSONs
- Backward compatible: `--output` flag still works for single-file output

### 4. search_sessions.py (new)

Searches `~/.claude/projects/` for session files.

**Filters**:
- `--project <path>` — filter by project directory (converts to project key)
- `--date YYYY-MM-DD` / `--since YYYY-MM-DD` — filter by file modification time
- `--latest N` — return N most recent (default: 5)
- `--min-turns N` — exclude sessions with fewer than N human turns (default: 3)

**Defaults**: Current project, latest 5, min 3 turns.

**Hard cap**: 20 sessions max. If query matches more, returns 20 most recent with warning.

**Output**: JSON array:
```json
[
  {
    "path": "/path/to/session.jsonl",
    "session_id": "4c2bbfc8-...",
    "modified": "2026-03-04T05:02:09",
    "size_bytes": 1234567,
    "turn_count": 12
  }
]
```

**Filters out**: Subagent JSONL files (only main session files returned).

---

## Report Format

One unified report synthesizing all sessions analyzed. Four sections focused on actionable self-improvement:

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

---

## File Structure

```
session-analyst/
├── SKILL.md                    # Orchestrator: search → preprocess → dispatch → synthesize
├── scripts/
│   ├── extract_session.py      # Upgraded: main + subsessions → output dir
│   ├── search_sessions.py      # New: find sessions by project/date/count
│   ├── test_extract.py         # Updated tests
│   └── test_search.py          # New tests

session-subagent-analyst/
├── SKILL.md                    # Checklist-driven analysis for cheap/fast model
```

Both skills installed via symlink to `~/.claude/skills/`.
