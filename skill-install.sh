#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Build SIV
echo "[skill-install] Building SIV..."
cd "$SCRIPT_DIR/tools/siv"
npm ci
npm run build

# Link siv binary to PATH
if [ -w /usr/local/bin ]; then
  ln -sf "$SCRIPT_DIR/tools/siv/dist/index.js" /usr/local/bin/siv
  chmod +x /usr/local/bin/siv
  echo "[skill-install] Linked siv to /usr/local/bin/siv"
else
  # Fallback: add to PATH via symlink in home bin
  mkdir -p "$HOME/.local/bin"
  ln -sf "$SCRIPT_DIR/tools/siv/dist/index.js" "$HOME/.local/bin/siv"
  chmod +x "$HOME/.local/bin/siv"
  echo "[skill-install] Linked siv to $HOME/.local/bin/siv"
  echo "[skill-install] Ensure $HOME/.local/bin is in PATH"
fi

echo "[skill-install] Done."
