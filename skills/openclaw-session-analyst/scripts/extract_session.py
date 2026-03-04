#!/usr/bin/env python3
"""
Extract structured signals from OpenClaw JSONL session files.

Parses session JSONL and produces condensed JSON with metadata,
conversation flow, cost breakdown, model switches, and error signals.
"""

import json
import os
import re
import sys
import argparse
from pathlib import Path


CONTENT_PREVIEW_MAX_CHARS = 500  # Enough context for analysis without bloating output


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _truncate(text, max_len=CONTENT_PREVIEW_MAX_CHARS):
    """Truncate text to max_len characters, appending '...' if truncated."""
    if not isinstance(text, str):
        text = str(text)
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


def _extract_text_content(content_blocks):
    """Extract concatenated text from a list of content blocks."""
    if isinstance(content_blocks, str):
        return content_blocks
    if not isinstance(content_blocks, list):
        return ""
    parts = []
    for block in content_blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
        elif isinstance(block, str):
            parts.append(block)
    return "\n".join(parts)


def _extract_sender(text):
    """Extract sender label/name from untrusted metadata block in user message text.

    OpenClaw wraps sender info like:
        Sender (untrusted metadata):
        ```json
        {"label": "Jojo Wolf", "name": "Jojo Wolf", "username": "realjojowolf"}
        ```
    Returns the label or name, or None if not found.
    """
    pattern = r'Sender \(untrusted metadata\):\s*```json\s*(\{[^}]+\})\s*```'
    match = re.search(pattern, text, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
        return data.get("label") or data.get("name") or None
    except (json.JSONDecodeError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Task 1 — Core parser
# ---------------------------------------------------------------------------

def parse_jsonl(path):
    """Read a JSONL file and return a list of dicts, skipping malformed lines."""
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def classify_entry(entry):
    """Classify an OpenClaw JSONL entry into a semantic category.

    Returns one of:
        session_header, human_message, assistant, tool_result,
        model_change, thinking_level_change, custom, compaction, skip
    """
    etype = entry.get("type")

    if etype == "session":
        return "session_header"

    if etype == "message":
        role = entry.get("message", {}).get("role", "")
        if role == "user":
            return "human_message"
        if role == "assistant":
            return "assistant"
        if role == "toolResult":
            return "tool_result"
        return "skip"

    if etype == "model_change":
        return "model_change"

    if etype == "thinking_level_change":
        return "thinking_level_change"

    if etype == "custom":
        return "custom"

    if etype == "compaction":
        return "compaction"

    return "skip"


def is_openclaw_session(path):
    """Check if a JSONL file is an OpenClaw session.

    Reads the first line: returns True if type="session" with a "version" key.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    return False
                return (
                    record.get("type") == "session"
                    and "version" in record
                )
    except (OSError, IOError):
        return False
    return False


# ---------------------------------------------------------------------------
# Task 2 — Metadata extraction
# ---------------------------------------------------------------------------

def extract_metadata(records):
    """Extract session metadata from a list of parsed records.

    Returns a dict with: session_id, cwd, first_timestamp, last_timestamp,
    models_used, providers_used, total_cost, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, turn_count, channel, chat_type.
    """
    meta = {
        "session_id": None,
        "cwd": None,
        "first_timestamp": None,
        "last_timestamp": None,
        "models_used": [],
        "providers_used": [],
        "total_cost": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "turn_count": 0,
        "channel": None,
        "chat_type": None,
    }

    models_seen = set()
    providers_seen = set()

    for rec in records:
        cat = classify_entry(rec)

        # Session header
        if cat == "session_header":
            if meta["session_id"] is None:
                meta["session_id"] = rec.get("id")
            if meta["cwd"] is None:
                meta["cwd"] = rec.get("cwd")

        # Timestamps — from any entry that has one
        ts = rec.get("timestamp")
        if ts and isinstance(ts, str):
            if meta["first_timestamp"] is None:
                meta["first_timestamp"] = ts
            meta["last_timestamp"] = ts

        # Count user messages as turns (consistent with search_sessions.py)
        if cat == "human_message":
            meta["turn_count"] += 1

        # Assistant messages — model, provider, usage, cost
        if cat == "assistant":
            msg = rec.get("message", {})
            model = msg.get("model")
            provider = msg.get("provider")
            if model and model not in models_seen:
                models_seen.add(model)
            if provider and provider not in providers_seen:
                providers_seen.add(provider)

            usage = msg.get("usage", {})
            if isinstance(usage, dict):
                meta["input_tokens"] += usage.get("input", 0)
                meta["output_tokens"] += usage.get("output", 0)
                meta["cache_read_tokens"] += usage.get("cacheRead", 0)
                meta["cache_write_tokens"] += usage.get("cacheWrite", 0)
                cost = usage.get("cost", {})
                if isinstance(cost, dict):
                    meta["total_cost"] += cost.get("total", 0)

    meta["models_used"] = sorted(models_seen)
    meta["providers_used"] = sorted(providers_seen)
    return meta


# ---------------------------------------------------------------------------
# Task 3 — Cost by model + model switches
# ---------------------------------------------------------------------------

def extract_cost_by_model(records):
    """Extract cost breakdown by model.

    Returns dict: model_id -> {input, output, cache_read, cache_write, total, turn_count}
    """
    costs = {}

    for rec in records:
        if classify_entry(rec) != "assistant":
            continue
        msg = rec.get("message", {})
        model = msg.get("model", "unknown")
        usage = msg.get("usage", {})
        if not isinstance(usage, dict):
            continue
        cost = usage.get("cost", {})
        if not isinstance(cost, dict):
            continue

        if model not in costs:
            costs[model] = {
                "input": 0,
                "output": 0,
                "cache_read": 0,
                "cache_write": 0,
                "total": 0,
                "turn_count": 0,
            }

        entry = costs[model]
        entry["input"] += cost.get("input", 0)
        entry["output"] += cost.get("output", 0)
        entry["cache_read"] += cost.get("cacheRead", 0)
        entry["cache_write"] += cost.get("cacheWrite", 0)
        entry["total"] += cost.get("total", 0)
        entry["turn_count"] += 1

    return costs


def extract_model_switches(records):
    """Extract model switch events from assistant messages.

    Detects when the model/provider changes between consecutive assistant
    responses. Returns list of: {timestamp, from_model, from_provider,
    to_model, to_provider}
    """
    switches = []
    prev_model = None
    prev_provider = None

    for rec in records:
        if classify_entry(rec) != "assistant":
            continue
        msg = rec.get("message", {})
        model = msg.get("model")
        provider = msg.get("provider")
        if not model:
            continue

        if prev_model is not None and model != prev_model:
            switches.append({
                "timestamp": rec.get("timestamp"),
                "from_model": prev_model,
                "from_provider": prev_provider,
                "to_model": model,
                "to_provider": provider,
            })

        prev_model = model
        prev_provider = provider

    return switches


# ---------------------------------------------------------------------------
# Task 4 — Conversation flow
# ---------------------------------------------------------------------------

def extract_conversation(records):
    """Extract the conversation flow as a list of turns.

    Each turn is one of:
    - {"type": "human_message", "text": "...", "sender": "..."|null}
    - {"type": "assistant_turn", "text": "...", "tool_calls": [...],
       "model": "...", "provider": "...", "cost": float}
    - {"type": "tool_result", "tool_call_id": "...", "tool_name": "...",
       "is_error": bool, "content_preview": "..."}
    """
    turns = []

    for rec in records:
        cat = classify_entry(rec)

        if cat == "human_message":
            msg = rec.get("message", {})
            text = _extract_text_content(msg.get("content", ""))
            sender = _extract_sender(text)
            turns.append({
                "type": "human_message",
                "text": text,
                "sender": sender,
            })

        elif cat == "assistant":
            msg = rec.get("message", {})
            content_blocks = msg.get("content", [])
            if not isinstance(content_blocks, list):
                continue

            texts = []
            tool_calls = []
            for block in content_blocks:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    t = block.get("text", "").strip()
                    if t:
                        texts.append(t)
                elif btype == "toolCall":
                    tool_calls.append({
                        "id": block.get("id", ""),
                        "name": block.get("name", ""),
                        "arguments": block.get("arguments", {}),
                    })

            usage = msg.get("usage", {})
            cost_val = 0
            if isinstance(usage, dict):
                cost = usage.get("cost", {})
                if isinstance(cost, dict):
                    cost_val = cost.get("total", 0)

            turns.append({
                "type": "assistant_turn",
                "text": "\n".join(texts),
                "tool_calls": tool_calls,
                "model": msg.get("model", ""),
                "provider": msg.get("provider", ""),
                "cost": cost_val,
            })

        elif cat == "tool_result":
            msg = rec.get("message", {})
            raw_content = _extract_text_content(msg.get("content", ""))
            turns.append({
                "type": "tool_result",
                "tool_call_id": msg.get("toolCallId", ""),
                "tool_name": msg.get("toolName", ""),
                "is_error": bool(msg.get("isError", False)),
                "content_preview": _truncate(raw_content),
            })

    return turns


# ---------------------------------------------------------------------------
# Task 5 — Tool failures + compactions
# ---------------------------------------------------------------------------

def extract_tool_failures(records):
    """Extract tool failures: isError=True OR details.status=="error".

    Returns list of: {tool_call_id, tool_name, content_preview}
    """
    failures = []

    for rec in records:
        if classify_entry(rec) != "tool_result":
            continue
        msg = rec.get("message", {})
        is_error = msg.get("isError", False)
        details = msg.get("details", {})
        details_error = (
            isinstance(details, dict)
            and details.get("status") == "error"
        )

        if not is_error and not details_error:
            continue

        raw_content = _extract_text_content(msg.get("content", ""))
        failures.append({
            "tool_call_id": msg.get("toolCallId", ""),
            "tool_name": msg.get("toolName", ""),
            "content_preview": _truncate(raw_content),
        })

    return failures


def extract_compactions(records):
    """Extract compaction entries.

    Returns list of: {timestamp, tokens_before, summary_preview,
                      read_files, modified_files, from_hook}
    """
    compactions = []

    for rec in records:
        if classify_entry(rec) != "compaction":
            continue

        details = rec.get("details", {})
        compactions.append({
            "timestamp": rec.get("timestamp"),
            "tokens_before": rec.get("tokensBefore"),
            "summary_preview": _truncate(rec.get("summary", "")),
            "read_files": details.get("readFiles", []) if isinstance(details, dict) else [],
            "modified_files": details.get("modifiedFiles", []) if isinstance(details, dict) else [],
            "from_hook": rec.get("fromHook", False),
        })

    return compactions


# ---------------------------------------------------------------------------
# Task 6 — Pipeline + CLI
# ---------------------------------------------------------------------------

def extract_session(path, output_dir=None):
    """Full extraction pipeline for an OpenClaw session JSONL file.

    Returns None if the file is not an OpenClaw session.

    Returns a dict with keys: platform, metadata, cost_by_model,
    model_switches, conversation, tool_failures, compactions.

    If output_dir is provided, writes main.json to that directory.
    """
    if not is_openclaw_session(path):
        return None

    records = parse_jsonl(path)

    result = {
        "platform": "openclaw",
        "metadata": extract_metadata(records),
        "cost_by_model": extract_cost_by_model(records),
        "model_switches": extract_model_switches(records),
        "conversation": extract_conversation(records),
        "tool_failures": extract_tool_failures(records),
        "compactions": extract_compactions(records),
    }

    if output_dir:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        main_path = out_dir / "main.json"
        with open(main_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"Written to {main_path}", file=sys.stderr)

    return result


def main():
    """CLI entry point: python3 extract_session.py <session.jsonl> [--output path] [--output-dir path]"""
    parser = argparse.ArgumentParser(
        description="Extract structured signals from an OpenClaw session JSONL file."
    )
    parser.add_argument("session", help="Path to the session JSONL file")
    parser.add_argument(
        "--output", "-o",
        help="Output path for the JSON result (default: stdout)",
        default=None,
    )
    parser.add_argument(
        "--output-dir",
        help="Output directory: writes main.json",
        default=None,
    )
    args = parser.parse_args()

    if args.output and args.output_dir:
        print("Error: --output and --output-dir are mutually exclusive.", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.session):
        print(f"Error: file not found: {args.session}", file=sys.stderr)
        sys.exit(1)

    result = extract_session(
        args.session,
        output_dir=args.output_dir,
    )
    if result is None:
        print("Error: not an OpenClaw session file.", file=sys.stderr)
        sys.exit(1)

    if not args.output_dir:
        output_json = json.dumps(result, indent=2, ensure_ascii=False)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output_json)
                f.write("\n")
            print(f"Written to {args.output}", file=sys.stderr)
        else:
            print(output_json)


if __name__ == "__main__":
    main()
