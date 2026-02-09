import { create } from 'zustand';
import type { Session, AttachResult } from '../types/session';
import { useConnectionStore } from './connection';
import { saveSessionsCache, loadSessionsCache } from '../services/storage';

let sseUnsubscribe: (() => void) | null = null;

interface SessionsState {
  sessions: Session[];
  isLoading: boolean;
  isCached: boolean;
  isStreaming: boolean;
  error: string | null;

  // Actions
  fetchSessions: () => Promise<void>;
  attachSession: (sessionId: string) => Promise<AttachResult>;
  startSSE: () => void;
  stopSSE: () => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  isLoading: false,
  isCached: false,
  isStreaming: false,
  error: null,

  fetchSessions: async () => {
    const { client } = useConnectionStore.getState();
    if (!client) return;

    // If we have no sessions yet, load from cache first for instant UI
    if (get().sessions.length === 0) {
      try {
        const cached = await loadSessionsCache();
        if (cached.length > 0) {
          set({ sessions: cached, isCached: true });
        }
      } catch {
        // Cache miss is fine
      }
    }

    set({ isLoading: true, error: null });
    try {
      const sessions = await client.getSessions();
      set({ sessions, isLoading: false, isCached: false });
      // Save to cache in background
      saveSessionsCache(sessions).catch(() => {});
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load sessions',
        isLoading: false,
        isCached: false,
      });
    }
  },

  attachSession: async (sessionId: string) => {
    const { client } = useConnectionStore.getState();
    if (!client) throw new Error('Not connected');
    return client.attach(sessionId);
  },

  startSSE: () => {
    const { client } = useConnectionStore.getState();
    if (!client || get().isStreaming) return;

    // Stop any existing SSE first
    get().stopSSE();

    sseUnsubscribe = client.subscribeToSessions(
      (sessions) => {
        set({ sessions, isCached: false, isStreaming: true, error: null });
        // Save to cache in background
        saveSessionsCache(sessions).catch(() => {});
      },
      (_err) => {
        // SSE failed — fall back to polling (fetchSessions handles this)
        set({ isStreaming: false });
      },
    );

    set({ isStreaming: true });
  },

  stopSSE: () => {
    if (sseUnsubscribe) {
      sseUnsubscribe();
      sseUnsubscribe = null;
    }
    set({ isStreaming: false });
  },
}));
