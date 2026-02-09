#!/usr/bin/env bash
set -euo pipefail

# Claude Relay — Install macOS LaunchAgent
# Runs the daemon automatically on login and restarts on crash.

LABEL="com.somniatore.claude-relay"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/claude-relay"
CONFIG_FILE="$HOME/.config/claude-relay/config.yaml"
DAEMON_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Claude Relay — Service Installer"
echo "================================="
echo ""

# ── Check prerequisites ──

# Node.js
NODE_BIN="$(which node 2>/dev/null || echo "")"
if [ -z "$NODE_BIN" ]; then
  echo "Error: node not found in PATH. Install Node.js 22+ first."
  exit 1
fi

NODE_VERSION=$("$NODE_BIN" -v)
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Error: Node.js 22+ required (found $NODE_VERSION)."
  exit 1
fi
echo "  Node:  $NODE_BIN ($NODE_VERSION)"

# Warn about nvm/fnm/asdf — node path baked into plist will break on version change
if echo "$NODE_BIN" | grep -qE '\.nvm|\.fnm|\.asdf|\.volta'; then
  echo ""
  echo "  ⚠ Node is managed by a version manager (nvm/fnm/asdf/volta)."
  echo "    If you change Node versions, re-run: npm run install-service"
  echo ""
fi

# tmux
if ! command -v tmux &>/dev/null; then
  echo "Error: tmux not found. Install it first:"
  echo "  brew install tmux"
  exit 1
fi
echo "  tmux:  $(which tmux) ($(tmux -V))"

# Daemon built?
if [ ! -f "$DAEMON_DIR/dist/index.js" ]; then
  echo ""
  echo "Error: daemon not built. Run these first:"
  echo "  cd $DAEMON_DIR && npm install && npm run build"
  exit 1
fi
echo "  Daemon: $DAEMON_DIR/dist/index.js"

# ── Capture user's PATH for runtime ──
# LaunchAgents don't inherit shell PATH, so we capture it now.
# This ensures tmux, node, and other tools are findable at runtime.
RUNTIME_PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# ── Create log directory ──
mkdir -p "$LOG_DIR"

# ── Stop existing service if running ──
if launchctl list "$LABEL" &>/dev/null; then
  echo ""
  echo "Stopping existing service..."
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
  sleep 1
fi

# ── Generate plist ──
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$DAEMON_DIR/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DAEMON_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/daemon.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$RUNTIME_PATH</string>
    <key>HOME</key>
    <string>$HOME</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
EOF

# ── Load and start ──
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"

# ── Verify startup ──
echo ""
echo "Waiting for daemon to start..."
sleep 3

STARTED=false
if curl -s --max-time 3 http://localhost:7860/api/status &>/dev/null; then
  STARTED=true
fi

if [ "$STARTED" = true ]; then
  echo "Daemon is running on port 7860."
else
  echo "WARNING: Daemon may have failed to start."
  echo "  Check logs: tail -20 $LOG_DIR/daemon.log"
  echo "              tail -20 $LOG_DIR/daemon.err.log"
  exit 1
fi

# ── Show connection info ──
echo ""
if [ -f "$CONFIG_FILE" ]; then
  PSK=$(grep 'psk:' "$CONFIG_FILE" | head -1 | sed 's/.*psk: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | tr -d ' ')
  echo "  Config: $CONFIG_FILE"
  echo "  PSK:    $PSK"
  echo ""
  echo "  Connect your mobile app with:"
  echo "    Host: <your-mac-ip>:7860"
  echo "    Key:  $PSK"
else
  echo "  Config will be generated at: $CONFIG_FILE"
  echo "  Run 'cat $CONFIG_FILE' after first start to get your PSK."
fi

echo ""
echo "  Status:  curl http://localhost:7860/api/status"
echo "  Logs:    tail -f $LOG_DIR/daemon.log"
echo "  Restart: npm run restart-service"
echo "  Remove:  npm run uninstall-service"
echo ""
echo "The daemon auto-starts on login and restarts on crash."
