#!/usr/bin/env python3
"""
Search OpenClaw session JSONL files across agents.

Finds sessions in ~/.openclaw/agents/<agent>/sessions/, filters by date,
turn count, and status, and returns structured results sorted by recency.
"""

import argparse
import datetime
import json
import os
import sys
from pathlib import Path

MAX_SESSIONS = 20
DEFAULT_LATEST = 5
DEFAULT_MIN_TURNS = 3


def count_turns(jsonl_path):
    """Count user message turns in an OpenClaw session JSONL.

    Counts entries where type="message" and message.role="user".
    Skips role="toolResult". Reads line-by-line without loading the entire file.
    """
    count = 0
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("type") != "message":
                continue
            msg = entry.get("message", {})
            if not isinstance(msg, dict):
                continue
            role = msg.get("role")
            if role == "user":
                count += 1
    return count


def search_sessions(
    agent=None,
    since=None,
    date=None,
    latest=DEFAULT_LATEST,
    min_turns=DEFAULT_MIN_TURNS,
    include_reset=False,
):
    """Search for OpenClaw session JSONL files.

    Args:
        agent: Agent name to search (e.g. "main"). If None, search all agents.
        since: Only include sessions modified on or after this date (YYYY-MM-DD).
        date: Only include sessions modified on this exact date (YYYY-MM-DD).
        latest: Maximum number of results to return (capped at MAX_SESSIONS).
        min_turns: Minimum number of user turns required.
        include_reset: If True, include .reset. and .deleted. files.

    Returns:
        List of dicts with keys: path, session_id, agent_id, modified,
        size_bytes, turn_count. Sorted by modification time descending.
    """
    home = os.path.expanduser("~")
    agents_base = os.path.join(home, ".openclaw", "agents")

    if not os.path.isdir(agents_base):
        return []

    # Determine which agent directories to search
    if agent is not None:
        agent_dirs = [agent]
    else:
        try:
            agent_dirs = [
                d for d in os.listdir(agents_base)
                if os.path.isdir(os.path.join(agents_base, d))
            ]
        except OSError:
            return []

    # Parse date filters
    since_dt = None
    date_dt = None
    if since:
        since_dt = datetime.datetime.strptime(since, "%Y-%m-%d")
    if date:
        date_dt = datetime.datetime.strptime(date, "%Y-%m-%d")

    # Collect candidate files
    candidates = []
    for agent_name in agent_dirs:
        sessions_dir = os.path.join(agents_base, agent_name, "sessions")
        if not os.path.isdir(sessions_dir):
            continue
        try:
            filenames = os.listdir(sessions_dir)
        except OSError:
            continue
        for fname in filenames:
            # Skip sessions.json
            if fname == "sessions.json":
                continue
            # Must contain .jsonl
            if ".jsonl" not in fname:
                continue
            # Filter reset/deleted
            if not include_reset:
                if ".reset." in fname or ".deleted." in fname:
                    continue

            fpath = os.path.join(sessions_dir, fname)
            if not os.path.isfile(fpath):
                continue

            stat = os.stat(fpath)
            mtime = stat.st_mtime
            modified_dt = datetime.datetime.fromtimestamp(mtime)

            # Date filters
            if since_dt and modified_dt < since_dt:
                continue
            if date_dt:
                if modified_dt.date() != date_dt.date():
                    continue

            # Extract session_id: UUID part before .jsonl
            session_id = fname.split(".jsonl")[0]

            candidates.append({
                "path": fpath,
                "session_id": session_id,
                "agent_id": agent_name,
                "modified": mtime,
                "size_bytes": stat.st_size,
                "_mtime_for_sort": mtime,
            })

    # Sort by modification time, most recent first
    candidates.sort(key=lambda x: x["_mtime_for_sort"], reverse=True)

    # Apply min_turns filter and collect results up to cap
    cap = min(latest, MAX_SESSIONS)
    results = []
    for c in candidates:
        if len(results) >= cap:
            break
        turns = count_turns(c["path"])
        if turns < min_turns:
            continue
        c["turn_count"] = turns
        del c["_mtime_for_sort"]
        results.append(c)

    return results


def main():
    """CLI entry point for searching OpenClaw sessions."""
    parser = argparse.ArgumentParser(
        description="Search OpenClaw session JSONL files."
    )
    parser.add_argument(
        "--agent",
        default=None,
        help="Agent name to search (default: all agents)",
    )
    parser.add_argument(
        "--latest",
        type=int,
        default=DEFAULT_LATEST,
        help=f"Maximum number of results (default: {DEFAULT_LATEST}, hard cap: {MAX_SESSIONS})",
    )
    parser.add_argument(
        "--min-turns",
        type=int,
        default=DEFAULT_MIN_TURNS,
        help=f"Minimum user turns required (default: {DEFAULT_MIN_TURNS})",
    )
    parser.add_argument(
        "--since",
        default=None,
        help="Only sessions modified on or after this date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--date",
        default=None,
        help="Only sessions modified on this exact date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--include-reset",
        action="store_true",
        default=False,
        help="Include .reset. and .deleted. session files",
    )
    args = parser.parse_args()

    results = search_sessions(
        agent=args.agent,
        since=args.since,
        date=args.date,
        latest=args.latest,
        min_turns=args.min_turns,
        include_reset=args.include_reset,
    )

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
