import { create } from 'zustand';
import type { Session, AttachResult } from '../types/session';
import { useConnectionStore } from './connection';

interface SessionsState {
  sessions: Session[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchSessions: () => Promise<void>;
  attachSession: (sessionId: string) => Promise<AttachResult>;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  isLoading: false,
  error: null,

  fetchSessions: async () => {
    const { client } = useConnectionStore.getState();
    if (!client) return;

    set({ isLoading: true, error: null });
    try {
      const sessions = await client.getSessions();
      set({ sessions, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load sessions',
        isLoading: false,
      });
    }
  },

  attachSession: async (sessionId: string) => {
    const { client } = useConnectionStore.getState();
    if (!client) throw new Error('Not connected');
    return client.attach(sessionId);
  },
}));
