#!/usr/bin/env bash
set -euo pipefail

# Claude Relay — Uninstall macOS LaunchAgent

LABEL="com.somniatore.claude-relay"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -f "$PLIST_PATH" ]; then
  echo "Service not installed (no plist at $PLIST_PATH)."
  exit 0
fi

echo "Stopping and removing Claude Relay daemon..."
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true

# Verify process stopped
sleep 1
if launchctl list "$LABEL" &>/dev/null; then
  echo "Warning: service may still be running. Force kill:"
  echo "  pkill -f 'claude-relay/daemon/dist/index.js'"
fi

rm -f "$PLIST_PATH"

echo ""
echo "Claude Relay daemon uninstalled."
echo "Logs preserved at ~/Library/Logs/claude-relay/ (delete manually if desired)."
echo "Config preserved at ~/.config/claude-relay/ (delete manually if desired)."
