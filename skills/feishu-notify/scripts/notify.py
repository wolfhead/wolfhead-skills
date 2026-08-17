#!/usr/bin/env python3
"""Send task completion notifications to Feishu via webhook as interactive cards."""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

ENV_PATH = Path.home() / ".wolfhead-skills" / ".env"
MAX_BODY_BYTES = 28000  # ~28KB, leaving ~2KB for card structure overhead


def read_webhook_url() -> str:
    """Read FEISHU_WEBHOOK_URL from ~/.wolfhead-skills/.env."""
    if not ENV_PATH.exists():
        print(f"Error: config file not found: {ENV_PATH}", file=sys.stderr)
        print(f"Create it with: echo 'FEISHU_WEBHOOK_URL=<your-url>' > {ENV_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() == "FEISHU_WEBHOOK_URL":
                value = value.strip().strip("\"'")
                if value:
                    return value

    print("Error: FEISHU_WEBHOOK_URL not found in " + str(ENV_PATH), file=sys.stderr)
    sys.exit(1)


def truncate_body(body: str, max_bytes: int = MAX_BODY_BYTES) -> str:
    """Truncate body to fit within byte limit, keeping first and last parts."""
    encoded = body.encode("utf-8")
    if len(encoded) <= max_bytes:
        return body

    separator = "\n\n... [truncated — output too long] ...\n\n"
    sep_bytes = len(separator.encode("utf-8"))
    available = max_bytes - sep_bytes
    first_size = int(available * 0.4)
    last_size = int(available * 0.4)

    # Decode safely at character boundaries
    first_part = encoded[:first_size].decode("utf-8", errors="ignore")
    last_part = encoded[-last_size:].decode("utf-8", errors="ignore")

    return first_part + separator + last_part


def build_card(title: str, status: str, body: str) -> dict:
    """Build a Feishu interactive card payload."""
    template = "green" if status == "success" else "red"
    status_emoji = "\u2705" if status == "success" else "\u274c"

    body = truncate_body(body)

    return {
        "msg_type": "interactive",
        "card": {
            "header": {
                "title": {"tag": "plain_text", "content": f"{status_emoji} {title}"},
                "template": template,
            },
            "elements": [
                {
                    "tag": "markdown",
                    "content": body,
                }
            ],
        },
    }


def send(webhook_url: str, payload: dict) -> None:
    """POST the card payload to the Feishu webhook."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_body = resp.read().decode("utf-8")
            resp_data = json.loads(resp_body)
            if resp_data.get("code", 0) != 0:
                print(f"Feishu API error: {resp_body}", file=sys.stderr)
                sys.exit(1)
            print(f"Notification sent (HTTP {resp.status})")
    except urllib.error.HTTPError as e:
        print(f"HTTP error {e.code}: {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Request failed: {e.reason}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Send Feishu notification card")
    parser.add_argument("--title", required=True, help="Card header title (under 50 chars)")
    parser.add_argument("--status", default="success", choices=["success", "failure"],
                        help="Task status (default: success)")
    parser.add_argument("--body", required=True, help="Full detailed result text")
    args = parser.parse_args()

    webhook_url = read_webhook_url()
    payload = build_card(args.title, args.status, args.body)
    send(webhook_url, payload)


if __name__ == "__main__":
    main()
