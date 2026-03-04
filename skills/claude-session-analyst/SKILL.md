---
name: claude-session-analyst
description: "Use when the user wants to review past Claude Code sessions. Dispatches subagents to analyze each session, writes per-session LEARNINGS.md and ERRORS.md files. Triggers: 'review session', 'review sessions', 'analyze session', 'session review', 'retrospective', 'debrief'."
---

# Claude Session Analyst

Orchestrate session transcript analysis. Dispatch cheap/fast subagents to analyze each session, then write per-session LEARNINGS.md and ERRORS.md files with project metadata.

Does NOT modify skill files — observe, analyze, and report only.

## Process

- [ ] 1. Search for sessions
- [ ] 2. Preprocess each session
- [ ] 3. Dispatch analysis subagents
- [ ] 4. Write per-session output

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
python3 <skill-dir>/scripts/extract_session.py <session.jsonl> --output-dir /tmp/claude-session-analyst/<session-id>/
```

This creates:
```
/tmp/claude-session-analyst/<session-id>/
├── main.json              # Main session condensed data (includes subagent summaries)
├── subagents/             # Individual subsession data (not analyzed separately)
│   └── ...
```

### 3. Dispatch Analysis Subagents

For each session, dispatch **one** analysis subagent for `main.json` only. Do not analyze individual subsession files — the main session's condensed JSON already includes subagent invocation details, tool failures, and token usage. Analyzing subsessions separately multiplies cost (a session with 16 subagents would need 17 analysis agents) with little additional insight.

**Before dispatching**, read `<skill-dir>/../session-subagent-analyst/SKILL.md` once and store its full body (everything after the YAML frontmatter). Include this content in every subagent prompt. Subagents cannot load skills on their own — the orchestrator must provide the instructions inline.

Use the Agent tool with these parameters:
- `subagent_type`: `"general-purpose"` (NOT `session-subagent-analyst` — that is a skill, not an agent type)
- `model`: Pick a model that can follow a checklist, read JSON, and produce structured markdown output. Needs reliable instruction-following but not deep reasoning.
- `description`: `"Analyze session <session-id>"`
- `prompt`: Include the file path, context, and the full sub-skill instructions:

```
Analyze the session transcript at: <path to condensed JSON file>

Context: This is part of a multi-session performance review.
Parent session slug: <slug from metadata>

<paste full session-subagent-analyst SKILL.md body here>
```

**Do NOT use `run_in_background: true`.** Dispatch subagents in foreground so their results are returned directly. Background agents auto-complete and get cleaned up — calling `TaskOutput` on an already-completed background agent returns "No task found", which cascades as "Sibling tool call errored" to all parallel siblings.

Dispatch all session analysis agents in one parallel foreground call (one agent per session). Since each session only needs one agent now, the batch size equals the number of sessions (typically 1-5).

**Error handling:** If a subagent fails, retry it once individually (not in a batch). If it fails again, skip it and note in the output that the file was not analyzed.

Collect all markdown reports.

### 4. Write Per-Session Output

For each session analyzed, collect the analysis subagent's output and write it to a per-session directory.

**Output directory:** `~/.wolfhead_skills/claude-session-analyst/<session_id>/`

Create the directory:
```bash
mkdir -p ~/.wolfhead_skills/claude-session-analyst/<session_id>
```

**Determine project metadata** from the session's condensed JSON (`main.json` metadata):
- `Project`: short project name (last component of the project path, e.g., `wolfhead_skills`)
- `Project-Path`: absolute project path from the session metadata

**Write `LEARNINGS.md`:**

Take all LRN entries from the analysis subagent's output. Prepend the file header:

```markdown
# Learnings

**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <absolute project path>
**Analyzed**: <ISO-8601 timestamp>

---

(LRN entries from subagent output here)
```

**Write `ERRORS.md`:**

Take all ERR entries from the analysis subagent's output. Prepend the file header:

```markdown
# Errors

**Session**: <session_id>
**Project**: <project-name>
**Project-Path**: <absolute project path>
**Analyzed**: <ISO-8601 timestamp>

---

(ERR entries from subagent output here)
```

**Re-scan behavior:** If the directory already exists (session was analyzed before), overwrite the files. Keep only the latest analysis.

**Empty results:** If a session produced no learnings, write LEARNINGS.md with just the header. Same for errors.

## Quality Standards

- **Non-trivial only.** Skip obvious observations like "agent used Read to read a file."
- **Be specific.** "Brainstorming skill invoked after user had already decided" > "skill could improve."
- **Caller matters.** Often the issue is invocation (timing, args) not the skill itself.
- **Token awareness.** Flag subagents using 5x+ expected tokens for their task.
- **Per-session only.** Do not merge findings across sessions. Each session gets its own directory.
- **Project metadata required.** Every LEARNINGS.md and ERRORS.md must have Project and Project-Path in the header.
