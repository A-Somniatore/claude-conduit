import { watch } from "chokidar";
import { EventEmitter } from "node:events";
import { readFileSync, existsSync } from "node:fs";
import { writeFile, mkdir, open, stat as fsStat } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { SessionMetadata, SessionCache, SessionCacheEntry } from "./types.js";
import type { RelayConfig } from "../config.js";
import { CONFIG_DIR } from "../config.js";

const CACHE_PATH = join(CONFIG_DIR, "session-cache.json");
const RESCAN_INTERVAL_MS = 120_000; // 120s full rescan
const TAIL_BYTES = 4096; // Read last 4KB for recent messages

interface JsonlUserMessage {
  type?: string;
  cwd?: string;
  sessionId?: string;
  version?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  timestamp?: string;
}

export class SessionDiscovery extends EventEmitter {
  private sessions = new Map<string, SessionMetadata>();
  private mtimeCache = new Map<string, number>(); // path -> mtimeMs
  private watcher: ReturnType<typeof watch> | null = null;
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  private saveCacheTimer: ReturnType<typeof setTimeout> | null = null;
  private changeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isScanning = false;
  private log: FastifyBaseLogger;
  private sessionDir: string;

  constructor(config: RelayConfig, log: FastifyBaseLogger) {
    super();
    this.log = log.child({ module: "discovery" });
    this.sessionDir = config.claude.sessionDir;
  }

  /** Debounced change notification — coalesces rapid changes into a single event. */
  private notifyChange(): void {
    if (this.changeDebounceTimer) clearTimeout(this.changeDebounceTimer);
    this.changeDebounceTimer = setTimeout(() => {
      this.changeDebounceTimer = null;
      this.emit("change");
    }, 2000);
  }

  async start(): Promise<void> {
    this.loadCache();
    await this.fullScan();

    // Watch for new/changed JSONL files
    this.watcher = watch(this.sessionDir, {
      ignoreInitial: true,
      depth: 2,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    this.watcher.on("add", (path) => this.onFileChange(path));
    this.watcher.on("change", (path) => this.onFileChange(path));
    this.watcher.on("unlink", (path) => this.onFileRemove(path));

    // Periodic full rescan as safety net
    this.rescanTimer = setInterval(() => {
      this.fullScan().catch((err) =>
        this.log.error({ err }, "Full rescan failed"),
      );
    }, RESCAN_INTERVAL_MS);

    this.log.info(
      { sessionCount: this.sessions.size },
      "Session discovery started",
    );
  }

  stop(): void {
    this.watcher?.close();
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    if (this.saveCacheTimer) clearTimeout(this.saveCacheTimer);
    this.saveCacheImmediate();
  }

  getSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );
  }

  getSession(id: string): SessionMetadata | undefined {
    return this.sessions.get(id);
  }

  getSessionsByProject(): Map<string, SessionMetadata[]> {
    const grouped = new Map<string, SessionMetadata[]>();
    for (const session of this.sessions.values()) {
      const key = session.projectPath || session.projectHash;
      const list = grouped.get(key) ?? [];
      list.push(session);
      grouped.set(key, list);
    }
    // Sort each group by recency
    for (const list of grouped.values()) {
      list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }
    return grouped;
  }

  private async fullScan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const projectDirs = await this.listProjectDirs();
      const seen = new Set<string>();

      for (const projectDir of projectDirs) {
        const projectHash = basename(projectDir);
        const files = await this.listJsonlFiles(projectDir);

        for (const filePath of files) {
          const sessionId = basename(filePath, ".jsonl");
          seen.add(sessionId);

          try {
            const fileStat = await fsStat(filePath);
            const cachedMtime = this.mtimeCache.get(filePath);

            // Skip if mtime unchanged
            if (cachedMtime && cachedMtime === fileStat.mtimeMs) continue;

            this.mtimeCache.set(filePath, fileStat.mtimeMs);
            const metadata = await this.parseSessionFile(
              filePath,
              sessionId,
              projectHash,
              fileStat.mtimeMs,
              fileStat.size,
            );
            if (metadata) {
              this.sessions.set(sessionId, metadata);
            }
          } catch (err) {
            this.log.warn({ err, filePath }, "Failed to parse session file");
            // Still list it with minimal info
            if (!this.sessions.has(sessionId)) {
              this.sessions.set(sessionId, {
                id: sessionId,
                projectPath: "",
                projectHash,
                lastMessagePreview: "(unable to read)",
                lastMessageRole: "unknown",
                timestamp: new Date(),
                cliVersion: "",
              });
            }
          }
        }
      }

      // Remove sessions whose files no longer exist
      for (const id of this.sessions.keys()) {
        if (!seen.has(id)) {
          this.sessions.delete(id);
        }
      }

      this.saveCache();
      this.notifyChange();
    } finally {
      this.isScanning = false;
    }
  }

  private async onFileChange(path: string): Promise<void> {
    if (!path.endsWith(".jsonl")) return;

    const sessionId = basename(path, ".jsonl");
    const projectHash = basename(dirname(path));

    try {
      const fileStat = await fsStat(path);
      this.mtimeCache.set(path, fileStat.mtimeMs);

      const metadata = await this.parseSessionFile(
        path,
        sessionId,
        projectHash,
        fileStat.mtimeMs,
        fileStat.size,
      );
      if (metadata) {
        this.sessions.set(sessionId, metadata);
        this.log.debug({ sessionId }, "Session updated");
        this.notifyChange();
      }
    } catch (err) {
      this.log.warn({ err, path }, "Failed to process file change");
    }
  }

  private onFileRemove(path: string): void {
    if (!path.endsWith(".jsonl")) return;
    const sessionId = basename(path, ".jsonl");
    this.sessions.delete(sessionId);
    this.mtimeCache.delete(path);
    this.log.debug({ sessionId }, "Session removed");
    this.notifyChange();
  }

  private async parseSessionFile(
    filePath: string,
    sessionId: string,
    projectHash: string,
    mtimeMs: number,
    fileSize: number,
  ): Promise<SessionMetadata | null> {
    if (fileSize === 0) return null;

    let projectPath = "";
    let cliVersion = "";
    let lastMessagePreview = "";
    let lastMessageRole: "user" | "assistant" | "unknown" = "unknown";

    // Parse head lines to find first user message with cwd
    const headLines = await this.readHeadLines(filePath);
    for (const line of headLines) {
      try {
        const parsed = JSON.parse(line) as JsonlUserMessage;
        if (parsed.cwd && !projectPath) projectPath = parsed.cwd;
        if (parsed.version && !cliVersion) cliVersion = parsed.version;
        // Stop once we have both
        if (projectPath && cliVersion) break;
      } catch {
        // Skip malformed lines
      }
    }

    // Parse tail for last message
    const tailLines = await this.readTailLines(filePath, fileSize);
    for (let i = tailLines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(tailLines[i]) as JsonlUserMessage;
        if (
          parsed.type === "user" ||
          parsed.type === "assistant"
        ) {
          lastMessageRole = parsed.type === "user" ? "user" : "assistant";
          lastMessagePreview = this.extractPreview(parsed);
          if (parsed.version) cliVersion = parsed.version;
          break;
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Fallback: derive projectPath from directory hash if JSONL didn't have cwd
    if (!projectPath && projectHash) {
      projectPath = "/" + projectHash.replace(/^-/, "").replace(/-/g, "/");
    }

    return {
      id: sessionId,
      projectPath,
      projectHash,
      lastMessagePreview,
      lastMessageRole,
      timestamp: new Date(mtimeMs),
      cliVersion,
    };
  }

  private extractPreview(msg: JsonlUserMessage): string {
    if (!msg.message?.content) return "";

    let text: string;
    if (typeof msg.message.content === "string") {
      text = msg.message.content;
    } else if (Array.isArray(msg.message.content)) {
      const textBlock = msg.message.content.find((b) => b.type === "text");
      text = textBlock?.text ?? "";
    } else {
      return "";
    }

    // Truncate to 200 chars
    return text.length > 200 ? text.slice(0, 200) + "..." : text;
  }

  private async readHeadLines(filePath: string, maxBytes = 4096): Promise<string[]> {
    const fh = await open(filePath, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      if (bytesRead === 0) return [];

      const text = buf.subarray(0, bytesRead).toString("utf-8");
      return text.split("\n").filter((l) => l.trim().length > 0).slice(0, 20);
    } finally {
      await fh.close();
    }
  }

  private async readTailLines(filePath: string, fileSize: number): Promise<string[]> {
    const readSize = Math.min(TAIL_BYTES, fileSize);
    const offset = Math.max(0, fileSize - readSize);

    const fh = await open(filePath, "r");
    try {
      const buf = Buffer.alloc(readSize);
      const { bytesRead } = await fh.read(buf, 0, readSize, offset);
      if (bytesRead === 0) return [];

      const text = buf.subarray(0, bytesRead).toString("utf-8");
      const lines = text.split("\n").filter((l) => l.trim().length > 0);

      // If we started mid-line (offset > 0), drop the first partial line
      if (offset > 0 && lines.length > 0) {
        lines.shift();
      }

      return lines;
    } finally {
      await fh.close();
    }
  }

  private async listProjectDirs(): Promise<string[]> {
    try {
      const entries = await readdir(this.sessionDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => join(this.sessionDir, e.name));
    } catch {
      return [];
    }
  }

  private async listJsonlFiles(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir);
      return entries
        .filter((e) => e.endsWith(".jsonl"))
        .map((e) => join(dir, e));
    } catch {
      return [];
    }
  }

  private loadCache(): void {
    if (!existsSync(CACHE_PATH)) return;

    try {
      const raw = readFileSync(CACHE_PATH, "utf-8");
      const cache = JSON.parse(raw) as SessionCache;
      if (cache.version !== 1) return;

      for (const entry of cache.entries) {
        this.sessions.set(entry.id, {
          id: entry.id,
          projectPath: entry.projectPath,
          projectHash: entry.projectHash,
          lastMessagePreview: entry.lastMessagePreview,
          lastMessageRole: entry.lastMessageRole as
            | "user"
            | "assistant"
            | "unknown",
          timestamp: new Date(entry.timestamp),
          cliVersion: entry.cliVersion,
        });
        // We don't cache mtime — full scan will re-check
      }

      this.log.info(
        { cachedSessions: cache.entries.length },
        "Loaded session cache",
      );
    } catch (err) {
      this.log.warn({ err }, "Failed to load session cache");
    }
  }

  /** Debounced cache save — coalesces rapid calls into a single write after 5s. */
  private saveCache(): void {
    if (this.saveCacheTimer) clearTimeout(this.saveCacheTimer);
    this.saveCacheTimer = setTimeout(() => {
      this.saveCacheTimer = null;
      this.saveCacheAsync().catch((err) => {
        this.log.warn({ err }, "Failed to save session cache");
      });
    }, 5_000);
  }

  /** Immediate cache save (used on shutdown). */
  private saveCacheImmediate(): void {
    this.saveCacheAsync().catch((err) => {
      this.log.warn({ err }, "Failed to save session cache on shutdown");
    });
  }

  private async saveCacheAsync(): Promise<void> {
    if (!existsSync(CONFIG_DIR)) {
      await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }

    const cache: SessionCache = {
      version: 1,
      entries: Array.from(this.sessions.values()).map((s) => ({
        id: s.id,
        projectPath: s.projectPath,
        projectHash: s.projectHash,
        lastMessagePreview: s.lastMessagePreview,
        lastMessageRole: s.lastMessageRole,
        timestamp: s.timestamp.toISOString(),
        cliVersion: s.cliVersion,
        mtimeMs: 0,
      })),
      lastFullScan: new Date().toISOString(),
    };

    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), {
      mode: 0o600,
    });
  }
}
