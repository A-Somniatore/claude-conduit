import { create } from 'zustand';
import { RelayClient } from '../services/relay';
import type { DaemonStatus } from '../types/session';
import { loadConfig, saveConfig, hasConfig } from '../services/storage';

interface ConnectionState {
  // Connection status
  isReachable: boolean;
  isConfigured: boolean;
  isChecking: boolean;
  status: DaemonStatus | null;

  // Config
  daemonHost: string;
  psk: string;
  client: RelayClient | null;

  // Actions
  initialize: () => Promise<void>;
  checkConnection: () => Promise<boolean>;
  configure: (host: string, psk: string) => Promise<void>;
  reset: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  isReachable: false,
  isConfigured: false,
  isChecking: false,
  status: null,
  daemonHost: '',
  psk: '',
  client: null,

  initialize: async () => {
    const config = await loadConfig();
    if (config) {
      const client = new RelayClient(config.daemonHost, config.psk);
      set({
        daemonHost: config.daemonHost,
        psk: config.psk,
        client,
        isConfigured: true,
      });
      // Check connection in background
      get().checkConnection();
    }
  },

  checkConnection: async () => {
    const { client } = get();
    if (!client) {
      set({ isReachable: false });
      return false;
    }

    set({ isChecking: true });
    try {
      const reachable = await client.ping(3000);
      if (reachable) {
        const status = await client.getStatus();
        set({ isReachable: true, status, isChecking: false });
        return true;
      }
      set({ isReachable: false, status: null, isChecking: false });
      return false;
    } catch {
      set({ isReachable: false, status: null, isChecking: false });
      return false;
    }
  },

  configure: async (host: string, psk: string) => {
    await saveConfig({ daemonHost: host, psk });
    const client = new RelayClient(host, psk);
    set({
      daemonHost: host,
      psk,
      client,
      isConfigured: true,
    });
  },

  reset: () => {
    set({
      isReachable: false,
      isConfigured: false,
      isChecking: false,
      status: null,
      daemonHost: '',
      psk: '',
      client: null,
    });
  },
}));
