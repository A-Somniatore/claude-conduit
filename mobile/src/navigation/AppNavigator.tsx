import React, { useEffect, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useConnectionStore } from '../stores/connection';
import { VpnCheckScreen } from '../screens/VpnCheckScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { SessionListScreen } from '../screens/SessionListScreen';
import { TerminalScreen } from '../screens/TerminalScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors } from '../theme';
import type { Session } from '../types/session';

type Screen =
  | { name: 'vpnCheck' }
  | { name: 'setup' }
  | { name: 'sessions' }
  | { name: 'terminal'; session: Session }
  | { name: 'settings' };

const IPAD_MIN_WIDTH = 700;

export function AppNavigator() {
  const { isConfigured, isReachable, initialize } = useConnectionStore();
  const { width } = useWindowDimensions();
  const isIPad = width >= IPAD_MIN_WIDTH;

  const [screen, setScreen] = useState<Screen>({ name: 'sessions' });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    initialize().then(() => setInitialized(true));
  }, [initialize]);

  if (!initialized) {
    return <View style={styles.loading} />;
  }

  // Not configured yet -> setup
  if (!isConfigured) {
    return <SetupScreen />;
  }

  // Configured but daemon unreachable -> VPN check
  if (!isReachable) {
    return <VpnCheckScreen />;
  }

  // iPad split view
  if (isIPad) {
    return (
      <View style={styles.splitView}>
        <View style={styles.sidebar}>
          {screen.name === 'settings' ? (
            <SettingsScreen onBack={() => setScreen({ name: 'sessions' })} />
          ) : (
            <SessionListScreen
              onSelectSession={session =>
                setScreen({ name: 'terminal', session })
              }
              onOpenSettings={() => setScreen({ name: 'settings' })}
            />
          )}
        </View>
        <View style={styles.main}>
          {screen.name === 'terminal' ? (
            <TerminalScreen
              session={screen.session}
              onBack={() => setScreen({ name: 'sessions' })}
            />
          ) : (
            <View style={styles.placeholder}>
              {/* Empty state for right panel */}
            </View>
          )}
        </View>
      </View>
    );
  }

  // iPhone: full-screen stacked navigation
  if (screen.name === 'settings') {
    return (
      <SettingsScreen onBack={() => setScreen({ name: 'sessions' })} />
    );
  }

  if (screen.name === 'terminal') {
    return (
      <TerminalScreen
        session={screen.session}
        onBack={() => setScreen({ name: 'sessions' })}
      />
    );
  }

  return (
    <SessionListScreen
      onSelectSession={session => setScreen({ name: 'terminal', session })}
      onOpenSettings={() => setScreen({ name: 'settings' })}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  splitView: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 340,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  main: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
