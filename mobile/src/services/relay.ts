import type { Session, AttachResult, DaemonStatus, ApiError, DirectoryEntry, NewSessionResult } from '../types/session';

export class RelayClient {
  private baseUrl: string;
  private psk: string;

  constructor(daemonHost: string, psk: string) {
    this.baseUrl = `http://${daemonHost}`;
    this.psk = psk;
  }

  private async fetch<T>(path: string, options: RequestInit = {}, timeoutMs = 15000): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.psk}`,
      Accept: 'application/json',
    };
    if (options.method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers: { ...headers, ...(options.headers as Record<string, string>) },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new RelayError(0, 'TIMEOUT', `Request timed out after ${timeoutMs}ms`, 'Check your connection');
      }
      throw new RelayError(0, 'NETWORK_ERROR', 'Network request failed', 'Check your network connection');
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[relay] ${options.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
      let body: ApiError | null = null;
      try { body = JSON.parse(text); } catch {}
      throw new RelayError(
        res.status,
        body?.error ?? 'UNKNOWN',
        body?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`,
        body?.action ?? 'Try again',
      );
    }

    return res.json() as Promise<T>;
  }

  /** Check if the daemon is reachable (no auth required). */
  async ping(timeoutMs = 3000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${this.baseUrl}/api/status`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Get daemon status (no auth required). */
  async getStatus(timeoutMs = 5000): Promise<DaemonStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/status`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
      return res.json() as Promise<DaemonStatus>;
    } finally {
      clearTimeout(timer);
    }
  }

  /** List all sessions, sorted by recency. */
  async getSessions(): Promise<Session[]> {
    return this.fetch<Session[]>('/api/sessions');
  }

  /** Get a single session by ID. */
  async getSession(id: string): Promise<Session> {
    return this.fetch<Session>(`/api/sessions/${id}`);
  }

  /** Attach to a session — creates tmux if needed, returns WS URL + token. */
  async attach(sessionId: string): Promise<AttachResult> {
    return this.fetch<AttachResult>(`/api/sessions/${sessionId}/attach`, {
      method: 'POST',
    });
  }

  /** List available project directories for new sessions. */
  async getDirectories(): Promise<DirectoryEntry[]> {
    return this.fetch<DirectoryEntry[]>('/api/directories');
  }

  /** Create a new Claude session in a directory. */
  async createNewSession(projectPath: string): Promise<NewSessionResult> {
    return this.fetch<NewSessionResult>('/api/sessions/new', {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    });
  }

  /** Kill a tmux session (stops Claude). */
  async killSession(sessionId: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(`/api/sessions/${sessionId}/kill`, {
      method: 'POST',
    });
  }

  /** Kill all Claude tmux sessions. */
  async killAllSessions(): Promise<{ success: boolean; killed: number }> {
    return this.fetch<{ success: boolean; killed: number }>('/api/sessions/kill-all', {
      method: 'POST',
    });
  }

  /** Build the WebSocket URL for a terminal connection. */
  terminalWsUrl(sessionId: string, attachToken: string, cols: number, rows: number): string {
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    return `${wsBase}/terminal/${sessionId}?token=${encodeURIComponent(attachToken)}&cols=${cols}&rows=${rows}`;
  }

  /** Subscribe to real-time session updates via SSE. Returns an abort function. */
  subscribeToSessions(
    onSessions: (sessions: Session[]) => void,
    onError?: (err: Error) => void,
  ): () => void {
    const url = `${this.baseUrl}/api/sessions/stream`;
    const xhr = new XMLHttpRequest();
    let lastIndex = 0;

    xhr.open('GET', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${this.psk}`);
    xhr.setRequestHeader('Accept', 'text/event-stream');

    xhr.onreadystatechange = () => {
      // readyState 3 = LOADING (streaming data)
      if (xhr.readyState >= 3 && xhr.responseText) {
        const newData = xhr.responseText.substring(lastIndex);
        lastIndex = xhr.responseText.length;

        // Parse SSE frames from the new chunk
        const frames = newData.split('\n\n');
        for (const frame of frames) {
          if (!frame.trim()) continue;

          let eventType = '';
          let data = '';

          for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7);
            } else if (line.startsWith('data: ')) {
              data = line.slice(6);
            }
          }

          if (eventType === 'sessions' && data) {
            try {
              const sessions = JSON.parse(data) as Session[];
              onSessions(sessions);
            } catch {
              // Skip malformed data
            }
          }
        }
      }
    };

    xhr.onerror = () => {
      onError?.(new Error('SSE connection failed'));
    };

    xhr.send();

    return () => {
      xhr.abort();
    };
  }
}

export class RelayError extends Error {
  status: number;
  code: string;
  action: string;

  constructor(status: number, code: string, message: string, action: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.action = action;
    this.name = 'RelayError';
  }
}
