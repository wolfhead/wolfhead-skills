---
name: background-task
description: Run long-running tasks in background subagents with completion notification. Use for: (1) Software installation (brew, npm, pip, etc.), (2) Large file downloads, (3) Code compilation/builds, (4) Long-running scripts, (5) Network-intensive operations, (6) Any task that may exceed 30 seconds. Triggers: "install", "download", "build", "compile", or any task that might timeout.
---

# Background Task

Execute long-running tasks in background subagents. Main session returns immediately; subagent notifies on completion.

## Workflow

### 1. Create Subagent

```json
sessions_spawn({
  "runtime": "subagent",
  "mode": "run",
  "task": "<task description>. After completion, use sessions_send to notify the parent session.",
  "label": "<task-label>"
})
```

Required parameters:
- `runtime`: "subagent"
- `mode`: "run"
- `task`: Include notification instruction
- `label`: Short identifier for tracking

### 2. Immediate Response

After spawning, immediately reply to user:

```
Started <task> in background. Will notify when complete.
```

### 3. Subagent Notification

The subagent must notify the parent session upon completion using `sessions_send`:

```json
sessions_send({
  "sessionKey": "<parent-session-key>",
  "message": "✓ <task> completed. <result summary>"
})
```

## Task Description Template

Include in every task:

1. **What to do** - Specific operation
2. **Success criteria** - How to verify
3. **Notification instruction** - Tell subagent to report back

```
<operation>. After completion, verify <success-criteria>. Use sessions_send with sessionKey "<parent-session-key>" to notify parent session with results.
```

## Examples

### Install Software

```json
sessions_spawn({
  "runtime": "subagent",
  "mode": "run",
  "task": "Install GitHub CLI using 'brew install gh'. Verify with 'gh --version'. Use sessions_send with sessionKey \"agent:main:feishu:group:xxx\" to notify parent session with the installed version.",
  "label": "install-gh"
})
```

### Download File

```json
sessions_spawn({
  "runtime": "subagent",
  "mode": "run",
  "task": "Download https://example.com/file.zip to ~/Downloads/. Verify file exists and report size. Use sessions_send with sessionKey \"agent:main:feishu:group:xxx\" to notify parent session with the file path and size.",
  "label": "download-file"
})
```

### Build Project

```json
sessions_spawn({
  "runtime": "subagent",
  "mode": "run",
  "task": "Run 'npm run build' in /path/to/project. Check for errors in output. Use sessions_send with sessionKey \"agent:main:feishu:group:xxx\" to notify parent session with build result (success/failure and any errors).",
  "label": "build-project",
  "cwd": "/path/to/project"
})
```

## Timeout Configuration

Default timeout is 10 minutes. For longer tasks:

```json
{
  "runTimeoutSeconds": 3600
}
```

## Parent Session Key

The parent session key is available in the subagent's context. Common patterns:

- Feishu group: `agent:main:feishu:group:<chat-id>`
- Feishu DM: `agent:main:feishu:dm:<user-id>`
- Telegram: `agent:main:telegram:<chat-id>`

When in doubt, subagent can check its own context or ask for clarification.

## Notes

- **No polling** - Subagent notifies automatically via sessions_send
- **Meaningful labels** - Use descriptive labels like "install-gh", "download-backup"
- **Error handling** - Task description should include error reporting
