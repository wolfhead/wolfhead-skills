---
name: openclaw-config-guard
description: >
  Safe openclaw configuration changes with validation, backup, and controlled restart.
  Use when modifying ~/.openclaw/openclaw.json or ~/.openclaw/.env — adding models,
  providers, channels, plugins, agents, bindings, or any gateway config change.
  Triggers: "add model", "change config", "update openclaw config", "add provider",
  "configure feishu", "add channel", "change gateway settings", "edit openclaw.json".
  Also use on remote machines when editing openclaw config via SSH.
---

# OpenClaw Config Guard

Safe, validated openclaw configuration changes. Every config edit follows this checklist.

## Mandatory Checklist

Follow every step in order. Do not skip steps.

### 1. Read current config

```bash
cat ~/.openclaw/openclaw.json
```

For remote machines: `ssh <user>@<host> "cat ~/.openclaw/openclaw.json"`

### 2. Backup current config

Create timestamped backup before any modification:

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak.$(date +%Y%m%d-%H%M%S)
```

### 3. Propose changes — show diff to user

- Describe what will change in plain language
- Show the exact JSON diff (old vs new) to the user
- **Wait for user approval before writing**

Example:

```
Proposed changes to ~/.openclaw/openclaw.json:
- Adding provider "ppio" with 2 models (deepseek-v3.2, qwen3.5)
- Adding PPIO_API_KEY reference

[show JSON diff]

Proceed? (waiting for approval)
```

### 4. Validate before writing

After user approves the content, validate before writing to disk:

**JSON syntax check:**

```bash
python3 -c "import json; json.load(open('/dev/stdin'))" <<< '<proposed_json>'
```

**Env var check** — run the bundled validator:

```bash
python3 <skill_dir>/scripts/validate_config.py <config_path> <env_path>
```

Exit codes: 0 = ok, 1 = bad JSON, 2 = missing env vars.

If env vars are missing, ask user to provide values and add them to `~/.openclaw/.env` before proceeding.

**Model input types** — only `"text"` and `"image"` are valid. Reject `"video"`, `"audio"`, etc.

### 5. Write config

Write the validated JSON to disk.

### 6. Run openclaw doctor

```bash
openclaw doctor 2>&1
```

Or if `openclaw` is not in PATH:

```bash
PATH=/usr/local/opt/node@22/bin:$PATH openclaw doctor 2>&1
```

If doctor reports errors, fix them before proceeding. Do not restart with a broken config.

### 7. Announce restart — get approval

Tell the user:
- What changed (summary)
- Doctor result
- Ask for explicit restart approval

Example:

```
Config validated. Changes:
- Added ppio provider with deepseek-v3.2 and qwen3.5 models
- Doctor: ✅ no errors

Ready to restart gateway. Approve?
```

### 8. Restart gateway

```bash
# Kill existing processes (check for duplicates)
pkill -f 'openclaw.*gateway'
sleep 2

# Verify no stale processes remain
ps aux | grep 'openclaw.*gateway' | grep -v grep

# Start gateway
PATH=/usr/local/opt/node@22/bin:$PATH nohup openclaw gateway --port 18789 > /dev/null 2>&1 &
sleep 4
```

### 9. Verify and announce success

```bash
# Health check
curl -s -o /dev/null -w '%{http_code}' http://localhost:18789/

# Check for errors in the first seconds
tail -5 ~/.openclaw/logs/gateway.err.log

# Check model loaded
tail -10 ~/.openclaw/logs/gateway.log | grep -i 'model\|error\|listening'
```

Report to user:
- HTTP status (should be 200)
- Any errors from logs
- Confirm model and listening address

If health check fails, show error logs and offer to rollback from backup.

## Common Pitfalls

- **Duplicate gateway processes**: Always `pkill` before starting a new one
- **`"video"` input type**: Not supported, only `"text"` and `"image"`
- **Missing `gateway.mode`**: Must be set to `"local"` for local deployments
- **Missing `defaultAccount`**: Required when channel accounts are configured
- **Env var not in .env**: Config writes `${VAR}` but .env lacks the key — gateway starts but API calls fail silently

## Rollback

If anything goes wrong after restart:

```bash
# Find most recent backup
ls -t ~/.openclaw/openclaw.json.bak.* | head -1

# Restore
cp <backup_file> ~/.openclaw/openclaw.json

# Restart
pkill -f 'openclaw.*gateway'
sleep 2
PATH=/usr/local/opt/node@22/bin:$PATH nohup openclaw gateway --port 18789 > /dev/null 2>&1 &
```

## Scripts

### scripts/validate_config.py

Run to validate JSON syntax and check env var references:

```bash
python3 <skill_dir>/scripts/validate_config.py [config_path] [env_path]
```

Defaults to `~/.openclaw/openclaw.json` and `~/.openclaw/.env`.
