import type { Session, AttachResult, DaemonStatus, ApiError } from '../types/session';

export class RelayClient {
  private baseUrl: string;
  private psk: string;

  constructor(daemonHost: string, psk: string) {
    this.baseUrl = `http://${daemonHost}`;
    this.psk = psk;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.psk}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      throw new RelayError(
        res.status,
        body?.error ?? 'UNKNOWN',
        body?.message ?? `HTTP ${res.status}`,
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
  async getStatus(): Promise<DaemonStatus> {
    const res = await fetch(`${this.baseUrl}/api/status`);
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    return res.json() as Promise<DaemonStatus>;
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

  /** Build the WebSocket URL for a terminal connection. */
  terminalWsUrl(sessionId: string, attachToken: string, cols: number, rows: number): string {
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    return `${wsBase}/terminal/${sessionId}?token=${encodeURIComponent(attachToken)}&cols=${cols}&rows=${rows}`;
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
