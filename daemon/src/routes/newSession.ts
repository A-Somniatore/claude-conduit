import type { FastifyInstance } from "fastify";
import type { TmuxManager } from "../tmux/manager.js";
import type { AttachTokens } from "../auth.js";
import type { RelayConfig } from "../config.js";
import { SessionConflictError } from "../tmux/manager.js";
import { readdir, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

interface DirectoryEntry {
  name: string;
  path: string;
  group: string;
}

async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function registerNewSessionRoutes(
  app: FastifyInstance,
  tmuxManager: TmuxManager,
  attachTokens: AttachTokens,
  config: RelayConfig,
): void {
  const rootDirs = config.projectDirs.map((d) => resolve(d));

  // GET /api/directories — list available project directories for new sessions
  app.get("/api/directories", async () => {
    const dirs: DirectoryEntry[] = [];

    for (const rootDir of rootDirs) {
      const groupName = basename(rootDir).toLowerCase();

      // Add the root dir itself
      dirs.push({
        name: basename(rootDir),
        path: rootDir,
        group: "root",
      });

      // List subdirectories
      const subdirs = await listSubdirs(rootDir);
      for (const name of subdirs) {
        dirs.push({
          name,
          path: join(rootDir, name),
          group: groupName,
        });
      }
    }

    return dirs;
  });

  // POST /api/sessions/new — create a new Claude session in a directory
  app.post<{ Body: { projectPath: string } }>(
    "/api/sessions/new",
    async (request, reply) => {
      const { projectPath } = request.body ?? {};

      if (!projectPath || typeof projectPath !== "string") {
        reply.code(400).send({
          error: "INVALID_PATH",
          message: "projectPath is required",
          action: "Provide a valid project directory path",
        });
        return;
      }

      // Security: only allow paths under configured project roots
      const resolved = resolve(projectPath);
      const allowed = rootDirs.some(
        (root) => resolved === root || resolved.startsWith(root + "/"),
      );
      if (!allowed) {
        reply.code(403).send({
          error: "FORBIDDEN",
          message: "Can only create sessions in configured project directories",
          action: "Choose a directory under a configured project root",
        });
        return;
      }

      // Verify directory exists
      try {
        const s = await stat(resolved);
        if (!s.isDirectory()) throw new Error("not a directory");
      } catch {
        reply.code(404).send({
          error: "DIR_NOT_FOUND",
          message: `Directory not found: ${resolved}`,
          action: "Check the path and try again",
        });
        return;
      }

      try {
        const result = await tmuxManager.createNew(resolved);
        const token = attachTokens.generate(result.sessionId);

        return {
          sessionId: result.sessionId,
          tmuxSession: result.tmuxSession,
          projectPath: resolved,
          projectName: basename(resolved),
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
