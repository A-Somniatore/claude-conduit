import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TmuxManager } from "../tmux/manager.js";
import type { RelayConfig } from "../config.js";

const exec = promisify(execFile);

export function registerStatusRoutes(
  app: FastifyInstance,
  config: RelayConfig,
  tmuxManager: TmuxManager,
): void {
  app.get("/api/status", async () => {
    let claudeVersion = "unknown";
    try {
      const { stdout } = await exec(config.claude.binary, ["--version"]);
      claudeVersion = stdout.trim();
    } catch {
      // Claude CLI not available
    }

    const tmuxSessions = await tmuxManager.listClaudeSessions();

    return {
      version: "0.1.0",
      apiVersion: 1,
      claude: claudeVersion,
      activeSessions: tmuxSessions.length,
      tmuxSessions: tmuxSessions.map((s) => ({
        sessionId: s.sessionId,
        attached: s.tmux.attached,
        created: s.tmux.created.toISOString(),
      })),
      uptime: process.uptime(),
    };
  });
}
