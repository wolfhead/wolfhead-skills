---
name: feishu-bitable-task-executor
description: Use when executing pending tasks from Feishu Bitable task panel. Scans tasks, prioritizes by P0/P1/P2, spawns subagents to execute, updates task records. Triggers: heartbeat task check, cron task execution, or manual task execution request.
---

# Feishu Bitable Task Executor

Execute pending tasks from Feishu Bitable task panel. Scans, prioritizes, spawns subagents, updates records.

## Configuration

Read config from TOOLS.md (workspace root).

Expected format in TOOLS.md:

```markdown
## Task Manager
- **Bitable URL**: https://xxx.feishu.cn/base/YOUR_BITABLE
- **Table Name**: Table
- **Max Concurrent**: 1
```

<HARD-GATE>
ALWAYS read config from TOOLS.md before execution.
If TOOLS.md has no "## Task Manager" section, abort and inform user.
</HARD-GATE>

## Workflow

```
1. Read config from TOOLS.md
2. Resolve app_token + table_id via feishu_bitable_get_meta
3. Query tasks where 任务状态 = "待处理"
4. Sort by priority: P0 > P1 > P2
5. For each task:
   a. Select model based on task attributes (see Model Selection Rules)
   b. Spawn subagent with selected model
   c. Update task record after execution
   d. Notify user if 追踪模式 = "主动汇报"
```

## Model Selection Rules

Evaluate rules top-to-bottom. First match wins.

```
1. Task requires vision/image input?
   ├── Budget constrained? → ppio/qwen/qwen3.5-397b-a17b
   └── Quality critical?   → anthropic/claude-sonnet-4-20250514

2. Task is math-heavy, calculation, or competitive programming?
   → ppio/deepseek/deepseek-v3.2

3. Task is autonomous multi-step coding (SWE-style)?
   → ppio/minimax/minimax-m2.5

4. Task is code review or multi-file refactoring?
   → anthropic/claude-sonnet-4-20250514

5. Task is complex architecture design or deep debugging?
   → anthropic/claude-opus-4-20250514

6. Task is high-volume batch processing where cost matters?
   → ppio/deepseek/deepseek-v3.2

7. Task involves multilingual content (non-English dominant)?
   → ppio/qwen/qwen3.5-397b-a17b

8. Everything else
   → ppio/zai-org/glm-5 (default)
```

<HARD-GATE>
FORBIDDEN: Selecting a model based on "quality feel" or preference.
FORBIDDEN: Defaulting to expensive models "just in case."
MUST: Always justify model selection by citing which rule matched.
</HARD-GATE>

## Execution Rules

### Priority Order

1. **P0** — Execute immediately
2. **P1** — Execute after P0 tasks
3. **P2** — Execute after P1 tasks

### Concurrency

- Read `Max Concurrent` from TOOLS.md (default: 1)
- Never exceed this limit when spawning subagents
- Use `sessions_spawn` with `runtime: "subagent"` for each task

### Subagent Execution

For each task:

1. Analyze task content (任务名称 + 任务详情)
2. Apply Model Selection Rules to determine best model
3. Spawn subagent with selected model:

```json
{
  "runtime": "subagent",
  "mode": "run",
  "task": "<任务详情>",
  "label": "task-<record_id>",
  "timeoutSeconds": 300
}
```

### Task Record Updates

**Before execution:**
```json
{
  "任务状态": "进行中",
  "开始时间": <current_timestamp_ms>
}
```

**After execution (success):**
```json
{
  "任务状态": "已完成",
  "结束时间": <current_timestamp_ms>,
  "任务结果": "状态：成功 | 耗时：X分钟 | 详情：..."
}
```

**After execution (failure):**
```json
{
  "任务状态": "已取消",
  "结束时间": <current_timestamp_ms>,
  "任务结果": "状态：失败 | 耗时：X分钟 | 详情：...",
  "备注": "Failure reason"
}
```

## No Tasks Found

If no pending tasks:
- Do NOT send any notification
- Simply end execution silently

This avoids noise when there's nothing to do.

## Notification

Only notify user when:
1. At least one task was executed
2. Task has `追踪模式 = "主动汇报"`

Notification format:

```
✅ 任务完成：{任务名称}

结果：{任务结果}
优先级：{优先级}
```

For multiple completed tasks:

```
✅ 已完成 {count} 个任务

{任务名称1} (P0): {简短结果}
{任务名称2} (P1): {简短结果}
```

## Error Handling

| Error | Action |
|-------|--------|
| No config in TOOLS.md | Inform user to configure Task Manager |
| Bitable access denied | Update task record with error, skip |
| Subagent timeout | Mark task as "已取消", record timeout |
| Subagent error | Mark task as "已取消", record error |

## Example Usage

**Cron job:**
```json
{
  "message": "Execute pending tasks using feishu-bitable-task-executor skill."
}
```

**Heartbeat:**
```markdown
# HEARTBEAT.md

- Check and execute pending tasks (use feishu-bitable-task-executor skill)
```

**Manual trigger:**
```
用户: 执行待办任务
Agent: [Loads skill, scans, executes, reports]
```

## Dependencies

- **feishu-bitable-task-manager skill**: Use for task record operations
- **feishu-bitable skill**: Use for Bitable operations
- **TOOLS.md**: User configuration (URL, table name, concurrency)
- **sessions_spawn**: Spawn subagents for task execution
- **message tool**: User notifications (when 主动汇报)

## First-Time Setup

If TOOLS.md has no "## Task Manager" section:

1. Tell user: "请先配置 Task Manager。在 TOOLS.md 中添加：
   ```markdown
   ## Task Manager
   - **Bitable URL**: https://xxx.feishu.cn/base/YOUR_BITABLE
   - **Table Name**: Table
   - **Max Concurrent**: 1
   ```"
2. Do not attempt to execute tasks until configured
