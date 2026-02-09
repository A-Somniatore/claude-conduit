import type { FastifyBaseLogger } from "fastify";
import type { SessionDiscovery } from "./discovery.js";
import type { TmuxManager } from "../tmux/manager.js";
import type { TerminalBridge } from "../terminal/bridge.js";
import type { SessionMetadata } from "./types.js";
import { basename } from "node:path";

/** High-level Claude activity state derived from lastMessageRole + tmuxStatus. */
export type ClaudeState =
  | "waiting"    // Last message was assistant → Claude finished, waiting for user input
  | "thinking"   // Last message was user → Claude is working
  | "idle"       // No tmux session running
  | "unknown";   // Cannot determine state

/** Merged session view combining discovery metadata + live tmux/bridge state. */
export interface SessionView {
  id: string;
  projectPath: string;
  projectName: string;
  projectHash: string;
  lastMessagePreview: string;
  lastMessageRole: "user" | "assistant" | "unknown";
  timestamp: string;
  cliVersion: string;
  tmuxStatus: "active" | "detached" | "none";
  hasActiveConnection: boolean;
  claudeState: ClaudeState;
}

/**
 * SessionRegistry composes discovery (disk reader) with tmux/bridge state.
 * Routes read from here instead of calling discovery + tmuxManager separately.
 */
export class SessionRegistry {
  private log: FastifyBaseLogger;
  private discovery: SessionDiscovery;
  private tmuxManager: TmuxManager;
  private bridge: TerminalBridge;

  // Snapshot of tmux status built per-request (no separate cache — TmuxManager owns caching)
  private tmuxStatusSnapshot = new Map<string, "active" | "detached" | "none">();

  constructor(
    discovery: SessionDiscovery,
    tmuxManager: TmuxManager,
    bridge: TerminalBridge,
    log: FastifyBaseLogger,
  ) {
    this.discovery = discovery;
    this.tmuxManager = tmuxManager;
    this.bridge = bridge;
    this.log = log.child({ module: "registry" });
  }

  /** Build a tmux status snapshot from TmuxManager (which has its own 10s cache). */
  private async refreshTmuxStatus(): Promise<void> {
    const claudeSessions = await this.tmuxManager.listClaudeSessions();
    this.tmuxStatusSnapshot.clear();
    for (const s of claudeSessions) {
      this.tmuxStatusSnapshot.set(
        s.sessionId,
        s.tmux.attached ? "active" : "detached",
      );
    }
  }

  /** Invalidate tmux state (delegates to TmuxManager). */
  invalidateTmuxCache(): void {
    this.tmuxManager.invalidateCache();
  }

  /** Get the tmux status for a session ID from the current snapshot. */
  private getTmuxStatus(sessionId: string): "active" | "detached" | "none" {
    return this.tmuxStatusSnapshot.get(sessionId) ?? "none";
  }

  /** Derive Claude's activity state from JSONL role + tmux status. */
  private computeClaudeState(
    lastMessageRole: "user" | "assistant" | "unknown",
    tmuxStatus: "active" | "detached" | "none",
  ): ClaudeState {
    if (tmuxStatus === "none") return "idle";
    if (lastMessageRole === "assistant") return "waiting";
    if (lastMessageRole === "user") return "thinking";
    return "unknown";
  }

  /** Convert a SessionMetadata to a SessionView with live state. */
  private toView(session: SessionMetadata): SessionView {
    const tmuxStatus = this.getTmuxStatus(session.id);
    const claudeState = this.computeClaudeState(session.lastMessageRole, tmuxStatus);
    return {
      id: session.id,
      projectPath: session.projectPath,
      projectName: session.projectPath
        ? basename(session.projectPath)
        : session.projectHash,
      projectHash: session.projectHash,
      lastMessagePreview: session.lastMessagePreview,
      lastMessageRole: session.lastMessageRole,
      timestamp: session.timestamp.toISOString(),
      cliVersion: session.cliVersion,
      tmuxStatus,
      hasActiveConnection: this.bridge.hasActiveTerminal(session.id),
      claudeState,
    };
  }

  /** List all sessions with merged tmux/bridge state. */
  async listSessions(): Promise<SessionView[]> {
    await this.refreshTmuxStatus();
    return this.discovery.getSessions().map((s) => this.toView(s));
  }

  /** Get a single session by ID with merged state. */
  async getSession(id: string): Promise<SessionView | null> {
    const session = this.discovery.getSession(id);
    if (!session) return null;
    await this.refreshTmuxStatus();
    return this.toView(session);
  }

  /** Check if a session exists in discovery. */
  hasSession(id: string): boolean {
    return !!this.discovery.getSession(id);
  }

  /** Get session project path (for attach route). */
  getSessionProjectPath(id: string): string | undefined {
    return this.discovery.getSession(id)?.projectPath;
  }

  /** Get sessions grouped by project. */
  async getSessionsByProject(): Promise<
    Array<{
      projectPath: string;
      projectName: string;
      sessionCount: number;
      latestTimestamp: string;
    }>
  > {
    const grouped = this.discovery.getSessionsByProject();
    const result: Array<{
      projectPath: string;
      projectName: string;
      sessionCount: number;
      latestTimestamp: string;
    }> = [];

    for (const [path, sessions] of grouped) {
      result.push({
        projectPath: path,
        projectName: basename(path) || path,
        sessionCount: sessions.length,
        latestTimestamp: sessions[0].timestamp.toISOString(),
      });
    }

    return result.sort(
      (a, b) =>
        new Date(b.latestTimestamp).getTime() -
        new Date(a.latestTimestamp).getTime(),
    );
  }
}
