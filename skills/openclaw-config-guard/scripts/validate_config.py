#!/usr/bin/env python3
"""Validate openclaw config JSON syntax and check env var references."""
import json
import os
import sys
import re

def main():
    config_path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.openclaw/openclaw.json")
    env_path = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/.openclaw/.env")

    # 1. JSON syntax check
    try:
        with open(config_path) as f:
            raw = f.read()
        config = json.loads(raw)
        print(f"✅ JSON syntax valid: {config_path}")
    except json.JSONDecodeError as e:
        print(f"❌ JSON syntax error: {e}")
        sys.exit(1)
    except FileNotFoundError:
        print(f"❌ Config file not found: {config_path}")
        sys.exit(1)

    # 2. Collect env var references from config
    env_refs = set(re.findall(r'\$\{([A-Z_][A-Z0-9_]*)\}', raw))
    if not env_refs:
        print("✅ No env var references found")
        sys.exit(0)

    # 3. Load .env file
    defined_vars = set()
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key = line.split('=', 1)[0].strip()
                    defined_vars.add(key)

    # Also check actual environment
    for ref in env_refs:
        if os.environ.get(ref):
            defined_vars.add(ref)

    # 4. Report missing vars
    missing = env_refs - defined_vars
    if missing:
        print(f"⚠️  Missing env vars (referenced but not in .env or environment):")
        for var in sorted(missing):
            print(f"   - ${{{var}}}")
        sys.exit(2)
    else:
        print(f"✅ All {len(env_refs)} env var references resolved")
        sys.exit(0)

if __name__ == "__main__":
    main()
