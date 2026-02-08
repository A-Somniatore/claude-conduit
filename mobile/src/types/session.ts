export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  lastMessagePreview: string;
  lastMessageRole: 'user' | 'assistant' | 'unknown';
  timestamp: string;
  cliVersion: string;
  tmuxStatus: 'active' | 'detached' | 'none';
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
  claude: string;
  activeSessions: number;
  tmuxSessions: Array<{
    sessionId: string;
    attached: boolean;
    created: string;
  }>;
  uptime: number;
}

export interface ApiError {
  error: string;
  message: string;
  action: string;
}
