# siv CLI — Self-Improvement CLI Tool

> A CLI tool that replaces the full self-improvement pipeline (real-time capture, session analysis, promotion) with a unified interface. Agents never manage files — sivCode handles all I/O, LLM calls return structured JSON.

## Design Principles

1. **CLI is the abstraction layer** — all storage reads/writes go through CLI commands
2. **LLM calls are single completions** — no agent tool loops, just structured JSON in/out
3. **sivCode owns all I/O** — agents never read/write files directly
4. **Append-only primary storage** — findings.jsonl is the source of truth

## Naming

| Term | Meaning |
|------|---------|
| **Agent** | The user's Claude Code session (expensive, doing real work) |
| **sivCode** | Hard-coded logic in the CLI (TypeScript/Node) |
| **sivAgent** | Cheap LLM call made by sivCode (deepseek-chat via Claude Agent SDK) |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   siv CLI (Node/TS)                   │
├──────────┬───────────┬──────────────┬────────────────┤
│ analyze  │ log       │ run_promotion│ retrieve       │
│          │           │ promote_find │ status         │
├──────────┴───────────┴──────────────┴────────────────┤
│                    sivCode                            │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────┐ │
│  │ Session    │ │ LLM Client   │ │ Storage        │ │
│  │ Preprocess │ │ (Agent SDK)  │ │ (JSONL)        │ │
│  └────────────┘ └──────────────┘ └────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## Storage

All state lives in `~/.siv/`:

```
~/.siv/
├── config.json          # model endpoint, thresholds, paths
├── findings.jsonl       # append-only, all findings from all sources
├── promotions.jsonl     # promotion audit log
└── backups/             # pre-write snapshots of MEMORY.md/CLAUDE.md
```

### findings.jsonl

Each line:

```json
{
  "id": "LRN-20260305-a3f",
  "ts": "2026-03-05T08:30:00Z",
  "category": "correction",
  "summary": "API returns 404 not 400",
  "details": "...",
  "priority": "medium",
  "project": "wolfhead_skills",
  "project_path": "/Users/me/work/wolfhead_skills",
  "session": "725d10df",
  "tags": ["api"],
  "related_files": [],
  "source": "analyze",
  "status": "pending"
}
```

- `status`: `pending` → `promoted` | `dismissed`
- `source`: `analyze` | `manual` | `hook`
- `id` format: `LRN-YYYYMMDD-xxx` or `ERR-YYYYMMDD-xxx`

### promotions.jsonl

Each line:

```json
{
  "ts": "2026-03-05T10:00:00Z",
  "finding_ids": ["LRN-20260305-a3f", "LRN-20260303-b2c"],
  "scope": "project",
  "project": "wolfhead_skills",
  "project_path": "/Users/me/work/wolfhead_skills",
  "category": "learning",
  "rule": "Always Read before Write",
  "action_taken": "create",
  "target_file": "~/.claude/projects/-Users-me-work-wolfhead_skills/memory/MEMORY.md"
}
```

## Commands

### `siv log`

Append a finding to findings.jsonl. No LLM call. Pure data write.

```bash
siv log \
  --category <correction|error|knowledge_gap|best_practice|feature_request> \
  --summary "one-line description" \
  --details "full context" \
  --priority <low|medium|high|critical> \
  --project <name> \
  --project-path <path> \
  --session <id> \
  --source <analyze|manual|hook> \
  --tags <comma-separated> \
  --related <file-paths>
```

**sivCode steps:**
1. Generate ID: `{LRN|ERR}-YYYYMMDD-{random 3 hex chars}`
2. Append JSON line to `~/.siv/findings.jsonl`
3. Print result to stdout

**Output:**
```json
{"id": "LRN-20260305-a3f", "status": "logged"}
```

### `siv analyze`

Analyze session transcripts. Produces findings via internal `log()` calls.

```bash
siv analyze \
  --latest 5 \
  --project-path <path> \
  --since <date> \
  --session <id>
```

**sivCode steps:**
1. Find session JSONL files (port `search_sessions.py` logic to TS)
2. Preprocess each session (port `extract_session.py` logic to TS) → condensed JSON
3. For each session, call sivAgent-Analyze (single LLM completion):
   - Input: condensed transcript + analysis instructions (derived from `session-subagent-analyst` skill)
   - Output: structured JSON with findings array
4. sivCode fills in project/session/source metadata automatically
5. sivCode calls internal `log()` for each finding
6. Print summary to stdout

**sivAgent-Analyze prompt shape:**

```
Analyze this session transcript and return findings as JSON.

<transcript>
{condensed JSON}
</transcript>

<instructions>
{analysis instructions — derived from session-subagent-analyst skill}
</instructions>

Return:
{
  "findings": [
    {
      "category": "correction|error|knowledge_gap|best_practice|feature_request",
      "summary": "one-line description",
      "details": "full context",
      "priority": "low|medium|high|critical",
      "tags": ["tag1"]
    }
  ]
}
```

**LLM calls:** 1 per session (parallelizable)

**sivAgent-Analyze has no tools.** Returns JSON, sivCode handles storage.

### `siv run_promotion`

Scan findings, identify candidates by hard rules, distill into rules, promote.

```bash
siv run_promotion \
  --dry-run \
  --window 7
```

**sivCode steps:**
1. Read `findings.jsonl`, filter to `status: pending` within window
2. Group findings by `(project, category)` — all findings for the same project and category go together
3. Apply hard promotion rules:
   - **Project promotion:** 2+ sessions OR 3+ total findings for a pattern
   - **Global promotion:** same pattern in 2+ different projects
4. If no candidates → print "nothing to promote", exit
5. If `--dry-run` → print candidates with groupings, exit
6. Call sivAgent-Promote (single LLM completion):
   - Input: all candidate finding groups
   - Output: structured JSON with promotions array
7. For each promotion in the response, sivCode calls internal `promoteFindings()` (shared with `siv promote_finding`)
8. Print promotion summary

**sivAgent-Promote prompt shape:**

```
Review these grouped findings and distill each group into a concise actionable rule.

<groups>
[
  {
    "group_id": 1,
    "project": "wolfhead_skills",
    "project_path": "/Users/me/work/wolfhead_skills",
    "scope": "project",
    "findings": [
      {"id": "LRN-20260305-a3f", "summary": "...", "details": "...", ...},
      {"id": "LRN-20260303-b2c", "summary": "...", "details": "...", ...}
    ]
  }
]
</groups>

For each group, distill into ONE concise rule. Return:
{
  "promotions": [
    {
      "finding_ids": ["LRN-20260305-a3f", "LRN-20260303-b2c"],
      "scope": "project",
      "project": "wolfhead_skills",
      "project_path": "/Users/me/work/wolfhead_skills",
      "category": "learning",
      "rule": "Always Read before Write"
    }
  ]
}
```

**LLM calls:** 1 (distillation)

### `siv promote_finding`

Write a single promotion to the correct target file. Also usable as a standalone CLI command.

```bash
siv promote_finding \
  --finding-ids "LRN-20260305-a3f,LRN-20260303-b2c" \
  --scope <project|global> \
  --project <name> \
  --project-path <path> \
  --category <learning|error|preference> \
  --rule "Always Read before Write"
```

**sivCode steps:**
1. Determine target file:
   - `scope=project` → `~/.claude/projects/<encoded-path>/memory/MEMORY.md`
   - `scope=global` → `~/.claude/MEMORY.md`
2. Read current content of target file (empty string if doesn't exist)
3. Also read the corresponding CLAUDE.md to check for duplicates
4. Call sivAgent-Writer (single LLM completion):
   - Input: rule text, category, current MEMORY.md content, current CLAUDE.md content
   - Output: edit instruction (not full file content)
5. sivCode backs up target file to `~/.siv/backups/`
6. sivCode applies the edit mechanically
7. sivCode marks source findings as `promoted` in `findings.jsonl`
8. sivCode appends to `promotions.jsonl`
9. Print result JSON

**sivAgent-Writer prompt shape:**

```
Given a new rule to promote, decide how to integrate it into the existing file.

New rule:
- Category: learning
- Rule: "Always Read before Write"

Current MEMORY.md:
---
{content or "(empty)"}
---

Current CLAUDE.md (for duplicate check):
---
{content or "(empty)"}
---

Decide:
- If the rule already exists in CLAUDE.md → skip (return action: "skip")
- If a similar rule exists in MEMORY.md → merge (update confirmed date, add sessions)
- If a conflicting rule exists in MEMORY.md → supersede (replace the old entry)
- If the rule is new → create (append to appropriate section)

Return:
{
  "action": "create|merge|supersede|skip",
  "section": "## Session Learnings",
  "target_line": "(existing line to replace, for merge/supersede only)",
  "entry": "- Always Read before Write *(added: 2026-03-06, confirmed: 2026-03-06, sessions: abc123)*",
  "reason": "brief explanation"
}
```

**LLM calls:** 1 per promotion

### `siv retrieve`

Return promoted learnings for context injection. No LLM call.

```bash
siv retrieve \
  --project-path <path> \
  --global \
  --format <text|json>
```

**sivCode steps:**
1. If `--project-path`: read `~/.claude/projects/<encoded-path>/memory/MEMORY.md`
2. If `--global`: read `~/.claude/MEMORY.md`
3. If both: concatenate
4. Output in requested format

**Hook integration:**

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{"type": "command", "command": "siv retrieve --project-path $PWD --global"}]
    }]
  }
}
```

### `siv status`

Show stats. No LLM call.

```bash
siv status [--project-path <path>]
```

**sivCode steps:**
1. Read `findings.jsonl` and `promotions.jsonl`
2. Print: total findings (pending/promoted/dismissed), by category, by project, recent promotions, age distribution

## Command / LLM Call Summary

| Command | LLM calls | LLM purpose |
|---------|-----------|-------------|
| `siv log` | 0 | — |
| `siv analyze` | 1 per session | Extract findings from transcript |
| `siv run_promotion` | 1 (distill) + 1 per promotion (merge) | Distill rules; decide file edits |
| `siv promote_finding` | 1 | Decide create/merge/supersede/skip |
| `siv retrieve` | 0 | — |
| `siv status` | 0 | — |

## SKILL.md (Agent-Facing)

The skill file loaded by Agent (Claude Code) is minimal — only documents `siv log` for optional real-time capture:

```markdown
---
name: siv
description: "Log learnings via CLI. Use when: user corrects you, command fails, knowledge gap discovered, better approach found."
---

# Self-Improvement

Log learnings with `siv log`. Don't manage files.

## Log

\`\`\`bash
siv log -c <category> -s "summary" [-d "details"] [-p priority] \
  --project <name> --project-path <path> --session <id>
\`\`\`

**Categories:** `correction` | `error` | `knowledge_gap` | `best_practice` | `feature_request`

**When to log:**

| Trigger | Category |
|---------|----------|
| User says "that's wrong", "actually..." | `correction` |
| Command returns error / exception | `error` |
| Your knowledge was outdated | `knowledge_gap` |
| Found better way to do something | `best_practice` |
| User wants feature that doesn't exist | `feature_request` |

Analysis and promotion happen offline — just log and continue.
```

~30 lines.

## Future Commands (not in v1)

- `siv sweep` — staleness sweep, remove old promoted entries (cron-able)
- `siv dedup` — scan findings.jsonl for duplicates, merge them
- `siv export` — export findings/promotions for debugging
- `siv init` — setup config, create directories

## Resolved Decisions

1. **Package distribution:** Local development for now. Run from repo via `npx` or direct `node` invocation.
2. **Config:** Read from `~/.siv/.env` file. Contains model API key, endpoint URL, model name. Promotion thresholds can be in `~/.siv/config.json` separately.
3. **Session file location:** `~/.claude/projects/*/sessions/`.
