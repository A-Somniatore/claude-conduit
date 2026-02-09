import type { FastifyInstance } from "fastify";
import type { SessionRegistry } from "../sessions/registry.js";
import type { TmuxManager } from "../tmux/manager.js";
import { SessionConflictError } from "../tmux/manager.js";
import type { AttachTokens } from "../auth.js";
import { isValidSessionId } from "../auth.js";

// Rate limit: track last attach time per session, prune periodically
const lastAttachTime = new Map<string, number>();
let rateLimitCleanup: ReturnType<typeof setInterval> | null = null;

export function registerAttachRoutes(
  app: FastifyInstance,
  registry: SessionRegistry,
  tmuxManager: TmuxManager,
  attachTokens: AttachTokens,
): void {
  // Start rate limit cleanup
  if (!rateLimitCleanup) {
    rateLimitCleanup = setInterval(() => {
      const cutoff = Date.now() - 60_000;
      for (const [id, time] of lastAttachTime) {
        if (time < cutoff) lastAttachTime.delete(id);
      }
    }, 60_000);
  }

  // Clean up on shutdown
  app.addHook("onClose", () => {
    if (rateLimitCleanup) {
      clearInterval(rateLimitCleanup);
      rateLimitCleanup = null;
    }
  });

  // POST /api/sessions/:id/attach — create/attach tmux session
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/attach",
    async (request, reply) => {
      const sessionId = request.params.id;

      // Validate session ID format
      if (!isValidSessionId(sessionId)) {
        reply.code(400).send({
          error: "INVALID_SESSION_ID",
          message: "Session ID must be a valid UUID",
          action: "Check the session ID format",
        });
        return;
      }

      // Verify session exists (in discovery or as a live tmux session)
      const hasDiscovery = registry.hasSession(sessionId);
      const tmuxName = tmuxManager.tmuxName(sessionId);
      const hasTmux = !hasDiscovery
        ? (await tmuxManager.listSessions()).some((s) => s.name === tmuxName)
        : false;

      if (!hasDiscovery && !hasTmux) {
        reply.code(404).send({
          error: "NOT_FOUND",
          message: "Session not found",
          action: "Check the session ID and try again",
        });
        return;
      }

      // Rate limit: 1 attach per session per 5 seconds
      const now = Date.now();
      const lastAttach = lastAttachTime.get(sessionId);
      if (lastAttach && now - lastAttach < 5000) {
        reply.code(429).send({
          error: "RATE_LIMITED",
          message: "Too many attach attempts. Wait a few seconds.",
          action: "Wait 5 seconds before retrying",
        });
        return;
      }
      lastAttachTime.set(sessionId, now);

      try {
        const projectPath = registry.getSessionProjectPath(sessionId);
        const result = await tmuxManager.attach(sessionId, projectPath);

        // Generate single-use attach token for the WS connection
        const token = attachTokens.generate(sessionId);

        return {
          wsUrl: `/terminal/${sessionId}`,
          tmuxSession: result.tmuxSession,
          existed: result.existed,
          attachToken: token,
        };
      } catch (err) {
        if (err instanceof SessionConflictError) {
          reply.code(409).send({
            error: err.code,
            message: err.message,
            action: err.message,
          });
          return;
        }
        throw err;
      }
    },
  );
}
