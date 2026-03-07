---
name: feishu-bitable-task-manager
description: Use when creating or managing task records in Feishu Bitable — creating, updating, querying, completing task entries. Triggers include "任务", "task", "待办", "todo", "创建任务", "完成任务", or any mention of task status/priority. Pure CRUD skill for task records, does NOT execute tasks.
---

# Feishu Bitable Task Manager

Create and manage task records in Feishu Bitable. Pure CRUD operations — this skill does NOT execute tasks.

## Configuration

Read config from TOOLS.md (workspace root).

Expected format in TOOLS.md:

```markdown
## Task Manager
- **Bitable URL**: https://xxx.feishu.cn/base/YOUR_BITABLE
- **Table Name**: Table
```

<HARD-GATE>
ALWAYS read config from TOOLS.md before any task operation.
If TOOLS.md has no "## Task Manager" section, run First-Time Setup.
</HARD-GATE>

## Field Requirements

The Bitable table MUST have these fields:

| Field | Type | Options |
|-------|------|---------|
| 任务名称 | Text | Required |
| 任务详情 | Text | Optional |
| 任务状态 | SingleSelect | 待处理 / 进行中 / 已完成 / 已取消 |
| 优先级 | SingleSelect | P0 / P1 / P2 |
| 追踪模式 | SingleSelect | 主动汇报 / 静默执行 |
| 备注 | Text | Optional |
| Agent | SingleSelect | Agent name (e.g., Main) |
| 开始时间 | DateTime | Timestamp (ms) |
| 结束时间 | DateTime | Timestamp (ms) |
| 任务结果 | Text | Optional |

## Workflow

```
1. Read config from TOOLS.md
2. Call feishu_bitable_get_meta to resolve app_token + table_id
3. Call feishu_bitable_list_fields to verify schema
4. Execute CRUD operations on task records
```

## First-Time Setup

If TOOLS.md has no "## Task Manager" section:

1. Ask user: "请提供你的任务 Bitable URL（例如：https://xxx.feishu.cn/base/ABC123）"
2. Call `feishu_bitable_get_meta` to get tables
3. Call `feishu_bitable_list_fields` to verify required fields exist
4. If validation passes, append config to TOOLS.md
5. If fields missing, tell user which fields to add

## Operations

### Create Task Record

```json
{
  "app_token": "<from config>",
  "table_id": "<from config>",
  "fields": {
    "任务名称": "Task title",
    "任务详情": "Description",
    "任务状态": "待处理",
    "优先级": "P1",
    "追踪模式": "主动汇报",
    "Agent": "Main",
    "开始时间": 1741264020000
  }
}
```

### Update Task Record

```json
{
  "app_token": "<from config>",
  "table_id": "<from config>",
  "record_id": "recXXX",
  "fields": { "任务状态": "进行中" }
}
```

### Complete Task Record

```json
{
  "app_token": "<from config>",
  "table_id": "<from config>",
  "record_id": "recXXX",
  "fields": {
    "任务状态": "已完成",
    "结束时间": 1741264080000,
    "任务结果": "Result description"
  }
}
```

### Query Task Records

```json
{
  "app_token": "<from config>",
  "table_id": "<from config>",
  "page_size": 100
}
```

Filter in memory: keep where `任务状态` is "待处理" or "进行中" AND `Agent` matches current agent.

### Cancel Task Record

```json
{
  "app_token": "<from config>",
  "table_id": "<from config>",
  "record_id": "recXXX",
  "fields": {
    "任务状态": "已取消",
    "备注": "Reason for cancellation"
  }
}
```

## Tracking Modes

### 主动汇报
- Notify user when task record is created or updated
- Use for important tasks

### 静默执行
- No notifications
- Just record in Bitable
- Use for background tasks

## Pre-Action Checklist

Before creating a task record:

- [ ] Is 任务名称 clear and actionable?
- [ ] Is 优先级 appropriate (P0 = urgent, P1 = important, P2 = normal)?
- [ ] Is 追踪模式 correct?

Before completing a task record:

- [ ] Did I fill 结束时间?
- [ ] Did I fill 任务结果?

## Notification Format

When 主动汇报 mode, use `message` tool to notify:

**Task created:**
```
📝 新任务：{任务名称}

详情：{任务详情}
优先级：{优先级}
```

**Task completed:**
```
✅ 任务完成：{任务名称}

结果：{任务结果}
```

## Dependencies

- **feishu-bitable skill**: Use for all Bitable operations
- **TOOLS.md**: User configuration storage
- **message tool**: User notifications (when 主动汇报)

## Error Handling

| Error | Action |
|-------|--------|
| No config in TOOLS.md | Run First-Time Setup |
| Missing required fields | Tell user which fields to add |
| Invalid Bitable URL | Ask user to verify URL |
| Permission denied | Tell user to add bot to Bitable |
