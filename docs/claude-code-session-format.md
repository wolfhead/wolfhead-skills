# Claude Code Session File Format Reference

## Overview

Claude Code stores conversation sessions as JSONL (JSON Lines) files. Each line is a single JSON object representing one record. Records are appended chronologically.

## File Locations

### Parent Session
```
~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
```
- Project path: absolute path with `/` replaced by `-` (e.g., `/Users/me/work/myproject` → `-Users-me-work-myproject`)
- Session filename: UUID4 (e.g., `4842e703-b98d-400e-aa9f-98aaf9489ace.jsonl`)

### Subagent Files
```
~/.claude/projects/<encoded-project-path>/<parent-session-uuid>/subagents/agent-<agent-id>.jsonl
```
- Lives in a `subagents/` directory under the parent session UUID
- Filename uses the short agent ID (e.g., `agent-ab72d42.jsonl`)

---

## Record Types

8 top-level record types, identified by the `type` field:

| type | Description |
|------|-------------|
| `assistant` | Model response (streamed in chunks) |
| `progress` | In-flight operation updates (bash, agent, hook) |
| `user` | User input or tool results fed back to the model |
| `file-history-snapshot` | File backup state for undo |
| `system` | System events (turn end, errors, compaction) |
| `saved_hook_context` | Injected hook/skill context |
| `queue-operation` | User input queued while model is running |
| `summary` | Conversation summary metadata |

---

## Common Fields

Most records (except `file-history-snapshot`, `summary`, `queue-operation`, and `saved_hook_context`) share these fields:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | Record type discriminator |
| `uuid` | `string` (UUID4) | Unique ID for this record |
| `parentUuid` | `string \| null` | UUID of the preceding record in the conversation chain. `null` for the first record or after compaction. |
| `sessionId` | `string` (UUID4) | The session this record belongs to. For subagents, this is the **parent session ID**. |
| `timestamp` | `string` (ISO 8601) | When the record was created |
| `isSidechain` | `boolean` | `false` for main conversation, `true` for subagent conversations |
| `cwd` | `string` | Working directory at the time of the record |
| `gitBranch` | `string` | Current git branch |
| `version` | `string` | Claude Code CLI version |
| `userType` | `string` | Always `"external"` |
| `slug` | `string` (optional) | Human-readable session identifier (e.g., `"sprightly-zooming-kitten"`) |

Subagent records additionally have:

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `string` | Short hex ID of the subagent (e.g., `"ab72d42"`) |

---

## 1. `type: "user"`

Serves two purposes: (a) human-typed messages, and (b) tool result feedback.

### Variant A: Human-typed message

```json
{
  "type": "user",
  "uuid": "3b3422e9-...",
  "parentUuid": "afcf8759-...",
  "sessionId": "4842e703-...",
  "timestamp": "2026-02-09T03:18:09.566Z",
  "isSidechain": false,
  "cwd": "/Users/me/work/project",
  "gitBranch": "HEAD",
  "version": "2.1.37",
  "userType": "external",
  "message": {
    "role": "user",
    "content": "the user's typed text..."
  },
  "thinkingMetadata": {
    "maxThinkingTokens": 31999
  },
  "todos": [],
  "permissionMode": "default"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message.content` | `string \| array` | The user's input. Either a plain string (interactive CLI) or an array of content blocks `[{type: "text", text: "..."}]` (Agent SDK / programmatic callers). May contain XML tags for commands. |
| `thinkingMetadata` | `object` (optional) | Present on turn-initiating messages. |
| `todos` | `array` (optional) | Task list state. Usually `[]`. |
| `permissionMode` | `string` (optional) | Permission level: `"default"` or other modes. |

**Content block format (when array):**
```json
{
  "message": {
    "role": "user",
    "content": [
      {"type": "text", "text": "the user's typed text..."}
    ]
  }
}
```
This format is used by the Claude Agent SDK (`query()`) and programmatic callers. Interactive CLI sessions typically use the plain string format.

### Variant B: Tool result feedback

```json
{
  "type": "user",
  "uuid": "0db68cd9-...",
  "parentUuid": "35174aaf-...",
  "sessionId": "4842e703-...",
  "timestamp": "2026-02-09T03:21:17.875Z",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_018XCyJNy7NfiHm1qvgGKEL9",
        "type": "tool_result",
        "content": "The script ran successfully...",
        "is_error": false
      }
    ]
  },
  "sourceToolAssistantUUID": "b084dcef-...",
  "toolUseResult": { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message.content` | `array` | Array containing one `tool_result` object |
| `message.content[].type` | `"tool_result"` | Always `"tool_result"` |
| `message.content[].tool_use_id` | `string` | References the `id` from the assistant's `tool_use` block |
| `message.content[].content` | `string \| array` | The tool output. Plain string or array of `{type: "text", text: "..."}` |
| `message.content[].is_error` | `boolean` (optional) | `true` if the tool execution failed |
| `sourceToolAssistantUUID` | `string` | UUID of the assistant record that contained the `tool_use` request |
| `toolUseResult` | `object` (optional) | Extended metadata about the tool result |

**`toolUseResult` variants:**

Synchronous Task completion:
```json
{"status": "completed", "prompt": "The user wants to..."}
```

Async Task launch:
```json
{
  "isAsync": true,
  "status": "async_launched",
  "agentId": "a66c2a4",
  "description": "Implement Task 2",
  "prompt": "You are implementing...",
  "outputFile": "/private/tmp/claude-501/.../tasks/a66c2a4.output"
}
```

**Error tool results:**
```json
{
  "type": "tool_result",
  "content": "<tool_use_error>File does not exist.</tool_use_error>",
  "is_error": true,
  "tool_use_id": "toolu_012vBkNajNzWeWsbHnzn7bNz"
}
```

---

## 2. `type: "assistant"`

Model response records. A single API response is **split across multiple JSONL records** — each record contains one content block. They share the same `message.id` but have different `uuid` values chained via `parentUuid`.

```json
{
  "type": "assistant",
  "uuid": "353b5fdd-...",
  "parentUuid": "3b3422e9-...",
  "sessionId": "4842e703-...",
  "timestamp": "2026-02-09T03:18:12.882Z",
  "requestId": "req_011CXwmiMDG4aHqk3VmZUnaV",
  "message": {
    "model": "claude-opus-4-6",
    "id": "msg_01THwwJHRNKSXdqZ9Wha2GHG",
    "type": "message",
    "role": "assistant",
    "content": [ ... ],
    "stop_reason": null,
    "stop_sequence": null,
    "usage": { ... }
  }
}
```

**`usage` object:**
```json
{
  "input_tokens": 3,
  "cache_creation_input_tokens": 5658,
  "cache_read_input_tokens": 21670,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 0,
    "ephemeral_1h_input_tokens": 5658
  },
  "output_tokens": 12,
  "service_tier": "standard",
  "inference_geo": "not_available"
}
```

### Content Block Types

Each assistant record's `content` array contains exactly one block:

**Text block:**
```json
{"type": "text", "text": "Here is my response..."}
```

**Thinking block (extended thinking):**
```json
{
  "type": "thinking",
  "thinking": "Let me analyze this step by step...",
  "signature": "Eu0TCkYICxgCKkAyW336uhUkZ5nTg9Syw+WXorGg6rQ4..."
}
```

**Tool use block:**
```json
{
  "type": "tool_use",
  "id": "toolu_018XCyJNy7NfiHm1qvgGKEL9",
  "name": "Task",
  "input": {
    "description": "Explore token mechanism",
    "prompt": "The user wants to understand...",
    "subagent_type": "general-purpose"
  }
}
```

### Tool Input Examples

```python
# Bash
{"command": "ls -la", "description": "List files"}

# Read
{"file_path": "/path/to/file.txt"}

# Write
{"file_path": "/path/to/file.txt", "content": "file content..."}

# Edit
{"file_path": "/path/to/file.txt", "old_string": "before", "new_string": "after"}

# Glob
{"pattern": "**/*.py"}

# Grep
{"pattern": "def main", "path": "/path/to/dir", "output_mode": "content"}

# Agent (subagent) — tool name is "Agent" in JSONL (may also appear as "Task" in some versions)
{"description": "Task description", "prompt": "Detailed prompt...", "subagent_type": "general-purpose"}

# Skill
{"skill": "superpowers:writing-plans", "args": "Implement the feature..."}

# AskUserQuestion
{"questions": [{"question": "Which approach?", "header": "Approach", "options": [...]}]}

# WebSearch
{"query": "search query"}

# WebFetch
{"url": "https://example.com", "prompt": "Extract info..."}

# TaskCreate / TaskUpdate / TaskList / TaskGet
{"subject": "Do something", "description": "Details..."}
```

### Streaming Pattern

A single model API call produces multiple consecutive assistant records:

```
Record A (uuid=AAA, parentUuid=<user_uuid>):  content=[{type:"text", text:"\n\n"}]
Record B (uuid=BBB, parentUuid=AAA):           content=[{type:"thinking", ...}]
Record C (uuid=CCC, parentUuid=BBB):           content=[{type:"text", text:"I'll..."}]
Record D (uuid=DDD, parentUuid=CCC):           content=[{type:"tool_use", ...}]
```

All share the same `message.id`. To reconstruct the full response, collect consecutive assistant records with the same `message.id` and concatenate their `content` arrays.

---

## 3. `type: "progress"`

Progress records are emitted during long-running operations. **Informational/display-only** — do not participate in the conversation chain.

| Field | Type | Description |
|-------|------|-------------|
| `data` | `object` | Progress payload, discriminated by `data.type` |
| `toolUseID` | `string` | ID of the tool call this progress relates to |
| `parentToolUseID` | `string` | Parent tool use ID |

### `data.type` variants:

**`hook_progress`** — hook command runs:
```json
{"type": "hook_progress", "hookEvent": "SessionStart", "hookName": "SessionStart:startup", "command": "bd prime"}
```

**`bash_progress`** — periodic Bash updates:
```json
{
  "type": "bash_progress",
  "output": "* daemon not running...",
  "fullOutput": "* daemon not running...",
  "elapsedTimeSeconds": 2,
  "totalLines": 1,
  "timeoutMs": 10000
}
```

**`agent_progress`** — subagent updates:
```json
{
  "type": "agent_progress",
  "prompt": "The original prompt...",
  "normalizedMessages": [],
  "message": {
    "type": "assistant",
    "timestamp": "2026-02-09T03:18:49.880Z",
    "message": { ... },
    "requestId": "req_...",
    "uuid": "ddf80b77-..."
  }
}
```

**`query_update`** — WebSearch executing:
```json
{"type": "query_update", "query": "search query text"}
```

**`search_results_received`** — WebSearch results:
```json
{"type": "search_results_received", "resultCount": 10, "query": "search query text"}
```

---

## 4. `type: "system"`

System records mark turn boundaries and errors. Discriminated by `subtype`.

### `subtype: "stop_hook_summary"`
```json
{
  "type": "system",
  "subtype": "stop_hook_summary",
  "hookCount": 1,
  "hookInfos": [{"command": "python3 handler.py"}],
  "hookErrors": [],
  "preventedContinuation": false,
  "stopReason": "",
  "hasOutput": false,
  "level": "suggestion"
}
```

### `subtype: "turn_duration"`
```json
{"type": "system", "subtype": "turn_duration", "durationMs": 203355, "isMeta": false}
```

### `subtype: "api_error"`
```json
{
  "type": "system",
  "subtype": "api_error",
  "level": "error",
  "cause": {"code": "ECONNRESET", "path": "https://api.anthropic.com/v1/messages?beta=true", "errno": 0},
  "retryInMs": 515.43,
  "retryAttempt": 1,
  "maxRetries": 10
}
```

### `subtype: "local_command"`
```json
{"type": "system", "subtype": "local_command", "content": "<local-command-stdout>...</local-command-stdout>", "level": "info", "isMeta": false}
```

### `subtype: "compact_boundary"`
```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "level": "info",
  "isMeta": false,
  "parentUuid": null,
  "logicalParentUuid": "68caf90c-...",
  "compactMetadata": {"trigger": "auto", "preTokens": 168602}
}
```

---

## 5. `type: "file-history-snapshot"`

File state for undo/restore. Appears before first user message of a turn and after file-modifying operations.

```json
{
  "type": "file-history-snapshot",
  "isSnapshotUpdate": false,
  "messageId": "3b3422e9-...",
  "snapshot": {
    "messageId": "3b3422e9-...",
    "trackedFileBackups": {},
    "timestamp": "2026-02-09T03:18:09.569Z"
  }
}
```

When files have been modified (`isSnapshotUpdate: true`):
```json
{
  "isSnapshotUpdate": true,
  "messageId": "561f3822-...",
  "snapshot": {
    "trackedFileBackups": {
      "README.md": {"backupFileName": null, "version": 1, "backupTime": "2026-02-09T03:37:11.355Z"}
    }
  }
}
```

**Note:** Does NOT have the common fields (`uuid`, `parentUuid`, `sessionId`, etc.).

---

## 6. `type: "saved_hook_context"`

Injected context from hooks at session start:

```json
{
  "type": "saved_hook_context",
  "uuid": "f47c6ed3-...",
  "content": ["<EXTREMELY_IMPORTANT>\nYou have superpowers.\n..."]
}
```

Only has `type`, `uuid`, and `content`.

---

## 7. `type: "queue-operation"`

User input queued while model is busy:

```json
{
  "type": "queue-operation",
  "operation": "enqueue",
  "timestamp": "2026-02-09T03:47:36.111Z",
  "sessionId": "f1992b07-...",
  "content": "i think the app check the token when it resume"
}
```

---

## 8. `type: "summary"`

Conversation summary metadata:

```json
{
  "type": "summary",
  "summary": "Android startActivity Call Path Analysis",
  "leafUuid": "b66bdb94-..."
}
```

Only has `type`, `summary`, and `leafUuid`.

---

## Subagent / Task Pattern

### In the parent session

1. **Assistant emits `tool_use` with `name: "Task"`:**
   ```json
   {
     "type": "tool_use",
     "id": "toolu_018XCyJNy7NfiHm1qvgGKEL9",
     "name": "Task",
     "input": {
       "description": "Explore token mechanism",
       "subagent_type": "general-purpose",
       "prompt": "Detailed instructions..."
     }
   }
   ```

2. **Progress records** with `data.type: "agent_progress"` stream the subagent's output.

3. **Tool result** returns the subagent's final output:
   ```json
   {
     "type": "user",
     "message": {
       "role": "user",
       "content": [
         {
           "tool_use_id": "toolu_018XCyJNy7NfiHm1qvgGKEL9",
           "type": "tool_result",
           "content": [
             {"type": "text", "text": "The final result..."},
             {"type": "text", "text": "agentId: ab72d42 (for resuming...)\n<usage>total_tokens: 37577\ntool_uses: 4\nduration_ms: 155647</usage>"}
           ]
         }
       ]
     },
     "toolUseResult": {"status": "completed", "prompt": "..."}
   }
   ```

### In the subagent JSONL file

Located at `<parent-session-uuid>/subagents/agent-<agentId>.jsonl`:

- First record is `type: "user"` with the task prompt as `message.content` (plain string)
- All records have `agentId` set to the short agent ID
- `sessionId` is the **parent** session's UUID
- `isSidechain` is `true` on all records
- Follows same `user` → `assistant` → `user` (tool_result) pattern as parent
- No `system`, `file-history-snapshot`, or `summary` records in subagent files

---

## Conversation Chain Reconstruction

1. Parse all JSONL lines into records
2. Build graph using `uuid` → `parentUuid` links
3. Follow chain from first record (`parentUuid: null`)
4. Group consecutive assistant records with same `message.id` into single logical message
5. Skip `progress` records (display-only)
6. Handle `compact_boundary` as chain break — use `logicalParentUuid` to bridge
7. `file-history-snapshot`, `saved_hook_context`, `queue-operation`, `summary` sit outside main chain

### Key Relationships
- `tool_use.id` in assistant → matches `tool_result.tool_use_id` in subsequent user record
- `sourceToolAssistantUUID` in tool_result user record → points to assistant record's `uuid`
- Subagent files share `sessionId` with parent, linked by `agentId` (filename matches `toolUseResult.agentId`)
