# Feishu Notify — Design Spec

## Overview

A Claude Code skill + Python script that sends task completion notifications to a Feishu group via webhook. The user triggers it by saying "notify me on feishu" or invoking `/feishu-notify`, and receives a rich interactive card in Feishu with the full detailed result.

## Structure

```
skills/feishu-notify/
├── SKILL.md
└── scripts/
    └── notify.py
```

## Configuration

**File:** `~/.wolfhead-skills/.env`

```
FEISHU_WEBHOOK_URL=https://open.larksuite.com/open-apis/bot/v2/hook/<token>
```

The Python script reads this file at runtime using stdlib only (no `python-dotenv`).

## Python Script (`scripts/notify.py`)

### Interface

```bash
python scripts/notify.py --title "Run test suite" --status success --body "All 42 tests passed..."
```

### CLI Arguments

| Arg | Required | Default | Description |
|-----|----------|---------|-------------|
| `--title` | Yes | — | Short task description (under 50 chars) |
| `--status` | No | `success` | `success` or `failure` |
| `--body` | Yes | — | Full detailed result text |

### Behavior

1. Read `FEISHU_WEBHOOK_URL` from `~/.wolfhead-skills/.env`
2. Build a Feishu interactive card:
   - **Header:** title text + template color (green for success, red for failure)
   - **Body:** markdown content block with the full result text
3. Truncate body if total payload exceeds ~28KB — keep first part + last part of body text with a `... [truncated] ...` separator
4. POST JSON payload to the webhook URL via `urllib.request`
5. Print HTTP response status to stdout, errors to stderr
6. Exit 0 on success, exit 1 on failure

### Dependencies

None — pure Python stdlib (`argparse`, `urllib.request`, `json`, `os`, `pathlib`).

## Skill (`SKILL.md`)

### Trigger

- Explicit invocation: `/feishu-notify`
- Natural language: "notify me on feishu", "let me know on feishu when done", "send the result to feishu"

### Description

```
Use when the user asks to be notified on Feishu about task completion, or explicitly invokes /feishu-notify.
```

### Behavior

1. **Mid-task trigger** (e.g., "do X and notify me on feishu") — complete the task first, then call the script
2. **Post-task trigger** — summarize what just happened and call the script
3. Claude determines:
   - `--title`: concise task description (under 50 chars)
   - `--status`: `success` or `failure` based on outcome
   - `--body`: the full detailed output — same level of detail the user would see in the CLI terminal
4. Call: `python <skill-path>/scripts/notify.py --title "..." --status <status> --body "..."`
5. If the script fails, report the error to the user

### Key Instruction to Claude

The `--body` must contain the full detailed result, not a summary. The user wants the same information they would see in the Claude Code terminal. Use `--status failure` if the task encountered errors.

## Card Format

Feishu interactive card structure:

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": { "tag": "plain_text", "content": "<title>" },
      "template": "green"
    },
    "elements": [
      {
        "tag": "markdown",
        "content": "<body>"
      }
    ]
  }
}
```

- Header template: `"green"` for success, `"red"` for failure
- Body: markdown-formatted result text

## Truncation Strategy

Feishu card payload limit is ~30KB. Reserve ~2KB for card structure overhead, leaving ~28KB for body content.

When body exceeds the limit:
1. Keep the first ~40% of the text (context/setup)
2. Insert `\n\n... [truncated — output too long] ...\n\n`
3. Keep the last ~40% of the text (final results/errors)

This preserves both the beginning (what was attempted) and the end (what happened).
