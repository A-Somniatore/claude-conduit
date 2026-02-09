import { create } from 'zustand';
import { RelayClient } from '../services/relay';
import type { DaemonStatus } from '../types/session';
import { loadConfig, saveConfig } from '../services/storage';
import NetInfo from '@react-native-community/netinfo';

const BACKOFF_SCHEDULE = [5000, 10000, 20000, 30000]; // ms

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
  startAutoReconnect: () => void;
  stopAutoReconnect: () => void;
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let netInfoUnsubscribe: (() => void) | null = null;

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
        // Reset backoff on successful connection
        reconnectAttempt = 0;
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
    get().stopAutoReconnect();
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

  startAutoReconnect: () => {
    const { stopAutoReconnect } = get();
    stopAutoReconnect();

    const scheduleRetry = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const delay = BACKOFF_SCHEDULE[Math.min(reconnectAttempt, BACKOFF_SCHEDULE.length - 1)];
      reconnectAttempt++;
      reconnectTimer = setTimeout(async () => {
        const connected = await get().checkConnection();
        if (!connected) {
          scheduleRetry();
        }
      }, delay);
    };

    // Listen for network state changes — retry immediately when network comes back
    netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && !get().isReachable) {
        reconnectAttempt = 0;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        get().checkConnection().then((connected) => {
          if (!connected) scheduleRetry();
        });
      }
    });

    // Start retry loop if not currently reachable
    if (!get().isReachable) {
      scheduleRetry();
    }
  },

  stopAutoReconnect: () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (netInfoUnsubscribe) {
      netInfoUnsubscribe();
      netInfoUnsubscribe = null;
    }
    reconnectAttempt = 0;
  },
}));
