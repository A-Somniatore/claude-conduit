import type { FastifyInstance } from "fastify";
import type { SessionRegistry } from "../sessions/registry.js";
import type { TmuxManager } from "../tmux/manager.js";
import { isValidSessionId } from "../auth.js";

export function registerSessionRoutes(
  app: FastifyInstance,
  registry: SessionRegistry,
  tmuxManager: TmuxManager,
): void {
  // GET /api/sessions — list all sessions
  app.get("/api/sessions", async () => {
    return registry.listSessions();
  });

  // GET /api/sessions/:id — session detail
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      if (!isValidSessionId(request.params.id)) {
        reply.code(400).send({
          error: "INVALID_SESSION_ID",
          message: "Session ID must be a valid UUID",
          action: "Check the session ID format",
        });
        return;
      }

      const session = await registry.getSession(request.params.id);
      if (!session) {
        reply.code(404).send({
          error: "NOT_FOUND",
          message: "Session not found",
          action: "Check the session ID and try again",
        });
        return;
      }

      return session;
    },
  );

  // POST /api/sessions/:id/kill — kill a tmux session
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/kill",
    async (request, reply) => {
      const sessionId = request.params.id;

      if (!isValidSessionId(sessionId)) {
        reply.code(400).send({
          error: "INVALID_SESSION_ID",
          message: "Session ID must be a valid UUID",
          action: "Check the session ID format",
        });
        return;
      }

      const tmuxName = tmuxManager.tmuxName(sessionId);
      const sessions = await tmuxManager.listSessions();
      const exists = sessions.some((s) => s.name === tmuxName);

      if (!exists) {
        return { success: true, existed: false };
      }

      await tmuxManager.killSession(tmuxName);
      registry.invalidateTmuxCache();
      return { success: true, existed: true };
    },
  );

  // POST /api/sessions/kill-all — kill all Claude tmux sessions
  app.post("/api/sessions/kill-all", async () => {
    const killed = await tmuxManager.killAllClaudeSessions();
    registry.invalidateTmuxCache();
    return { success: true, killed };
  });

  // GET /api/projects — sessions grouped by project
  app.get("/api/projects", async () => {
    return registry.getSessionsByProject();
  });
}
