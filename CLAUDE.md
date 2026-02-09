# CLAUDE.md - Claude Conduit

> **Quick reference for Claude/Copilot when working on this repository.**

## Project Overview

Claude Conduit is a mobile remote session manager for Claude Code. It lets you access and continue Claude Code sessions from an iPad/iPhone over your network.

**Components:**
- **Relay Daemon** (`daemon/`) — Node.js service running on Mac. Discovers Claude sessions, manages tmux lifecycle, bridges WebSocket to terminal via node-pty.
- **Mobile App** (`mobile/`) — React Native iOS app (Phase 2). Session picker + xterm.js terminal in WebView.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 22+ |
| Framework | Fastify 5 + @fastify/websocket |
| Terminal | node-pty (PTY ↔ tmux attach) |
| File watching | chokidar |
| Auth | Pre-shared key (PSK) |
| Config | YAML (~/.config/claude-conduit/config.yaml) |
| Types | TypeScript 5.7 strict |
| Mobile (Phase 2) | React Native 0.76+, xterm.js in WebView |

## Before ANY Commit

```bash
cd daemon
npx tsc --noEmit    # Type check
```

## Project Structure

```
claude-conduit/
├── CLAUDE.md               # This file
├── package.json            # Workspace root
├── daemon/                 # Relay daemon
│   ├── src/
│   │   ├── index.ts        # Entry point (Fastify + WS)
│   │   ├── config.ts       # YAML config loader
│   │   ├── auth.ts         # PSK middleware
│   │   ├── sessions/
│   │   │   ├── discovery.ts # JSONL scanner + chokidar + disk cache
│   │   │   └── types.ts
│   │   ├── tmux/
│   │   │   ├── manager.ts  # Create/attach/list/kill tmux
│   │   │   ├── lock.ts     # Per-session mutex
│   │   │   └── types.ts
│   │   ├── terminal/
│   │   │   └── bridge.ts   # WS ↔ node-pty ↔ tmux
│   │   └── routes/
│   │       ├── sessions.ts # GET /api/sessions, GET /api/sessions/:id
│   │       ├── attach.ts   # POST /api/sessions/:id/attach
│   │       ├── stream.ts   # GET /api/sessions/stream (SSE)
│   │       └── status.ts   # GET /api/status
│   ├── scripts/
│   │   ├── install-service.sh   # Install macOS LaunchAgent
│   │   ├── uninstall-service.sh # Remove LaunchAgent
│   │   └── restart-service.sh   # Restart daemon
│   └── launchd/
│       └── com.somniatore.claude-conduit.plist  # Template (reference only)
└── mobile/                 # Phase 2

```

## Local Development

```bash
cd daemon
npm install
npm run dev          # tsx watch mode
# Verify: curl http://localhost:7860/api/status
```

## Key Design Decisions

- **Terminal-first**: xterm.js renders Claude's native terminal UI — no custom chat UI
- **tmux for persistence**: Sessions survive disconnects, scrollback preserved
- **node-pty**: Same approach as VS Code. Spawns PTY running `tmux attach`
- **chokidar**: macOS `fs.watch` is unreliable for recursive/symlink watching
- **Session locking**: pgrep + per-session mutex prevents conflicts
- **Backpressure**: 64KB WS buffer threshold, 16ms output batching

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/status` | No | Daemon health check |
| GET | `/api/sessions` | PSK | List all Claude sessions |
| GET | `/api/sessions/:id` | PSK | Session detail |
| GET | `/api/projects` | PSK | Sessions grouped by project |
| POST | `/api/sessions/:id/attach` | PSK | Create/attach tmux session |
| GET | `/api/sessions/stream` | PSK | SSE real-time session updates |
| WS | `/terminal/:sessionId` | PSK (query param `token`) | Terminal bridge |

## Configuration

Config at `~/.config/claude-conduit/config.yaml` (auto-generated on first run with random PSK):

```yaml
port: 7860
host: "0.0.0.0"
auth:
  psk: "<generated>"
tmux:
  defaultCols: 120
  defaultRows: 40
claude:
  binary: "claude"
  maxSessions: 5
```

## Error Response Format

All error responses follow:
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message",
  "action": "What the user should do"
}
```

---

*Last updated: February 2026*
