export interface SessionMetadata {
  id: string;
  projectPath: string;
  projectHash: string;
  lastMessagePreview: string;
  lastMessageRole: "user" | "assistant" | "unknown";
  timestamp: Date;
  cliVersion: string;
}

export interface SessionIndex {
  sessions: Map<string, SessionMetadata>;
  lastFullScan: Date;
}

export interface SessionCacheEntry {
  id: string;
  projectPath: string;
  projectHash: string;
  lastMessagePreview: string;
  lastMessageRole: string;
  timestamp: string;
  cliVersion: string;
  mtimeMs: number;
}

export interface SessionCache {
  version: 1;
  entries: SessionCacheEntry[];
  lastFullScan: string;
}
