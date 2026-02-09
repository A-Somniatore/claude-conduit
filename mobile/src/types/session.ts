export type ClaudeState = 'waiting' | 'thinking' | 'idle' | 'unknown';

export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  lastMessagePreview: string;
  lastMessageRole: 'user' | 'assistant' | 'unknown';
  timestamp: string;
  cliVersion: string;
  tmuxStatus: 'active' | 'detached' | 'none';
  hasActiveConnection?: boolean;
  claudeState?: ClaudeState;
}

export interface Project {
  projectPath: string;
  projectName: string;
  sessionCount: number;
  latestTimestamp: string;
}

export interface AttachResult {
  wsUrl: string;
  tmuxSession: string;
  existed: boolean;
  attachToken: string;
}

export interface DaemonStatus {
  version: string;
  apiVersion?: number;
  claude: string;
  activeSessions: number;
  tmuxSessions: Array<{
    sessionId: string;
    attached: boolean;
    created: string;
  }>;
  uptime: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  group: 'root' | 'projects' | 'startups';
}

export interface NewSessionResult {
  sessionId: string;
  tmuxSession: string;
  projectPath: string;
  projectName: string;
  attachToken: string;
}

export interface ApiError {
  error: string;
  message: string;
  action: string;
}
