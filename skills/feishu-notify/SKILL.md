---
name: feishu-notify
description: Use when the user asks to be notified on Feishu about task completion, or explicitly invokes /feishu-notify. Triggers on "notify me on feishu", "let me know on feishu", "send result to feishu", or any request to send completion notifications via Feishu webhook.
---

# Feishu Notify

Send task completion notifications to Feishu as rich interactive cards via webhook.

## Workflow

### 1. Complete the Task First

If the user says "do X and notify me on feishu", finish X completely before sending the notification. Do NOT notify before the task is done.

### 2. Prepare the Notification

Gather three pieces of information from the completed task:

- **Title**: concise description of what was done (under 50 chars)
- **Status**: `success` if the task completed without errors, `failure` otherwise
- **Body**: the full detailed result — same level of detail the user would see in the terminal. Do NOT summarize. Include command outputs, test results, error messages, build logs, etc.

### 3. Send the Notification

```bash
python <path-to-this-skill>/scripts/notify.py \
  --title "Run test suite" \
  --status success \
  --body "$(cat <<'BODY'
<full detailed result here>
BODY
)"
```

Use a heredoc for `--body` to handle multi-line output and special characters safely.

### 4. Report Result

- If the script exits 0, confirm to the user: "Feishu notification sent."
- If the script fails, report the error.

## Important

- **Full detail in body** — the user wants the same output they would see in the CLI. Do not summarize or abbreviate.
- **Heredoc for body** — always use a heredoc to pass the body to avoid shell escaping issues.
- **Title brevity** — keep `--title` under 50 characters. This appears as the card header.
- **Accurate status** — use `failure` if any part of the task had errors, even partial failures.

## Examples

### After running tests

```bash
python <path-to-this-skill>/scripts/notify.py \
  --title "Run pytest suite" \
  --status success \
  --body "$(cat <<'BODY'
============================= test session starts ==============================
collected 42 items

tests/test_parser.py ........ [ 19%]
tests/test_formatter.py ............ [ 47%]
tests/test_cli.py ...................... [100%]

============================== 42 passed in 3.21s ==============================
BODY
)"
```

### After a failed deployment

```bash
python <path-to-this-skill>/scripts/notify.py \
  --title "Deploy to staging" \
  --status failure \
  --body "$(cat <<'BODY'
Deploying to staging...
Building image: ok
Pushing image: ok
Updating deployment: FAILED
Error: ImagePullBackOff - unable to pull image registry.example.com/app:v2.3.1
Deployment rolled back to previous version.
BODY
)"
```
