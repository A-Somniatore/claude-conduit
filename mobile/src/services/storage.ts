import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '../types/session';

const KEYCHAIN_SERVICE = 'com.somniatore.claude-relay';
const SESSIONS_CACHE_KEY = '@claude-relay/sessions-cache';

interface StoredConfig {
  daemonHost: string;
  psk: string;
}

/** Save daemon connection config to Keychain. */
export async function saveConfig(config: StoredConfig): Promise<void> {
  await Keychain.setGenericPassword(
    config.daemonHost,
    config.psk,
    { service: KEYCHAIN_SERVICE },
  );
}

/** Load daemon connection config from Keychain. */
export async function loadConfig(): Promise<StoredConfig | null> {
  const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (!creds) return null;
  return {
    daemonHost: creds.username,
    psk: creds.password,
  };
}

/** Check if config exists. */
export async function hasConfig(): Promise<boolean> {
  const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  return !!creds;
}

/** Clear stored config. */
export async function clearConfig(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
}

/** Save sessions to AsyncStorage for instant cold-start display. */
export async function saveSessionsCache(sessions: Session[]): Promise<void> {
  await AsyncStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(sessions));
}

/** Load cached sessions from AsyncStorage. Returns empty array if no cache. */
export async function loadSessionsCache(): Promise<Session[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_CACHE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Session[];
  } catch {
    return [];
  }
}
