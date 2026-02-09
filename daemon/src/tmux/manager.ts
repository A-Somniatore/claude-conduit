import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyBaseLogger } from "fastify";
import type { RelayConfig } from "../config.js";
import type { TmuxSession } from "./types.js";
import { SessionLock } from "./lock.js";

const exec = promisify(execFile);

// Use tab as delimiter since it cannot appear in tmux session names
const TMUX_DELIM = "\t";

const CACHE_TTL_MS = 10_000; // 10s tmux state cache

export class TmuxManager {
  private log: FastifyBaseLogger;
  private config: RelayConfig;
  private lock = new SessionLock();
  private isConnected: (sessionId: string) => boolean;

  // Cached tmux session list with TTL
  private cachedSessions: TmuxSession[] = [];
  private cacheExpiry = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: RelayConfig,
    log: FastifyBaseLogger,
    isConnected: (sessionId: string) => boolean,
  ) {
    this.log = log.child({ module: "tmux" });
    this.config = config;
    this.isConnected = isConnected;
  }

  /** Start periodic cache refresh. */
  startCacheRefresh(): void {
    this.refreshTimer = setInterval(() => {
      this.refreshCache().catch((err) =>
        this.log.warn({ err }, "tmux cache refresh failed"),
      );
    }, CACHE_TTL_MS);
  }

  /** Stop periodic cache refresh. */
  stopCacheRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private async refreshCache(): Promise<TmuxSession[]> {
    try {
      const { stdout } = await exec("tmux", [
        "list-sessions",
        "-F",
        `#{session_name}${TMUX_DELIM}#{session_attached}${TMUX_DELIM}#{session_created}`,
      ]);

      this.cachedSessions = stdout
        .trim()
        .split("\n")
        .filter((l) => l.length > 0)
        .map((line) => {
          const parts = line.split(TMUX_DELIM);
          return {
            name: parts[0],
            attached: parts[1] === "1",
            created: new Date(parseInt(parts[2], 10) * 1000),
          };
        });
    } catch {
      this.cachedSessions = [];
    }
    this.cacheExpiry = Date.now() + CACHE_TTL_MS;
    return this.cachedSessions;
  }

  /** Invalidate cache so next read fetches fresh data. */
  invalidateCache(): void {
    this.cacheExpiry = 0;
  }

  /**
   * Attach to (or create) a tmux session for a Claude session.
   * Returns tmux session name. Serialized per session ID.
   */
  async attach(sessionId: string, projectPath?: string): Promise<{
    tmuxSession: string;
    existed: boolean;
  }> {
    return this.lock.acquire(sessionId, async () => {
      // Check 1: Already has an active WS connection (bridge is source of truth)
      if (this.isConnected(sessionId)) {
        throw new SessionConflictError(
          "SESSION_ATTACHED",
          "Already connected from another device",
        );
      }

      // Check 2: Is a Claude process already running with this session?
      const claudeRunning = await this.isClaudeRunning(sessionId);
      if (claudeRunning) {
        throw new SessionConflictError(
          "SESSION_CONFLICT",
          "Close Claude on your Mac first, or pick a different session",
        );
      }

      // Check 3: Max sessions
      const activeSessions = await this.listSessions();
      const claudeSessions = activeSessions.filter((s) =>
        s.name.startsWith("claude-"),
      );
      if (claudeSessions.length >= this.config.claude.maxSessions) {
        const tmuxName = this.tmuxName(sessionId);
        const existing = claudeSessions.find((s) => s.name === tmuxName);
        if (!existing) {
          throw new SessionConflictError(
            "MAX_SESSIONS",
            `Maximum ${this.config.claude.maxSessions} concurrent sessions reached. Detach or close a session first.`,
          );
        }
      }

      // Check 4: Existing tmux session — reattach
      const tmuxName = this.tmuxName(sessionId);
      const exists = await this.hasSession(tmuxName);
      if (exists) {
        this.log.info({ sessionId, tmuxName }, "Reattaching to existing tmux session");
        return { tmuxSession: tmuxName, existed: true };
      }

      // Create new tmux session
      await this.createSession(sessionId, projectPath);
      this.log.info({ sessionId, tmuxName }, "Created new tmux session");
      return { tmuxSession: tmuxName, existed: false };
    });
  }

  /** List all tmux sessions (cached with 10s TTL). */
  async listSessions(): Promise<TmuxSession[]> {
    if (Date.now() < this.cacheExpiry) {
      return this.cachedSessions;
    }
    return this.refreshCache();
  }

  /** Get Claude-specific tmux sessions. */
  async listClaudeSessions(): Promise<
    Array<{ sessionId: string; tmux: TmuxSession }>
  > {
    const all = await this.listSessions();
    return all
      .filter((s) => s.name.startsWith("claude-"))
      .map((s) => ({
        sessionId: s.name.slice("claude-".length),
        tmux: s,
      }));
  }

  /** Kill all Claude tmux sessions. Returns count killed. */
  async killAllClaudeSessions(): Promise<number> {
    const claudeSessions = await this.listClaudeSessions();
    let killed = 0;
    for (const s of claudeSessions) {
      try {
        await exec("tmux", ["kill-session", "-t", s.tmux.name]);
        killed++;
      } catch {
        // Session already dead
      }
    }
    this.invalidateCache();
    this.log.info({ killed, total: claudeSessions.length }, "Killed all Claude tmux sessions");
    return killed;
  }

  /** Kill a tmux session. */
  async killSession(tmuxName: string): Promise<void> {
    try {
      await exec("tmux", ["kill-session", "-t", tmuxName]);
      this.log.info({ tmuxName }, "Killed tmux session");
    } catch {
      // Session already dead
    }
    this.invalidateCache();
  }

  /** Reconcile on daemon startup: discover existing tmux sessions and kill orphaned PTYs. */
  async reconcile(): Promise<string[]> {
    // Kill orphaned `tmux attach-session` processes from a previous daemon crash.
    // Use pgrep to find PIDs first, then kill only exact matches to avoid hitting
    // unrelated processes (e.g. user-started tmux sessions).
    try {
      const { stdout } = await exec("pgrep", ["-f", "^tmux attach-session -t claude-"]);
      const pids = stdout.trim().split("\n").filter(Boolean);
      if (pids.length > 0) {
        await exec("kill", pids);
        this.log.info({ pids }, "Killed orphaned tmux attach processes from previous daemon");
      }
    } catch {
      // No matching processes — good
    }

    const claudeSessions = await this.listClaudeSessions();
    const ids = claudeSessions.map((s) => s.sessionId);
    if (ids.length > 0) {
      this.log.info(
        { sessions: ids },
        "Reconciled existing tmux sessions on startup",
      );
    }
    return ids;
  }

  /**
   * Create a brand-new Claude session in a directory.
   * Returns a synthetic session ID (the tmux session suffix).
   */
  async createNew(projectPath: string): Promise<{
    sessionId: string;
    tmuxSession: string;
  }> {
    // Check max sessions
    const activeSessions = await this.listSessions();
    const claudeSessions = activeSessions.filter((s) =>
      s.name.startsWith("claude-"),
    );
    if (claudeSessions.length >= this.config.claude.maxSessions) {
      throw new SessionConflictError(
        "MAX_SESSIONS",
        `Maximum ${this.config.claude.maxSessions} concurrent sessions reached. Detach or close a session first.`,
      );
    }

    // Generate a unique ID for this new session
    const sessionId = crypto.randomUUID();
    const tmuxName = this.tmuxName(sessionId);

    const args = [
      "new-session",
      "-d",
      "-s",
      tmuxName,
      "-x",
      String(this.config.tmux.defaultCols),
      "-y",
      String(this.config.tmux.defaultRows),
      "-c",
      projectPath,
      this.config.claude.binary,
    ];

    await exec("tmux", args);
    this.invalidateCache();

    this.log.info({ sessionId, tmuxName, projectPath }, "Created new Claude session");
    return { sessionId, tmuxSession: tmuxName };
  }

  tmuxName(sessionId: string): string {
    return `claude-${sessionId}`;
  }

  private async hasSession(tmuxName: string): Promise<boolean> {
    try {
      await exec("tmux", ["has-session", "-t", tmuxName]);
      return true;
    } catch {
      return false;
    }
  }

  private async createSession(sessionId: string, projectPath?: string): Promise<void> {
    // Defense-in-depth: re-validate sessionId before passing to tmux shell
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) {
      throw new Error(`Invalid session ID format: ${sessionId}`);
    }
    const tmuxName = this.tmuxName(sessionId);
    const claudeCmd = `${this.config.claude.binary} --resume ${sessionId}`;

    const args = [
      "new-session",
      "-d",
      "-s",
      tmuxName,
      "-x",
      String(this.config.tmux.defaultCols),
      "-y",
      String(this.config.tmux.defaultRows),
    ];

    // Set working directory so claude --resume can find the session
    if (projectPath) {
      args.push("-c", projectPath);
    }

    args.push(claudeCmd);

    await exec("tmux", args);
    this.invalidateCache();
  }

  private async isClaudeRunning(sessionId: string): Promise<boolean> {
    try {
      const escaped = sessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const { stdout } = await exec("pgrep", [
        "-f",
        `claude.*--resume.*${escaped}`,
      ]);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
}

export class SessionConflictError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SessionConflictError";
  }
}
