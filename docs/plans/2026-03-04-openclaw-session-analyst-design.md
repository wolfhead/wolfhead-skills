# OpenClaw Session Analyst — Design

**Date**: 2026-03-04
**Status**: Approved

## Goal

Create a new `openclaw-session-analyst` skill that analyzes OpenClaw session transcripts. Separate from the existing `session-analyst` (Claude Code) because the formats differ significantly — OpenClaw has cost tracking, multi-model switching, channel metadata, and tree-structured conversations that don't map cleanly to Claude Code's schema.

## Directory Structure

```
skills/openclaw-session-analyst/
├── SKILL.md                       # Orchestration: search → extract → analyze → report
├── scripts/
│   ├── search_sessions.py         # Find OpenClaw sessions by agent/date/recency
│   ├── extract_session.py         # Parse OpenClaw JSONL → condensed JSON
│   └── test_extract.py            # Tests
```

No shared code with `session-analyst/` — each skill evolves independently.

## OpenClaw Session Format Summary

Reference: `docs/openclaw-session-format.md`

- **Storage**: `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`
- **Format**: JSONL, append-only, tree structure via `id`/`parentId` (8-char hex IDs)
- **Entry types**: `session`, `message`, `model_change`, `thinking_level_change`, `custom`, `compaction`
- **Message roles**: `user`, `assistant`, `toolResult` (separate role, not embedded in user)
- **Assistant content**: Single entry with all blocks (text + toolCall), not split across records
- **Tool calls**: `type: "toolCall"`, `arguments` field (vs Claude Code's `"tool_use"` / `"input"`)
- **Cost data**: `usage.cost.{input, output, cacheRead, cacheWrite, total}` on each assistant message
- **Session lifecycle**: Active `.jsonl`, reset `.jsonl.reset.*`, deleted `.jsonl.deleted.*`
- **Metadata store**: `sessions.json` with cumulative token/cost counters per session key

## Output Schema (extract_session.py)

```json
{
  "platform": "openclaw",
  "metadata": {
    "session_id": "1a3870de-...",
    "agent_id": "main",
    "cwd": "/Users/me/.openclaw/workspace",
    "first_timestamp": "2026-03-02T00:24:52.172Z",
    "last_timestamp": "2026-03-02T07:31:28.099Z",
    "models_used": ["claude-opus-4-5-20251101", "deepseek-chat"],
    "providers_used": ["jiekou-opus", "custom-api-deepseek-com"],
    "total_cost": 0.423,
    "input_tokens": 1500,
    "output_tokens": 8400,
    "cache_read_tokens": 0,
    "cache_write_tokens": 15457,
    "turn_count": 12,
    "channel": "discord",
    "chat_type": "group"
  },
  "cost_by_model": {
    "claude-opus-4-5-20251101": {
      "input": 0.01,
      "output": 0.35,
      "cache_read": 0,
      "cache_write": 0.06,
      "total": 0.42,
      "turn_count": 8
    },
    "deepseek-chat": {
      "input": 0.001,
      "output": 0.002,
      "cache_read": 0,
      "cache_write": 0,
      "total": 0.003,
      "turn_count": 4
    }
  },
  "model_switches": [
    {
      "timestamp": "2026-03-04T00:24:05.074Z",
      "from_model": "claude-opus-4-5-20251101",
      "from_provider": "jiekou-opus",
      "to_model": "deepseek-chat",
      "to_provider": "custom-api-deepseek-com"
    }
  ],
  "conversation": [
    {
      "type": "human_message",
      "text": "hi",
      "sender": "Jojo Wolf"
    },
    {
      "type": "assistant_turn",
      "text": "Hey, what can I help with?",
      "tool_calls": [],
      "model": "claude-opus-4-5-20251101",
      "provider": "jiekou-opus",
      "cost": 0.06
    },
    {
      "type": "assistant_turn",
      "text": "",
      "tool_calls": [
        {
          "tool_call_id": "toolu_bdrk_019apiUh3MLUKNQK95aM5WX5",
          "name": "read",
          "arguments": {"path": "/path/to/file"}
        }
      ],
      "model": "claude-opus-4-5-20251101",
      "provider": "jiekou-opus",
      "cost": 0.03
    },
    {
      "type": "tool_result",
      "tool_call_id": "toolu_bdrk_019apiUh3MLUKNQK95aM5WX5",
      "tool_name": "read",
      "is_error": false,
      "content_preview": "file contents..."
    }
  ],
  "tool_failures": [
    {
      "tool_call_id": "toolu_...",
      "tool_name": "read",
      "content_preview": "ENOENT: no such file..."
    }
  ],
  "compactions": [
    {
      "timestamp": "2026-03-02T07:31:28.099Z",
      "tokens_before": 52575,
      "summary_preview": "## Goal\nResearch methods to...",
      "read_files": ["/path/to/MEMORY.md"],
      "modified_files": [],
      "from_hook": true
    }
  ]
}
```

### Key differences from Claude Code schema

| Field | OpenClaw | Claude Code |
|-------|----------|-------------|
| `cost_by_model` | Per-model cost breakdown | Not present |
| `model_switches` | Timeline of model changes | Not present |
| `conversation[].sender` | Channel sender name | Not present |
| `conversation[].model` | Model per assistant turn | Not present |
| `conversation[].cost` | Cost per assistant turn | Not present |
| `compactions[].read_files` | Files read in compacted portion | Not present |
| `compactions[].from_hook` | Hook-triggered compaction | `trigger` field |
| `skills` | Not present | Skill invocations |
| `subagents` | Not present | Agent/Task dispatches |
| `api_errors` | Not present | API retry errors |
| `slug` | Not present | Human-readable session name |

## Search Script (search_sessions.py)

```
python3 search_sessions.py --agent main --latest 5 --min-turns 3
python3 search_sessions.py --agent main --date 2026-03-02
python3 search_sessions.py --agent main --since 2026-03-01
python3 search_sessions.py --latest 5  # searches all agents
```

- Searches `~/.openclaw/agents/<agent>/sessions/`
- Filters out `.reset.*` and `.deleted.*` by default (`--include-reset` to include)
- Counts `role: "user"` messages for `turn_count`
- Returns same shape: `[{"path", "session_id", "agent_id", "modified", "size_bytes", "turn_count"}]`

## SKILL.md Pipeline

4-step orchestration (same pattern as Claude Code skill):

1. **Search** — `search_sessions.py` with args mapped from user request
2. **Extract** — `extract_session.py` for each session → `/tmp/openclaw-session-analyst/<session-id>/main.json`
3. **Dispatch subagent analysts** — reuse `session-subagent-analyst` skill (format-agnostic, reads condensed JSON)
4. **Synthesize report** — merge, write to `docs/reviews/YYYY-MM-DD-openclaw-sessions-review.md`

### Report Template

```markdown
# OpenClaw Session Analysis Report
**Date**: YYYY-MM-DD | **Sessions analyzed**: N | **Agent**: main

---

## 1. Cost Analysis

| Model | Turns | Input | Output | Cache | Total |
|-------|-------|-------|--------|-------|-------|
| claude-opus-4-5 | 8 | $0.01 | $0.35 | $0.06 | $0.42 |

**Model switching patterns**: <observations>
**Cost efficiency**: <recommendations>

---

## 2. Anti-patterns
(same format as Claude Code skill)

---

## 3. User Preferences
(same format as Claude Code skill)

---

## 4. Gaps
(same format as Claude Code skill)

---

## 5. Tool Usage
(same format as Claude Code skill)
```

## Decisions

- **Separate skill** — OpenClaw format is different enough that forcing unified schema would lose the most valuable data (cost, multi-model)
- **No shared code** — keeps both skills independently evolvable
- **Reuse subagent-analyst** — the analysis checklist is format-agnostic (it reads condensed JSON regardless of source platform)
- **OpenClaw-native field names** — `toolCall`/`toolResult`/`toolCallId` in JSONL but normalized to snake_case in output JSON for consistency
