import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SessionRegistry } from "../sessions/registry.js";
import type { SessionDiscovery } from "../sessions/discovery.js";

interface SSEClient {
  reply: FastifyReply;
  alive: boolean;
}

/**
 * SSE endpoint for real-time session list updates.
 *
 * Sends the full enriched session list whenever discovery detects a change
 * (debounced to 2s windows by SessionDiscovery). Clients get an immediate
 * snapshot on connect, then incremental pushes.
 */
export function registerStreamRoutes(
  app: FastifyInstance,
  registry: SessionRegistry,
  discovery: SessionDiscovery,
): void {
  const clients = new Set<SSEClient>();

  // When discovery emits a change, push to all SSE clients
  discovery.on("change", () => {
    if (clients.size === 0) return;

    registry
      .listSessions()
      .then((sessions) => {
        const data = JSON.stringify(sessions);
        const payload = `event: sessions\ndata: ${data}\n\n`;

        for (const client of clients) {
          try {
            client.reply.raw.write(payload);
          } catch {
            client.alive = false;
          }
        }

        // Prune dead clients
        for (const client of clients) {
          if (!client.alive) clients.delete(client);
        }
      })
      .catch((err) => {
        app.log.warn({ err }, "Failed to build SSE session payload");
      });
  });

  // GET /api/sessions/stream — SSE endpoint
  app.get(
    "/api/sessions/stream",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Set SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering if proxied
      });

      const client: SSEClient = { reply, alive: true };
      clients.add(client);

      request.log.info(
        { clientCount: clients.size },
        "SSE client connected",
      );

      // Send initial snapshot immediately
      try {
        const sessions = await registry.listSessions();
        const data = JSON.stringify(sessions);
        reply.raw.write(`event: sessions\ndata: ${data}\n\n`);
      } catch (err) {
        request.log.warn({ err }, "Failed to send initial SSE snapshot");
      }

      // Keep-alive ping every 30s to prevent timeout
      const keepAlive = setInterval(() => {
        try {
          reply.raw.write(": keepalive\n\n");
        } catch {
          client.alive = false;
          clearInterval(keepAlive);
        }
      }, 30_000);

      // Cleanup on disconnect
      request.raw.on("close", () => {
        client.alive = false;
        clients.delete(client);
        clearInterval(keepAlive);
        request.log.info(
          { clientCount: clients.size },
          "SSE client disconnected",
        );
      });

      // Prevent Fastify from ending the response
      return reply;
    },
  );
}
