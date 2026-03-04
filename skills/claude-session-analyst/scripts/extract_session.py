#!/usr/bin/env python3
"""
Extract structured signals from Claude Code JSONL session files.

Parses session JSONL and produces condensed JSON with metadata,
conversation flow, tool usage, subagent activity, and error signals.
"""

import json
import os
import re
import sys
import argparse
from pathlib import Path


CONTENT_PREVIEW_MAX_CHARS = 500  # Enough context for analysis without bloating output
TOOL_INPUT_MAX_CHARS = 200  # Tool call inputs: keep key params, drop file content

# ---------------------------------------------------------------------------
# Task 2 — Core parser
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


def classify_record(record):
    """Classify a parsed JSONL record into a semantic category.

    Returns one of:
        human_message, tool_result, assistant, agent_progress,
        bash_progress, hook_progress, turn_duration, api_error,
        compact_boundary, summary, queue_operation, skip
    """
    rtype = record.get("type")

    if rtype == "user":
        msg = record.get("message", {})
        content = msg.get("content")
        if isinstance(content, list):
            # Only classify as tool_result if at least one item is a tool_result
            if any(isinstance(item, dict) and item.get("type") == "tool_result" for item in content):
                return "tool_result"
            return "human_message"
        return "human_message"

    if rtype == "assistant":
        return "assistant"

    if rtype == "progress":
        data = record.get("data", {})
        dtype = data.get("type", "")
        if dtype == "agent_progress":
            return "agent_progress"
        if dtype == "bash_progress":
            return "bash_progress"
        if dtype == "hook_progress":
            return "hook_progress"
        return "skip"

    if rtype == "system":
        subtype = record.get("subtype", "")
        if subtype == "turn_duration":
            return "turn_duration"
        if subtype == "api_error":
            return "api_error"
        if subtype == "compact_boundary":
            return "compact_boundary"
        return "skip"

    if rtype == "summary":
        return "summary"

    if rtype == "queue-operation":
        return "queue_operation"

    # file-history-snapshot, saved_hook_context, unknown
    return "skip"


def is_main_session(path):
    """Check if a JSONL file is a main session (not a subagent).

    Reads the first record: returns False if isSidechain=True or agentId present.
    Returns True for main sessions. Returns False if the file is empty or unreadable.
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
                    continue
                if record.get("isSidechain") is True:
                    return False
                if record.get("agentId"):
                    return False
                return True
    except (OSError, IOError):
        return False
    return False


# ---------------------------------------------------------------------------
# Task 3 — Metadata extraction
# ---------------------------------------------------------------------------

def extract_metadata(records):
    """Extract session metadata from a list of parsed records.

    Returns a dict with: session_id, slug, cwd, git_branch, model, version,
    first_timestamp, last_timestamp, token totals (input_tokens, output_tokens,
    cache_read_tokens, cache_creation_tokens), turn_count, turn_durations.
    """
    meta = {
        "session_id": None,
        "slug": None,
        "cwd": None,
        "git_branch": None,
        "model": None,
        "version": None,
        "first_timestamp": None,
        "last_timestamp": None,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_creation_tokens": 0,
        "turn_count": 0,
        "turn_durations": [],
    }

    for rec in records:
        # Session-level fields: take from first record that has them
        if meta["session_id"] is None and rec.get("sessionId"):
            meta["session_id"] = rec["sessionId"]
        if meta["slug"] is None and rec.get("slug"):
            meta["slug"] = rec["slug"]
        if meta["cwd"] is None and rec.get("cwd"):
            meta["cwd"] = rec["cwd"]
        if meta["git_branch"] is None and rec.get("gitBranch"):
            meta["git_branch"] = rec["gitBranch"]
        if meta["version"] is None and rec.get("version"):
            meta["version"] = rec["version"]

        # Timestamps
        ts = rec.get("timestamp")
        if ts:
            if meta["first_timestamp"] is None:
                meta["first_timestamp"] = ts
            meta["last_timestamp"] = ts

        # Model from assistant records
        if rec.get("type") == "assistant":
            msg = rec.get("message", {})
            if meta["model"] is None and msg.get("model"):
                meta["model"] = msg["model"]
            usage = msg.get("usage", {})
            if isinstance(usage, dict):
                meta["input_tokens"] += usage.get("input_tokens", 0)
                meta["output_tokens"] += usage.get("output_tokens", 0)
                meta["cache_read_tokens"] += usage.get("cache_read_input_tokens", 0)
                meta["cache_creation_tokens"] += usage.get("cache_creation_input_tokens", 0)

        # Turn durations
        if rec.get("type") == "system" and rec.get("subtype") == "turn_duration":
            duration_ms = rec.get("durationMs")
            if duration_ms is not None:
                meta["turn_durations"].append(duration_ms)
                meta["turn_count"] += 1

    return meta


# ---------------------------------------------------------------------------
# Task 4 — Conversation flow
# ---------------------------------------------------------------------------

def _build_tool_name_map(records):
    """Build a dict mapping tool_use_id -> tool_name from assistant records.

    Scans all assistant records once (O(N)) so callers avoid repeated O(N) lookups.
    """
    tool_map = {}
    for rec in records:
        if rec.get("type") != "assistant":
            continue
        content = rec.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get("type") == "tool_use":
                tool_map[block.get("id", "")] = block.get("name", "unknown")
    return tool_map


def _truncate(text, max_len=CONTENT_PREVIEW_MAX_CHARS):
    """Truncate text to max_len characters, appending '...' if truncated."""
    if not isinstance(text, str):
        text = str(text)
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


def _summarize_tool_input(name, inp):
    """Summarize tool call input to key params only, dropping large content.

    For Write/Edit: keep file_path, drop content/new_string/old_string.
    For Read: keep file_path, offset, limit.
    For Bash: keep command (truncated).
    For Agent: keep description, subagent_type, model.
    For others: truncate the whole input dict.
    """
    if not isinstance(inp, dict):
        return inp

    if name == "Write":
        summary = {"file_path": inp.get("file_path", "")}
        if "content" in inp:
            summary["content"] = f"({len(inp['content'])} chars)"
        return summary
    elif name == "Edit":
        summary = {"file_path": inp.get("file_path", "")}
        if "old_string" in inp:
            summary["old_string"] = _truncate(inp["old_string"], 100)
        if "new_string" in inp:
            summary["new_string"] = _truncate(inp["new_string"], 100)
        return summary
    elif name == "Read":
        summary = {"file_path": inp.get("file_path", "")}
        for k in ("offset", "limit", "pages"):
            if k in inp:
                summary[k] = inp[k]
        return summary
    elif name == "Bash":
        summary = {}
        if "command" in inp:
            summary["command"] = _truncate(inp["command"], TOOL_INPUT_MAX_CHARS)
        if "description" in inp:
            summary["description"] = _truncate(inp["description"], TOOL_INPUT_MAX_CHARS)
        return summary
    elif name in ("Agent", "Task"):
        summary = {}
        for k in ("description", "subagent_type", "model", "run_in_background"):
            if k in inp:
                summary[k] = inp[k]
        if "prompt" in inp:
            summary["prompt"] = f"({len(inp['prompt'])} chars)"
        return summary
    elif name == "Grep":
        summary = {}
        for k in ("pattern", "path", "glob", "type", "output_mode"):
            if k in inp:
                summary[k] = inp[k]
        return summary
    elif name == "Glob":
        return {k: inp[k] for k in ("pattern", "path") if k in inp}
    else:
        # Generic: truncate the JSON representation
        raw = json.dumps(inp, ensure_ascii=False)
        if len(raw) <= TOOL_INPUT_MAX_CHARS:
            return inp
        return {"_summary": _truncate(raw, TOOL_INPUT_MAX_CHARS)}


def _extract_tool_result_content(content_value):
    """Extract string content from a tool_result content field.

    Content can be a string or an array of {type: "text", text: "..."}.
    """
    if isinstance(content_value, str):
        return content_value
    if isinstance(content_value, list):
        parts = []
        for item in content_value:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(content_value) if content_value else ""


def extract_conversation(records):
    """Extract the conversation flow as a list of turns.

    Each turn is a dict with one of:
    - {"type": "human_message", "text": "..."}
    - {"type": "assistant_turn", "message_id": "...", "text": "...", "tool_calls": [...]}
    - {"type": "tool_result", "tool_use_id": "...", "tool_name": "...", "is_error": bool, "content_preview": "..."}
    """
    turns = []
    tool_name_map = _build_tool_name_map(records)
    success_count = 0  # Count successful tool results (not stored individually)

    # Group assistant records by message.id
    # We process records in order and emit turns sequentially
    seen_message_ids = {}  # message_id -> index in turns list

    for rec in records:
        cat = classify_record(rec)

        if cat == "human_message":
            msg = rec.get("message", {})
            content = msg.get("content", "")
            turns.append({
                "type": "human_message",
                "text": content if isinstance(content, str) else str(content),
            })

        elif cat == "assistant":
            msg = rec.get("message", {})
            message_id = msg.get("id", "")
            content_blocks = msg.get("content", [])
            if not isinstance(content_blocks, list):
                continue

            # Collect text and tool_calls from this record's content blocks
            texts = []
            tool_calls = []
            for block in content_blocks:
                btype = block.get("type")
                if btype == "text":
                    t = block.get("text", "").strip()
                    if t:
                        texts.append(t)
                elif btype == "tool_use":
                    tool_name = block.get("name", "")
                    tool_calls.append({
                        "tool_use_id": block.get("id", ""),
                        "name": tool_name,
                        "input": _summarize_tool_input(tool_name, block.get("input", {})),
                    })
                # Skip thinking blocks

            if message_id in seen_message_ids:
                # Append to existing assistant turn
                idx = seen_message_ids[message_id]
                existing = turns[idx]
                if texts:
                    if existing["text"]:
                        existing["text"] += "\n" + "\n".join(texts)
                    else:
                        existing["text"] = "\n".join(texts)
                existing["tool_calls"].extend(tool_calls)
            else:
                turn = {
                    "type": "assistant_turn",
                    "message_id": message_id,
                    "text": "\n".join(texts),
                    "tool_calls": tool_calls,
                }
                seen_message_ids[message_id] = len(turns)
                turns.append(turn)

        elif cat == "tool_result":
            msg = rec.get("message", {})
            content = msg.get("content", [])
            if not isinstance(content, list):
                continue
            for item in content:
                if not isinstance(item, dict):
                    continue
                if item.get("type") != "tool_result":
                    continue
                is_error = item.get("is_error", False)
                if is_error:
                    # Keep full detail for errors
                    tool_use_id = item.get("tool_use_id", "")
                    raw_content = _extract_tool_result_content(item.get("content", ""))
                    tool_name = tool_name_map.get(tool_use_id, "unknown")
                    turns.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "tool_name": tool_name,
                        "is_error": True,
                        "content_preview": _truncate(raw_content, 500),
                    })
                else:
                    success_count += 1

    # Prepend a summary of successful tool results
    if success_count > 0:
        turns.insert(0, {
            "type": "tool_results_summary",
            "successful_tool_results": success_count,
            "note": "Only error tool results are shown individually below.",
        })

    return turns


# ---------------------------------------------------------------------------
# Task 5 — Signal extraction
# ---------------------------------------------------------------------------

def extract_skills(records):
    """Extract Skill tool invocations with name, args, and result.

    Returns list of dicts with: skill_name, args, tool_use_id, result.
    """
    skills = []
    # First pass: find Skill tool_use blocks
    skill_calls = {}  # tool_use_id -> skill info
    for rec in records:
        if rec.get("type") != "assistant":
            continue
        content = rec.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get("type") == "tool_use" and block.get("name") == "Skill":
                inp = block.get("input", {})
                tool_use_id = block.get("id", "")
                skill_calls[tool_use_id] = {
                    "skill_name": inp.get("skill", ""),
                    "args": inp.get("args", ""),
                    "tool_use_id": tool_use_id,
                    "result": None,
                }

    # Second pass: match tool results
    for rec in records:
        cat = classify_record(rec)
        if cat != "tool_result":
            continue
        content = rec.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            tuid = item.get("tool_use_id", "")
            if tuid in skill_calls:
                raw = _extract_tool_result_content(item.get("content", ""))
                skill_calls[tuid]["result"] = _truncate(raw, 500)

    return list(skill_calls.values())


def extract_subagents(records):
    """Extract Agent/Task (subagent) tool invocations.

    The tool is named "Agent" in Claude Code JSONL files (may also appear as
    "Task" in some versions). Both names are matched.

    Returns list of dicts with: description, prompt, subagent_type,
    tool_use_id, agent_id, status, duration, tokens.
    """
    subagents = []
    task_calls = {}  # tool_use_id -> info

    for rec in records:
        if rec.get("type") != "assistant":
            continue
        content = rec.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get("type") == "tool_use" and block.get("name") in ("Task", "Agent"):
                inp = block.get("input", {})
                tool_use_id = block.get("id", "")
                task_calls[tool_use_id] = {
                    "description": inp.get("description", ""),
                    "prompt": _truncate(inp.get("prompt", ""), 500),
                    "subagent_type": inp.get("subagent_type", ""),
                    "tool_use_id": tool_use_id,
                    "agent_id": None,
                    "status": None,
                    "duration": None,
                    "tokens": None,
                }

    # Match tool results
    for rec in records:
        cat = classify_record(rec)
        if cat != "tool_result":
            continue

        content = rec.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            tuid = item.get("tool_use_id", "")
            if tuid not in task_calls:
                continue

            entry = task_calls[tuid]

            # Extract agentId/status from toolUseResult (scoped per item match)
            tur = rec.get("toolUseResult", {})
            if isinstance(tur, dict):
                if tur.get("agentId"):
                    entry["agent_id"] = tur["agentId"]
                if tur.get("status"):
                    entry["status"] = tur["status"]

            # Parse agent_id, duration, tokens from text content
            raw = _extract_tool_result_content(item.get("content", ""))
            # agentId pattern: "agentId: <hex or UUID>"
            m = re.search(r"agentId:\s*([a-fA-F0-9][a-fA-F0-9\-]+)", raw)
            if m and not entry["agent_id"]:
                entry["agent_id"] = m.group(1)
            # duration pattern: "duration_ms: <number>"
            m = re.search(r"duration_ms:\s*(\d+)", raw)
            if m:
                entry["duration"] = int(m.group(1))
            # tokens pattern: "total_tokens: <number>"
            m = re.search(r"total_tokens:\s*(\d+)", raw)
            if m:
                entry["tokens"] = int(m.group(1))

            # Status from toolUseResult or infer from content
            if not entry["status"]:
                entry["status"] = "completed"

    return list(task_calls.values())


def extract_tool_failures(records):
    """Extract tool results with is_error=True.

    Returns list of dicts with: tool_use_id, tool_name, content_preview.
    """
    tool_name_map = _build_tool_name_map(records)
    failures = []
    for rec in records:
        cat = classify_record(rec)
        if cat != "tool_result":
            continue
        content = rec.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "tool_result":
                continue
            if not item.get("is_error"):
                continue
            tuid = item.get("tool_use_id", "")
            raw = _extract_tool_result_content(item.get("content", ""))
            tool_name = tool_name_map.get(tuid, "unknown")
            failures.append({
                "tool_use_id": tuid,
                "tool_name": tool_name,
                "content_preview": _truncate(raw, 500),
            })
    return failures


def extract_api_errors(records):
    """Extract system api_error records.

    Returns list of dicts with: cause, retry_attempt, max_retries, retry_in_ms, timestamp.
    """
    errors = []
    for rec in records:
        if rec.get("type") != "system" or rec.get("subtype") != "api_error":
            continue
        errors.append({
            "cause": rec.get("cause"),
            "retry_attempt": rec.get("retryAttempt"),
            "max_retries": rec.get("maxRetries"),
            "retry_in_ms": rec.get("retryInMs"),
            "timestamp": rec.get("timestamp"),
        })
    return errors


def extract_compactions(records):
    """Extract compact_boundary records.

    Returns list of dicts with: timestamp, trigger, pre_tokens, content.
    """
    compactions = []
    for rec in records:
        if rec.get("type") != "system" or rec.get("subtype") != "compact_boundary":
            continue
        cm = rec.get("compactMetadata", {})
        compactions.append({
            "timestamp": rec.get("timestamp"),
            "trigger": cm.get("trigger") if isinstance(cm, dict) else None,
            "pre_tokens": cm.get("preTokens") if isinstance(cm, dict) else None,
            "content": rec.get("content"),
        })
    return compactions


# ---------------------------------------------------------------------------
# Task 6 — Pipeline + CLI
# ---------------------------------------------------------------------------

def find_subagent_files(path):
    """Discover subagent JSONL files relative to a session file.

    Given a session file at <dir>/<session-uuid>.jsonl, looks for
    <dir>/<session-uuid>/subagents/agent-*.jsonl.

    Returns a list of Path objects for discovered subagent files.
    """
    session_path = Path(path)
    session_stem = session_path.stem  # UUID without .jsonl
    session_dir = session_path.parent
    subagents_dir = session_dir / session_stem / "subagents"

    if not subagents_dir.is_dir():
        return []

    files = sorted(subagents_dir.glob("agent-*.jsonl"))
    return files


def extract_session(path):
    """Full extraction pipeline for a session JSONL file.

    Validates the file is a main session, then extracts all signals.
    Returns None if the file is not a main session.

    Returns a dict with keys: metadata, conversation, skills, subagents,
    tool_failures, api_errors, compactions, subagent_files.
    """
    if not is_main_session(path):
        return None

    records = parse_jsonl(path)

    result = {
        "metadata": extract_metadata(records),
        "conversation": extract_conversation(records),
        "skills": extract_skills(records),
        "subagents": extract_subagents(records),
        "tool_failures": extract_tool_failures(records),
        "api_errors": extract_api_errors(records),
        "compactions": extract_compactions(records),
        "subagent_files": [str(f) for f in find_subagent_files(path)],
    }
    return result


def extract_subsession(path):
    """Extract condensed data from a subagent JSONL file.
    Same extraction as main session but skips the is_main_session check.
    Returns None if the file doesn't exist or can't be parsed.
    """
    if not os.path.isfile(path):
        return None
    records = parse_jsonl(path)
    if not records:
        return None
    return {
        "metadata": extract_metadata(records),
        "conversation": extract_conversation(records),
        "skills": extract_skills(records),
        "subagents": extract_subagents(records),
        "tool_failures": extract_tool_failures(records),
        "api_errors": extract_api_errors(records),
        "compactions": extract_compactions(records),
    }


def main():
    """CLI entry point: python3 extract_session.py <session.jsonl> [--output path] [--output-dir path]"""
    parser = argparse.ArgumentParser(
        description="Extract structured signals from a Claude Code session JSONL file."
    )
    parser.add_argument("session", help="Path to the session JSONL file")
    parser.add_argument(
        "--output", "-o",
        help="Output path for the JSON result (default: stdout)",
        default=None,
    )
    parser.add_argument(
        "--output-dir",
        help="Output directory: writes main.json + subagents/*.json",
        default=None,
    )
    args = parser.parse_args()

    if args.output and args.output_dir:
        print("Error: --output and --output-dir are mutually exclusive.", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.session):
        print(f"Error: file not found: {args.session}", file=sys.stderr)
        sys.exit(1)

    result = extract_session(args.session)
    if result is None:
        print("Error: not a main session file (subagent or invalid).", file=sys.stderr)
        sys.exit(1)

    if args.output_dir:
        # Directory mode: main.json + subagents/*.json
        out_dir = Path(args.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)

        # Write subagent JSONs first so we can collect output paths
        subagent_outputs = []
        subagent_files = find_subagent_files(args.session)
        if subagent_files:
            subagents_out = out_dir / "subagents"
            subagents_out.mkdir(parents=True, exist_ok=True)
            for sf in subagent_files:
                sub_result = extract_subsession(str(sf))
                if sub_result is not None:
                    sub_out_path = subagents_out / (sf.stem + ".json")
                    with open(sub_out_path, "w", encoding="utf-8") as f:
                        json.dump(sub_result, f, indent=2, ensure_ascii=False)
                        f.write("\n")
                    subagent_outputs.append(str(sub_out_path))
                    print(f"Written to {sub_out_path}", file=sys.stderr)

        # Write main.json with subagent_outputs list
        result["subagent_outputs"] = subagent_outputs
        main_path = out_dir / "main.json"
        with open(main_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"Written to {main_path}", file=sys.stderr)
    else:
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
