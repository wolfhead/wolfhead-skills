---
name: feishu-bitable
description: Use when working with Feishu Bitable (多维表格) — reading fields, listing records, creating or updating rows. Triggers include "bitable", "多维表格", "表格", or any Bitable URL (base/ or wiki/ with table=).
---

# Feishu Bitable Operations

Pure tool skill for Feishu's spreadsheet-database hybrid. Use `feishu_bitable_*` tools.

## When to Use

- Reading or writing Bitable records
- Understanding table schema (field names, types)
- Any URL containing `/base/` or `/wiki/` with `?table=`

## Workflow

```
get_meta → list_fields → list_records / create_record / update_record
```

Always call `list_fields` first to discover field names and types.

## Quick Reference

### Parse URL → Get Tokens

```json
{ "url": "https://xxx.feishu.cn/base/ABC123?table=XYZ789" }
```

Returns `app_token`, `table_id`, table list.

### List Fields

```json
{ "app_token": "ABC123", "table_id": "XYZ789" }
```

### List Records

```json
{ "app_token": "ABC123", "table_id": "XYZ789", "page_size": 100 }
```

Use `page_token` for pagination when `has_more: true`.

### Create Record

```json
{ "app_token": "ABC123", "table_id": "XYZ789", "fields": { "标题": "New" } }
```

### Update Record

```json
{ "app_token": "ABC123", "table_id": "XYZ789", "record_id": "recXXX", "fields": { "状态": "完成" } }
```

### Get Single Record

```json
{ "app_token": "ABC123", "table_id": "XYZ789", "record_id": "recXXX" }
```

## Field Types

| ID | Type | Value Format |
|----|------|--------------|
| 1 | Text | `"string"` |
| 2 | Number | `123` |
| 3 | SingleSelect | `"Option"` |
| 4 | MultiSelect | `["A", "B"]` |
| 5 | DateTime | `1772812800000` (timestamp ms) |
| 7 | Checkbox | `true` / `false` |
| 11 | User | `[{ "id": "ou_xxx" }]` |
| 15 | URL | `{ "text": "Display", "link": "https://..." }` |
| 17 | Attachment | `[{ "file_token": "..." }]` |
| 1005 | AutoNumber | Read-only |

## Permissions

Required: `bitable:bitable` (read/write) or `bitable:bitable:readonly` (read only)
