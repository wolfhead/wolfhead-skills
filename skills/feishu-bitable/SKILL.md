---
name: feishu-bitable
description: |
  Feishu Bitable (多维表格) operations: read fields, list records, create/update records. Triggers: "bitable", "多维表格", "表格", or any Bitable URL (base/ or wiki/ with table=). Pure tool skill — no business logic.
---

# Feishu Bitable Operations

Bitable = Feishu's spreadsheet-database hybrid. Use `feishu_bitable_*` tools.

## Quick Start

### 1. Parse URL → Get Tokens

```json
{ "url": "https://xxx.feishu.cn/base/ABC123?table=XYZ789" }
```

Returns `app_token`, `table_id`, table list.

### 2. List Fields (Understand Schema)

```json
{ "app_token": "ABC123", "table_id": "XYZ789" }
```

Returns field names, types, and option values for select fields.

### 3. List Records

```json
{ "app_token": "ABC123", "table_id": "XYZ789", "page_size": 100 }
```

Use `page_token` for pagination when `has_more: true`.

### 4. CRUD

**Create:**
```json
{
  "app_token": "ABC123",
  "table_id": "XYZ789",
  "fields": { "标题": "New", "状态": "进行中" }
}
```

**Get one:**
```json
{ "app_token": "ABC123", "table_id": "XYZ789", "record_id": "recXXX" }
```

**Update:**
```json
{
  "app_token": "ABC123",
  "table_id": "XYZ789",
  "record_id": "recXXX",
  "fields": { "状态": "完成" }
}
```

## Field Types

| ID | Type | Value Format |
|----|------|--------------|
| 1 | Text | `"string"` |
| 2 | Number | `123` |
| 3 | SingleSelect | `"Option"` |
| 4 | MultiSelect | `["A", "B"]` |
| 5 | DateTime | `1772812800000` (ms) |
| 7 | Checkbox | `true` |
| 11 | User | `[{ "id": "ou_xxx" }]` |
| 15 | URL | `{ "text": "显示文本", "link": "https://..." }` |
| 17 | Attachment | `[{ "file_token": "..." }]` |
| 1005 | AutoNumber | Read-only |

## Workflow

```
get_meta → list_fields → list_records / create_record / update_record
```

Always call `list_fields` first to discover field names and types.

## Permissions

- `bitable:bitable` — Read/write
- `bitable:bitable:readonly` — Read only
