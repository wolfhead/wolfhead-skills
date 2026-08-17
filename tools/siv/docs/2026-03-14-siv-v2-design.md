# SIV v2 Design Spec

**Date**: 2026-03-14
**Status**: Draft

## What SIV Does

SIV extracts reusable decision rules from agent work records. It deduplicates, quality-filters, and stores them as persistent rules that get injected into future agent sessions via hooks.

SIV does not know or care about other knowledge systems (playbooks, retros, domain_knowledge). It only reads work records and produces rules.

## Changes from v1

### 1. Rename

Global rename across types, commands, storage, and ID prefixes.

| v1 | v2 | Notes |
|---|---|---|
| `Finding` | `Insight` | Type name |
| `Promotion` | `Rule` | Type name |
| `finding_ids` | `insight_ids` | Field in Rule |
| `findings.jsonl` | `insights.jsonl` | Storage file |
| `promotions.jsonl` | `rules.jsonl` | Storage file |
| `LRN-` / `ERR-` prefix | `INS-` | Insight IDs |
| `PRM-` prefix | `RUL-` | Rule IDs |
| `promote_finding` command | `consolidate` | CLI command (manual, single insight) |
| `run_promotion` command | `run` | CLI command (batch pipeline) |
| `claude-code` source | `claude-code-session` | Source adapter name |
| `SIV_PROMOTE_*` env vars | `SIV_CONSOLIDATE_*` | Config variables |
| `promoteModel` etc. in config | `consolidateModel` etc. | Internal config fields |

### 2. Source Adapter Architecture

Decouple session parsing from the `analyze` command. Each source adapter conforms to a common interface:

```typescript
interface SourceAdapter {
  name: string;

  // Find unprocessed items, return metadata for scan tracking
  scan(config: ScanOptions): Promise<ScanCandidate[]>;

  // Extract condensed text from a candidate, ready for LLM analysis
  extract(candidate: ScanCandidate): Promise<ExtractedSession>;
}

interface ScanCandidate {
  id: string;           // unique identifier for dedup (file path, session id, etc.)
  source: string;       // adapter name
  metadata: Record<string, unknown>;  // date, agent, project, etc.
}

interface ExtractedSession {
  id: string;
  source: string;
  project?: string;
  project_path?: string;
  condensed: string;    // text for LLM to analyze
  metadata: Record<string, unknown>;
}
```

#### claude-code-session adapter

Existing logic from `sessions/search.ts` + `sessions/extract.ts`, wrapped in the adapter interface. No functional changes — just restructured.

#### daily-notes adapter

New adapter for markdown daily notes (e.g., Scout's `memory/YYYY-MM-DD.md`).

**Scan**: List `*.md` files matching date pattern in configured directory. Skip already-scanned via `scans.jsonl` — dedup key is file path + content hash (not just mtime, since daily notes may be appended to throughout the day). If content hash changes since last scan, re-scan the file. Skip files under 200 bytes (empty or metadata-only).

**Extract**: Read markdown content, prepend metadata header (date, agent name, source path), return as condensed text. Markdown is already human/LLM-readable — no complex parsing needed.

**Scan record schema** (extends existing `scans.jsonl` with `source` field for multi-adapter world):

```typescript
interface ScanRecord {
  scanned_at: string;
  source: string;        // "claude-code-session" | "daily-notes"
  session_id: string;    // session ID or file path
  file_modified: string;
  file_size_bytes: number;
  content_hash?: string; // for daily-notes: detect mid-day appends
  line_count: number;
  project?: string;
  project_path?: string;
  insights_count: number;
  chunks: number;
  status: string;
}
```

### 3. Old Data Cleanup

Delete all v1 `~/.siv/*.jsonl` files during implementation. No migration, no backup — data can be regenerated from sessions at any time.

### 4. Emotion Markers

Inspired by how human memory works — we remember moments of pain, joy, and correction more strongly than routine events. Emotion markers let agents flag significant moments during a session, giving SIV's `analyze` step high-signal anchors instead of blindly scanning entire sessions.

#### How it works

**Write path (during session):**

A skill teaches the agent to call `siv mark` at emotionally significant moments:

```bash
siv mark frustration "第三次查错日志了，工具不支持按小时过滤"
siv mark correction "用户纠正：对比不同日期必须用同时段"
siv mark breakthrough "终于理解了这个计费模型的盈亏公式"
```

`siv mark` is nearly a no-op — it prints "marked" and exits. Its only purpose is to leave a trace in the session record (Claude Code logs all tool calls to session JSONL; Scout can write a marker line to daily notes).

**Marker types:**

| Type | When | Signal |
|---|---|---|
| `frustration` | Agent is stuck, retrying, hitting dead ends | Process/tool gap |
| `correction` | User corrects agent's approach or conclusion | Knowledge/process gap |
| `breakthrough` | Agent figures something out after struggle | Valuable new knowledge |
| `surprise` | Data or behavior is unexpected | Potential insight |

**Read path (during analyze):**

The extraction step detects markers and promotes them to a first-class field:

```typescript
// Added to SessionExtraction (claude-code-session adapter)
interface EmotionMarker {
  type: string;          // frustration, correction, breakthrough, surprise
  context: string;       // the free-text from the siv mark call
  turn_index: number;    // position in conversation for context windowing
}

// SessionExtraction gains:
emotion_markers: EmotionMarker[];
```

For `claude-code-session`: markers are found by scanning `AssistantTurn.tool_calls` where `name === "Bash"` and `input.command` starts with `siv mark`. The tool result is irrelevant (always "marked").

The `analyze` step changes strategy based on whether markers exist:

```
Session WITH markers:
  1. For each marker, extract a context window:
     5 human turns before + 2 human turns after the marker.
     Merge overlapping windows.
     Deduplicate markers of same type within 3 turns of each other.
  2. Send markers + context windows to LLM with a focused prompt
     ("analyze the flagged moments and their surrounding context").

Session WITHOUT markers:
  Full session scan (current behavior, unchanged).
```

Binary strategy: markers exist → focused analysis only; no markers → full scan. No "lower priority" partial scan.

**For daily-notes adapter:**

Scout writes markers as a single HTML comment with context as attribute:

```markdown
<!-- siv:mark type="correction" context="用户纠正：对比不同日期必须用同时段" -->
```

The daily-notes adapter extracts these markers. The surrounding markdown section (from the nearest `##` heading above to the next heading) serves as the context window.

#### `siv mark` CLI command

```
siv mark <type> [context]
    Record an emotion marker. Prints "marked" to stdout and exits.
    type: frustration | correction | breakthrough | surprise
    context: optional free-text description

    In Claude Code: the Bash tool call appears in session JSONL.
    In daily notes: agent writes an HTML comment marker.
    No file I/O, no network calls, no side effects.
```

#### Emotion skill

A skill (for Claude Code and OpenClaw) that teaches the agent when and how to use `siv mark`. The skill itself is small — it's guidance, not logic:

- When you hit a dead end or retry something > 2 times → `siv mark frustration`
- When a user corrects your approach → `siv mark correction`
- When you solve something after struggle → `siv mark breakthrough`
- When data surprises you → `siv mark surprise`

The skill should be lightweight and not interrupt the agent's primary task. A mark call takes <100ms and the agent continues immediately.

### 5. No Memory File Writer

SIV does NOT write to MEMORY.md or any agent memory file. The delivery mechanism is:

```
rules.jsonl (source of truth)
    ↓
siv retrieve [--project X] (query active rules)
    ↓
hook injects rules into agent session context at startup
```

This keeps SIV decoupled from any specific agent's file layout. Future enhancements (project-scoped filtering, relevance ranking, RAG indexing) happen at the `retrieve` layer.

## CLI Commands (v2)

```
siv analyze [--source claude-code-session|daily-notes]
    Scan source for new sessions/notes, extract insights via LLM.
    Default source: claude-code-session (backward compatible).

siv group
    Semantically group similar insights using LLM.

siv run
    Main pipeline: group → distill → consolidate (batch).
    Internally: groups pending insights, distills each group into a candidate rule,
    then for each candidate, runs the consolidate prompt (create/merge/supersede/skip
    against existing rules). This is the command cron calls.

siv consolidate <insight-id>
    Manually consolidate a single insight into a rule (skips group/distill,
    goes straight to the consolidate prompt against existing rules).

siv retrieve [--project X] [--global]
    Output active rules for hook injection.
    --project X: rules scoped to project X.
    --global: all active rules regardless of scope.
    No flags: returns all active rules (v2 default change from v1).

siv status
    Statistics overview (insights by status/category, pending age, recent rules).

siv doctor
    Config and connectivity checks.

siv log
    Manually record an insight.

siv mark <type> [context]
    Record an emotion marker. Prints "marked" and exits.
    Types: frustration, correction, breakthrough, surprise.
    Unknown types are accepted silently (no validation).
    No file I/O, no network calls, no side effects.
```

## Configuration

```env
# ~/.siv/.env

# LLM (unchanged)
SIV_API_KEY=...
SIV_API_BASE=https://api.ppio.com/openai
SIV_MODEL=qwen/qwen3.5-plus

# Optional: separate model for consolidation step
SIV_CONSOLIDATE_API_KEY=...
SIV_CONSOLIDATE_API_BASE=...
SIV_CONSOLIDATE_MODEL=...

# Source: daily-notes
SIV_DAILYNOTES_PATH=~/.openclaw/workspace-Scout/memory
SIV_DAILYNOTES_PATTERN=YYYY-MM-DD.md
```

## Pipeline (unchanged logic, new names)

```
Source Adapter
    ↓ scan + extract
Condensed session text (with emotion markers if present)
    ↓ LLM (analyze prompt — markers guide focus)
Insights (INS-YYYYMMDD-xxx)
    ↓ LLM (group prompt)
Semantic groups
    ↓ LLM (distill prompt + quality gate)
Distilled rules
    ↓ LLM (consolidate prompt: create/merge/supersede/skip)
Rules (RUL-YYYYMMDD-xxx)
    ↓ retrieve
Hook injection into agent context
```

Quality gate criteria (unchanged):
- Reject one-time config fixes
- Reject code-level fixes (specific to one file/function)
- Reject vague rules without actionable "when X, do Y" structure
- Reject rules that only apply to a single incident

## Cron Usage

```bash
# On Mac Mini, via OpenClaw cron or system crontab
# Daily: scan Scout's daily notes and run full pipeline
siv analyze --source daily-notes && siv run
```

## v2 Implementation Scope

**In scope (this round):**
1. Global rename (Finding→Insight, Promotion→Rule, commands, IDs, config)
2. Source adapter architecture (extract interface, wrap existing logic as `claude-code-session`)
3. Emotion markers (`siv mark` CLI, extraction-layer detection, analyze focus strategy)
4. Old data cleanup (delete v1 JSONL files)

**Deferred (architecture ready, implement later):**
- daily-notes adapter (same adapter interface, new parser)
- OpenClaw session adapter (same pattern)
- RAG indexing (retrieve layer can be extended)
- Structured/scenario-based memory format (rules.jsonl schema can evolve)
- Time-based decay/scoring (scoring.ts can be extended)
- Cross-agent rule sharing (retrieve can filter by agent)
