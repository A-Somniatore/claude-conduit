import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WebSocket } from "ws";
import type { FastifyBaseLogger } from "fastify";
import type { RelayConfig } from "../config.js";

const execAsync = promisify(execFile);

// node-pty uses CommonJS — need dynamic import
let ptyModule: typeof import("node-pty") | null = null;
async function loadPty(): Promise<typeof import("node-pty")> {
  if (!ptyModule) {
    ptyModule = await import("node-pty");
  }
  return ptyModule;
}

interface ActiveTerminal {
  pty: import("node-pty").IPty;
  sessionId: string;
  ws: WebSocket;
  createdAt: Date;
  cleanedUp: boolean;
}

const BACKPRESSURE_THRESHOLD = 64 * 1024; // 64KB
const OUTPUT_BUFFER_MAX = 1024 * 1024; // 1MB cap
const BATCH_INTERVAL_MS = 16; // ~60fps

export class TerminalBridge {
  private log: FastifyBaseLogger;
  private config: RelayConfig;
  private terminals = new Map<string, ActiveTerminal>();
  private reapTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RelayConfig, log: FastifyBaseLogger) {
    this.log = log.child({ module: "terminal" });
    this.config = config;
  }

  start(): void {
    this.reapTimer = setInterval(() => this.reapOrphans(), 60_000);
  }

  async stop(): Promise<void> {
    if (this.reapTimer) clearInterval(this.reapTimer);
    const cleanups: Promise<void>[] = [];
    for (const [id, terminal] of this.terminals) {
      cleanups.push(this.cleanupTerminal(id, terminal));
    }
    await Promise.all(cleanups);
  }

  /** Check if a session has an active terminal — single source of truth. */
  hasActiveTerminal(sessionId: string): boolean {
    return this.terminals.has(sessionId);
  }

  /**
   * Attach a WebSocket to a tmux session via node-pty.
   * The PTY runs `tmux attach-session -t <name>`.
   */
  async attach(
    sessionId: string,
    tmuxSession: string,
    ws: WebSocket,
    cols: number,
    rows: number,
  ): Promise<void> {
    const existing = this.terminals.get(sessionId);
    if (existing) {
      // If the existing WS is dead/closing, proactively clean it up
      // instead of waiting for the 60s orphan reaper.
      if (
        existing.ws.readyState === existing.ws.CLOSED ||
        existing.ws.readyState === existing.ws.CLOSING
      ) {
        this.log.info({ sessionId }, "Cleaning up stale terminal connection for reconnect");
        this.cleanupTerminal(sessionId, existing);
      } else {
        ws.close(4409, "Session already has an active terminal connection");
        return;
      }
    }

    const pty = await loadPty();

    // Disable tmux status bar — it steals a row and causes rendering issues
    // with Claude Code's ANSI cursor repositioning (spinners, progress bars).
    try {
      await execAsync("tmux", ["set-option", "-t", tmuxSession, "status", "off"]);
    } catch {
      // Non-fatal — session might not exist yet or tmux might not be running
    }

    const ptyProcess = pty.spawn("tmux", ["attach-session", "-t", tmuxSession], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME ?? "/",
      env: process.env as Record<string, string>,
    });

    const terminal: ActiveTerminal = {
      pty: ptyProcess,
      sessionId,
      ws,
      createdAt: new Date(),
      cleanedUp: false,
    };

    this.terminals.set(sessionId, terminal);

    this.log.info(
      { sessionId, tmuxSession, pid: ptyProcess.pid, cols, rows },
      "Terminal attached",
    );

    // Suppress initial tmux pane redraw — discard first 500ms of output,
    // then force a resize to trigger a clean redraw at the phone's dimensions.
    let initialFlushDone = false;
    const initialFlushTimer = setTimeout(() => {
      initialFlushDone = true;
      ptyProcess.resize(cols, rows);
    }, 500);

    // Output batching for backpressure control
    let outputBuffer: Buffer[] = [];
    let outputBufferSize = 0;
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    const clearBatchTimer = (): void => {
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
    };

    const flushOutput = (): void => {
      batchTimer = null;
      if (outputBuffer.length === 0) return;
      if (ws.readyState !== ws.OPEN) return;

      // Check backpressure — retry later if buffer full
      if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) {
        batchTimer = setTimeout(flushOutput, BATCH_INTERVAL_MS);
        return;
      }

      const combined = Buffer.concat(outputBuffer);
      outputBuffer = [];
      outputBufferSize = 0;
      ws.send(combined);
    };

    // PTY → WS (binary)
    ptyProcess.onData((data: string) => {
      // Discard initial tmux pane dump (first 500ms)
      if (!initialFlushDone) return;

      const buf = Buffer.from(data, "utf-8");

      // FIFO eviction — drop oldest chunks until there's room
      while (outputBufferSize + buf.length > OUTPUT_BUFFER_MAX && outputBuffer.length > 0) {
        const dropped = outputBuffer.shift();
        if (dropped) outputBufferSize -= dropped.length;
      }

      outputBuffer.push(buf);
      outputBufferSize += buf.length;

      if (!batchTimer) {
        batchTimer = setTimeout(flushOutput, BATCH_INTERVAL_MS);
      }
    });

    // PTY exit — cleanup including SIGKILL escalation
    ptyProcess.onExit(({ exitCode, signal }) => {
      this.log.info({ sessionId, exitCode, signal }, "PTY process exited");
      clearTimeout(initialFlushTimer);
      clearBatchTimer();
      flushOutput();
      this.cleanupTerminal(sessionId, terminal);

      if (ws.readyState === ws.OPEN) {
        ws.close(1000, "Terminal session ended");
      }
    });

    // WS → PTY
    ws.on("message", (data: Buffer | string, isBinary: boolean) => {
      if (isBinary) {
        // Binary frame = terminal input
        ptyProcess.write(data.toString("utf-8"));
        return;
      }

      // Text frame = control message (JSON only). Non-JSON text is dropped.
      const text = typeof data === "string" ? data : data.toString("utf-8");
      try {
        const msg = JSON.parse(text) as {
          type: string;
          cols?: number;
          rows?: number;
        };

        if (msg.type === "resize" && msg.cols && msg.rows) {
          ptyProcess.resize(msg.cols, msg.rows);
          this.log.debug(
            { sessionId, cols: msg.cols, rows: msg.rows },
            "Terminal resized",
          );
          return;
        }

        // Valid JSON but unrecognized type — drop it
        this.log.warn({ sessionId, type: msg.type }, "Unrecognized control message type, dropping");
      } catch {
        // Not valid JSON — drop the frame
        this.log.warn({ sessionId }, "Received non-JSON text frame, dropping");
      }
    });

    // WS close / error → cleanup PTY
    ws.on("close", () => {
      this.log.info({ sessionId }, "WebSocket closed, cleaning up PTY");
      clearBatchTimer();
      this.cleanupTerminal(sessionId, terminal);
    });

    ws.on("error", (err) => {
      this.log.error({ err, sessionId }, "WebSocket error");
      clearBatchTimer();
      this.cleanupTerminal(sessionId, terminal);
    });

    // Heartbeat: send ping, increment missed counter.
    // Reset on pong. Disconnect if too many missed.
    let missedPongs = 0;
    const heartbeatInterval = setInterval(() => {
      if (ws.readyState !== ws.OPEN) {
        clearInterval(heartbeatInterval);
        return;
      }
      missedPongs++;
      if (missedPongs > this.config.rateLimit.wsMaxMissedPongs) {
        this.log.warn({ sessionId, missedPongs }, "Too many missed pongs, closing");
        clearInterval(heartbeatInterval);
        ws.terminate();
        return;
      }
      ws.ping();
    }, this.config.rateLimit.wsHeartbeat * 1000);

    ws.on("pong", () => {
      missedPongs = 0;
    });

    ws.on("close", () => {
      clearInterval(heartbeatInterval);
    });
  }

  private cleanupTerminal(sessionId: string, terminal: ActiveTerminal): Promise<void> {
    // Idempotent — only clean up once
    if (terminal.cleanedUp) return Promise.resolve();
    if (this.terminals.get(sessionId) !== terminal) return Promise.resolve();

    terminal.cleanedUp = true;
    this.terminals.delete(sessionId);

    const pid = terminal.pty.pid;
    try {
      terminal.pty.kill();
      this.log.debug({ sessionId, pid }, "PTY process killed (SIGTERM)");
    } catch {
      // Already dead
      return Promise.resolve();
    }

    // Resolve when PTY exits or after SIGKILL escalation timeout
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          process.kill(pid, 0); // Check if alive
          process.kill(pid, "SIGKILL");
          this.log.warn({ sessionId, pid }, "Force-killed PTY process (SIGKILL)");
        } catch {
          // Already dead — good
        }
        resolve();
      }, 5000);

      // If PTY exits before the timeout, resolve early
      try {
        process.kill(pid, 0); // Still alive — wait for timeout
      } catch {
        // Already dead — resolve immediately
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  private reapOrphans(): void {
    for (const [sessionId, terminal] of this.terminals) {
      const ws = terminal.ws;
      if (ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) {
        this.log.warn({ sessionId }, "Reaping orphaned terminal (WS dead)");
        this.cleanupTerminal(sessionId, terminal);
      }
    }
  }
}
