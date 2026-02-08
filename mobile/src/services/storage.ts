import * as Keychain from 'react-native-keychain';

const KEYCHAIN_SERVICE = 'com.somniatore.claude-relay';

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
