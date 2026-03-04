#!/usr/bin/env python3
"""Search for Claude Code session files by project, date, and recency.

Searches ~/.claude/projects/ for main session JSONL files.
Filters by project directory, date range, turn count, and recency.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_SESSIONS = 20  # Hard cap to prevent runaway analysis
DEFAULT_LATEST = 5
DEFAULT_MIN_TURNS = 3


def path_to_project_key(project_path):
    """Convert a project directory path to Claude's project key format.

    /Users/me/work/myproject -> -Users-me-work-myproject
    """
    normalized = project_path.rstrip("/")
    return normalized.replace("/", "-")


def count_turns(jsonl_path):
    """Quick-scan a JSONL file to count human message turns.

    Counts records where type="user" and content is a string (not tool_result).
    Reads line-by-line without loading entire file.
    """
    count = 0
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("type") != "user":
                    continue
                content = rec.get("message", {}).get("content")
                # Skip tool_result records (content is a list with tool_result items)
                if isinstance(content, list):
                    if any(isinstance(item, dict) and item.get("type") == "tool_result" for item in content):
                        continue
                count += 1
    except (OSError, IOError):
        return 0
    return count


def search_sessions(project_path=None, since=None, date=None, latest=DEFAULT_LATEST,
                     min_turns=DEFAULT_MIN_TURNS):
    """Search for session JSONL files matching the given criteria.

    Args:
        project_path: Filter by project directory path (converted to project key).
                      If None, searches all projects.
        since: Only include sessions modified on or after this date (YYYY-MM-DD).
        date: Only include sessions modified on this exact date (YYYY-MM-DD).
        latest: Return at most this many sessions (most recent first).
        min_turns: Exclude sessions with fewer than this many human turns.

    Returns:
        List of dicts sorted by modification time (most recent first):
        [{"path", "session_id", "modified", "size_bytes", "turn_count"}, ...]
    """
    home = os.environ.get("HOME", os.path.expanduser("~"))
    projects_dir = Path(home) / ".claude" / "projects"

    if not projects_dir.is_dir():
        return []

    # Determine which project directories to search
    if project_path:
        key = path_to_project_key(project_path)
        search_dirs = [projects_dir / key]
    else:
        search_dirs = [d for d in projects_dir.iterdir() if d.is_dir()]

    # Collect candidate session files
    candidates = []
    for proj_dir in search_dirs:
        if not proj_dir.is_dir():
            continue
        for f in proj_dir.glob("*.jsonl"):
            # Skip files inside subagent directories
            if "subagents" in f.parts:
                continue
            candidates.append(f)

    # Filter by date
    if since:
        since_dt = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        candidates = [f for f in candidates if datetime.fromtimestamp(
            f.stat().st_mtime, tz=timezone.utc) >= since_dt]

    if date:
        date_dt = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        date_end = date_dt.replace(hour=23, minute=59, second=59)
        candidates = [f for f in candidates if date_dt <= datetime.fromtimestamp(
            f.stat().st_mtime, tz=timezone.utc) <= date_end]

    # Sort by modification time (most recent first)
    candidates.sort(key=lambda f: f.stat().st_mtime, reverse=True)

    # Build results with turn count filter
    results = []
    for f in candidates:
        if len(results) >= min(latest, MAX_SESSIONS):
            break

        turns = count_turns(str(f))
        if turns < min_turns:
            continue

        stat = f.stat()
        session_id = f.stem  # UUID without .jsonl

        results.append({
            "path": str(f),
            "session_id": session_id,
            "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%S"),
            "size_bytes": stat.st_size,
            "turn_count": turns,
        })

    if len(candidates) > MAX_SESSIONS:
        print(f"Warning: {len(candidates)} sessions found, returning {MAX_SESSIONS} most recent",
              file=sys.stderr)

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Search for Claude Code session files."
    )
    parser.add_argument("--project", help="Project directory path to filter by")
    parser.add_argument("--since", help="Only sessions modified on/after this date (YYYY-MM-DD)")
    parser.add_argument("--date", help="Only sessions modified on this date (YYYY-MM-DD)")
    parser.add_argument("--latest", type=int, default=DEFAULT_LATEST,
                        help=f"Max sessions to return (default: {DEFAULT_LATEST}, hard cap: {MAX_SESSIONS})")
    parser.add_argument("--min-turns", type=int, default=DEFAULT_MIN_TURNS,
                        help=f"Min human turns to include (default: {DEFAULT_MIN_TURNS})")
    args = parser.parse_args()

    results = search_sessions(
        project_path=args.project,
        since=args.since,
        date=args.date,
        latest=args.latest,
        min_turns=args.min_turns,
    )
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
