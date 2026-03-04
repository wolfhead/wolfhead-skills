# OpenClaw Session File Format Reference

## Overview

OpenClaw stores conversation sessions as JSONL (JSON Lines) files. Each line is a single JSON object representing one entry. Entries are appended chronologically and form a **tree structure** via `id`/`parentId` links (unlike Claude Code's linear `uuid`/`parentUuid` chain).

## File Locations

### Session Metadata Store
```
~/.openclaw/agents/<agentId>/sessions/sessions.json
```
- A mutable key-value map: `sessionKey → SessionEntry`
- Keys follow patterns like `agent:<agentId>:<channel>:<type>:<peerId>`

### Transcript Files
```
~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
```
- Active sessions: `<uuid>.jsonl`
- Reset sessions: `<uuid>.jsonl.reset.<ISO-timestamp>`
- Deleted sessions: `<uuid>.jsonl.deleted.<ISO-timestamp>`
- Telegram topic sessions: `<uuid>-topic-<threadId>.jsonl`

### Subagent Runs
```
~/.openclaw/subagents/runs.json
```

---

## Session Key Patterns

| Pattern | Use Case |
|---------|----------|
| `agent:<agentId>:main` | Default/webchat direct session |
| `agent:<agentId>:discord:direct:<peerId>` | Discord DM |
| `agent:<agentId>:discord:channel:<channelId>` | Discord channel |
| `agent:<agentId>:<channel>:group:<id>` | Group chat |
| `cron:<job.id>` | Cron job session |
| `hook:<uuid>` | Webhook session |

---

## SessionEntry (sessions.json value)

Each entry in `sessions.json` maps a session key to metadata:

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` (UUID) | Current transcript file ID |
| `updatedAt` | `number` (epoch ms) | Last activity timestamp |
| `systemSent` | `boolean` | Whether system prompt has been sent |
| `abortedLastRun` | `boolean` | Whether the last run was aborted |
| `model` | `string` | Current model ID (e.g., `"claude-sonnet-4-5-20250929"`) |
| `modelProvider` | `string` | Provider key (e.g., `"jiekou-sonnet"`) |
| `origin` | `object` | `{provider, surface, chatType, label?, from?, to?, accountId?, threadId?}` |
| `lastChannel` | `string` | Channel name (e.g., `"discord"`, `"webchat"`) |
| `chatType` | `string` | `"direct"` or `"group"` |
| `skillsSnapshot` | `object` | Available skills at session creation |
| `deliveryContext` | `object` | Delivery routing context |
| `sessionFile` | `string` | Override transcript filename (if set) |
| `compactionCount` | `number` | Number of compactions performed |
| `systemPromptReport` | `object` | System prompt metadata |
| `totalTokensFresh` | `number` | Total tokens from fresh (non-cached) input |
| `inputTokens` | `number` | Cumulative input tokens |
| `outputTokens` | `number` | Cumulative output tokens |
| `cacheRead` | `number` | Cumulative cache read tokens |
| `cacheWrite` | `number` | Cumulative cache write tokens |
| `contextTokens` | `number` | Current context window tokens |
| `totalTokens` | `number` | Cumulative total tokens |
| `memoryFlushAt` | `number` | Timestamp of last memory flush |
| `memoryFlushCompactionCount` | `number` | Compaction count at last memory flush |
| `displayName` | `string` | Human-readable session label (group chats) |
| `channel` | `string` | Channel identifier |
| `groupId` | `string` | Group/guild ID |
| `groupChannel` | `string` | Group channel name |
| `space` | `string` | Space/guild name |

---

## Entry Types (JSONL Transcript)

6 top-level entry types, identified by the `type` field:

| type | Description | Count (typical) |
|------|-------------|-----------------|
| `session` | Session header (always first line) | 1 |
| `message` | User, assistant, or tool result messages | Many |
| `model_change` | Model/provider switch event | 0+ |
| `thinking_level_change` | Thinking mode toggle | 0+ |
| `custom` | Extension-injected state (does NOT enter model context) | 0+ |
| `compaction` | Conversation summary + pruning marker | 0+ |

---

## Common Entry Fields

All entries (except `session` header) share:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | Entry type discriminator |
| `id` | `string` (8-char hex) | Unique entry ID (e.g., `"efc83c92"`) |
| `parentId` | `string \| null` | Parent entry ID in the conversation tree |
| `timestamp` | `string` (ISO 8601) | When the entry was created |

**Key difference from Claude Code:** OpenClaw uses short 8-char hex IDs (not UUID4), and the tree structure allows **branching** (multiple entries can share the same `parentId`).

---

## 1. `type: "session"`

Session header. Always the first line. Does NOT have `id`/`parentId`.

```json
{
  "type": "session",
  "version": 3,
  "id": "1a3870de-6722-430c-8c2b-709f4fb9a0f9",
  "timestamp": "2026-03-03T12:53:06.027Z",
  "cwd": "/Users/me/.openclaw/workspace"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | Schema version (currently `3`) |
| `id` | `string` (UUID) | Session ID (matches filename) |
| `cwd` | `string` | Working directory |
| `timestamp` | `string` | Session creation time |
| `parentSession` | `string` (optional) | Parent session reference (for forked sessions) |

---

## 2. `type: "message"`

The primary entry type. Serves three purposes via `message.role`:

### Variant A: User message (`role: "user"`)

```json
{
  "type": "message",
  "id": "8c9cb00a",
  "parentId": "a625ffa9",
  "timestamp": "2026-03-02T00:24:52.273Z",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "The user's message text..."
      }
    ],
    "timestamp": 1772411092269
  }
}
```

User messages may include conversation metadata (sender info, channel context) wrapped in untrusted content tags.

### Variant B: Assistant message (`role: "assistant"`)

```json
{
  "type": "message",
  "id": "6de88ac8",
  "parentId": "efc83c92",
  "timestamp": "2026-03-03T12:53:09.955Z",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "Here is my response..."
      }
    ],
    "api": "anthropic-messages",
    "provider": "jiekou-sonnet",
    "model": "claude-sonnet-4-5-20250929",
    "usage": {
      "input": 3,
      "output": 84,
      "cacheRead": 0,
      "cacheWrite": 15606,
      "totalTokens": 15693,
      "cost": {
        "input": 9e-06,
        "output": 0.00126,
        "cacheRead": 0,
        "cacheWrite": 0.0585225,
        "total": 0.0597915
      }
    },
    "stopReason": "stop",
    "timestamp": 1772542386032
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message.api` | `string` | API format used (`"anthropic-messages"`, `"openai-responses"`, `"openai-completions"`) |
| `message.provider` | `string` | Provider key (e.g., `"jiekou-opus"`, `"openclaw"`) |
| `message.model` | `string` | Model ID |
| `message.usage` | `object` | Token usage with cost breakdown |
| `message.stopReason` | `string` | `"stop"` (natural end) or `"toolUse"` (tool call pending) |
| `message.timestamp` | `number` (epoch ms) | Provider-level timestamp |

**Key difference from Claude Code:** OpenClaw stores the **entire assistant response in a single entry** — all content blocks (text + tool calls) are in one `content` array. Claude Code splits each content block into a separate JSONL record sharing the same `message.id`.

### Assistant Content Block Types

**Text block:**
```json
{"type": "text", "text": "Response text..."}
```

**Tool call block:**
```json
{
  "type": "toolCall",
  "id": "toolu_bdrk_019apiUh3MLUKNQK95aM5WX5",
  "name": "read",
  "arguments": {
    "path": "/path/to/file"
  }
}
```

Note: Uses `"toolCall"` (camelCase) and `"arguments"` instead of Claude Code's `"tool_use"` and `"input"`.

### Variant C: Tool result (`role: "toolResult"`)

```json
{
  "type": "message",
  "id": "d9280a7c",
  "parentId": "be563783",
  "timestamp": "2026-03-02T00:24:56.888Z",
  "message": {
    "role": "toolResult",
    "toolCallId": "toolu_bdrk_019apiUh3MLUKNQK95aM5WX5",
    "toolName": "read",
    "content": [
      {
        "type": "text",
        "text": "{\"status\": \"error\", \"tool\": \"read\", \"error\": \"ENOENT: ...\"}"
      }
    ],
    "details": {
      "status": "error",
      "tool": "read",
      "error": "ENOENT: no such file or directory, access '/path/to/file'"
    },
    "isError": false,
    "timestamp": 1772411096883
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message.role` | `"toolResult"` | Distinct role (Claude Code uses `role: "user"` with `tool_result` content blocks) |
| `message.toolCallId` | `string` | References the `id` from the assistant's `toolCall` block |
| `message.toolName` | `string` | Tool name (e.g., `"read"`, `"exec"`, `"web_search"`) |
| `message.details` | `object` | Structured result metadata |
| `message.isError` | `boolean` | Whether the tool execution itself errored |

### Available Tools

| Tool Name | Description |
|-----------|-------------|
| `read` | Read file |
| `write` | Write file |
| `edit` | Edit file |
| `exec` | Execute shell command |
| `web_search` | Web search (Brave) |
| `web_fetch` | Fetch URL |
| `browser` | Browser automation |
| `message` | Send message to channel |
| `memory_search` | Search agent memory |
| `session_status` | Get current session info |
| `sessions_list` | List sessions |
| `cron` | Manage cron jobs |
| `process` | Process management |

---

## 3. `type: "model_change"`

Emitted when the model or provider changes mid-session.

```json
{
  "type": "model_change",
  "id": "290ff222",
  "parentId": null,
  "timestamp": "2026-03-03T12:53:06.027Z",
  "provider": "jiekou-sonnet",
  "modelId": "claude-sonnet-4-5-20250929"
}
```

**No Claude Code equivalent.** Claude Code records model info within each assistant message.

---

## 4. `type: "thinking_level_change"`

Records changes to the thinking/reasoning mode.

```json
{
  "type": "thinking_level_change",
  "id": "9c143795",
  "parentId": "290ff222",
  "timestamp": "2026-03-03T12:53:06.027Z",
  "thinkingLevel": "off"
}
```

**No Claude Code equivalent.** Claude Code embeds thinking in `thinkingMetadata` on user messages.

---

## 5. `type: "custom"`

Extension-injected state that does **not** enter model context. Discriminated by `customType`.

### `customType: "model-snapshot"`

Captures the active model configuration at a point in time.

```json
{
  "type": "custom",
  "customType": "model-snapshot",
  "data": {
    "timestamp": 1772542386028,
    "provider": "jiekou-opus",
    "modelApi": "anthropic-messages",
    "modelId": "claude-opus-4-5-20251101"
  },
  "id": "9bba9116",
  "parentId": "9c143795",
  "timestamp": "2026-03-03T12:53:06.028Z"
}
```

There may also be `customType: "custom_message"` entries that **do** enter model context (per docs), though none were observed in the sampled sessions.

---

## 6. `type: "compaction"`

Persists a conversation summary when context approaches limits. Marks a pruning boundary.

```json
{
  "type": "compaction",
  "id": "b7c55d1f",
  "parentId": "49990448",
  "timestamp": "2026-03-02T07:31:28.099Z",
  "summary": "## Goal\nResearch methods to obtain real-time research reports...",
  "firstKeptEntryId": "15ecf359",
  "tokensBefore": 52575,
  "details": {
    "readFiles": ["/path/to/MEMORY.md", "/path/to/other.md"],
    "modifiedFiles": []
  },
  "fromHook": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `summary` | `string` | Structured markdown summary of compacted conversation |
| `firstKeptEntryId` | `string` | ID of the first entry retained after compaction |
| `tokensBefore` | `number` | Context size before compaction |
| `details.readFiles` | `string[]` | Files read during the compacted portion |
| `details.modifiedFiles` | `string[]` | Files modified during the compacted portion |
| `fromHook` | `boolean` | Whether compaction was triggered by a hook (vs auto) |

---

## Key Structural Differences: OpenClaw vs Claude Code

| Aspect | OpenClaw | Claude Code |
|--------|----------|-------------|
| **Entry IDs** | 8-char hex (`"efc83c92"`) | UUID4 (`"3b3422e9-..."`) |
| **Conversation shape** | Tree (branching via shared `parentId`) | Linear chain (`uuid`/`parentUuid`) |
| **Assistant responses** | Single entry with all content blocks | Split across multiple entries sharing `message.id` |
| **Tool results** | Dedicated `role: "toolResult"` | Embedded in `role: "user"` with `type: "tool_result"` content |
| **Tool calls** | `type: "toolCall"`, `arguments` field | `type: "tool_use"`, `input` field |
| **Model tracking** | Separate `model_change` + `custom(model-snapshot)` entries | Model info on each assistant `message` object |
| **Thinking** | Separate `thinking_level_change` entry | `thinkingMetadata` on user messages + `thinking` content blocks |
| **Compaction** | `compaction` entry with structured summary + file tracking | `system` entry with `subtype: "compact_boundary"` |
| **Session header** | `type: "session"` with `version` field | No explicit header; metadata in common fields |
| **Progress/streaming** | Not persisted in transcript | `type: "progress"` entries for bash, agent, search |
| **File snapshots** | Not present | `type: "file-history-snapshot"` for undo |
| **Usage/cost** | Inline on assistant message (`usage.cost`) | Inline on assistant message (`usage`) — no cost field |
| **Token counts** | Also tracked in `sessions.json` metadata | Only in JSONL records |
| **Subagent files** | Not observed (subagents tracked via `runs.json`) | Separate `subagents/agent-<id>.jsonl` files |
| **Session lifecycle** | Rename to `.reset.*` / `.deleted.*` suffix | Sessions remain as-is |

---

## Conversation Chain Reconstruction

1. Parse all JSONL lines into entries
2. The first entry (`type: "session"`) is the header — extract session metadata
3. Build a tree using `id` → `parentId` links
4. Walk the tree from root entries (`parentId: null`) following the primary path
5. At `compaction` entries, skip to `firstKeptEntryId` for the kept portion
6. Group `toolCall` blocks in assistant content with their corresponding `toolResult` entries (matched by `toolCallId`)
7. `custom` entries are out-of-band metadata — skip for conversation replay
8. `model_change` and `thinking_level_change` affect subsequent entries but aren't conversation content

### Key Relationships
- `toolCall.id` in assistant content → matches `toolResult.toolCallId` in subsequent message
- `compaction.firstKeptEntryId` → ID of the oldest retained entry after pruning
- `model_change.modelId` → active model for subsequent assistant messages
- `custom(model-snapshot).data.modelId` → point-in-time model configuration
