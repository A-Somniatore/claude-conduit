#!/usr/bin/env bash
set -euo pipefail

# Claude Conduit — Restart the LaunchAgent (after code update or config change)

LABEL="com.somniatore.claude-conduit"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -f "$PLIST_PATH" ]; then
  echo "Service not installed. Run 'npm run install-service' first."
  exit 1
fi

echo "Restarting Claude Conduit daemon..."
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"

sleep 2
if curl -s --max-time 3 http://localhost:7860/api/status &>/dev/null; then
  echo "Daemon restarted successfully."
else
  echo "WARNING: Daemon may have failed to start. Check logs:"
  echo "  tail -20 ~/Library/Logs/claude-conduit/daemon.log"
fi
