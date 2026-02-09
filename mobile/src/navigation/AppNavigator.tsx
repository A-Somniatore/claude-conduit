import React, { useEffect, useState, Suspense, lazy } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, ActivityIndicator } from 'react-native';
import { useConnectionStore } from '../stores/connection';
import { ConnectionErrorScreen } from '../screens/ConnectionErrorScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { SessionListScreen } from '../screens/SessionListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { NewSessionScreen } from '../screens/NewSessionScreen';
import { colors, fontSize, spacing } from '../theme';
import type { Session } from '../types/session';

// Lazy-load TerminalScreen — defers 288KB xterm bundle parse until first terminal open
const TerminalScreen = lazy(() =>
  import('../screens/TerminalScreen').then(m => ({ default: m.TerminalScreen })),
);

function TerminalFallback() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

type Screen =
  | { name: 'connectionError' }
  | { name: 'setup' }
  | { name: 'sessions' }
  | { name: 'terminal'; session: Session; attachToken?: string }
  | { name: 'settings' }
  | { name: 'newSession' };

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

  // Configured but daemon unreachable -> connection error
  if (!isReachable) {
    return <ConnectionErrorScreen />;
  }

  // iPad split view
  if (isIPad) {
    return (
      <View style={styles.splitView}>
        <View style={styles.sidebar}>
          {screen.name === 'settings' ? (
            <SettingsScreen onBack={() => setScreen({ name: 'sessions' })} />
          ) : screen.name === 'newSession' ? (
            <NewSessionScreen
              onBack={() => setScreen({ name: 'sessions' })}
              onCreated={(sessionId, attachToken, projectPath, projectName) => {
                const session: Session = {
                  id: sessionId,
                  projectPath,
                  projectName,
                  lastMessagePreview: 'New session',
                  lastMessageRole: 'unknown',
                  timestamp: new Date().toISOString(),
                  cliVersion: '',
                  tmuxStatus: 'active',
                };
                setScreen({ name: 'terminal', session, attachToken });
              }}
            />
          ) : (
            <SessionListScreen
              onSelectSession={session =>
                setScreen({ name: 'terminal', session })
              }
              onOpenSettings={() => setScreen({ name: 'settings' })}
              onNewSession={() => setScreen({ name: 'newSession' })}
            />
          )}
        </View>
        <View style={styles.main}>
          {screen.name === 'terminal' ? (
            <Suspense fallback={<TerminalFallback />}>
              <TerminalScreen
                session={screen.session}
                attachToken={screen.attachToken}
                onBack={() => setScreen({ name: 'sessions' })}
              />
            </Suspense>
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderIcon}>▸</Text>
              <Text style={styles.placeholderText}>Select a session to continue</Text>
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

  if (screen.name === 'newSession') {
    return (
      <NewSessionScreen
        onBack={() => setScreen({ name: 'sessions' })}
        onCreated={(sessionId, attachToken, projectPath, projectName) => {
          const session: Session = {
            id: sessionId,
            projectPath,
            projectName,
            lastMessagePreview: 'New session',
            lastMessageRole: 'unknown',
            timestamp: new Date().toISOString(),
            cliVersion: '',
            tmuxStatus: 'active',
          };
          setScreen({ name: 'terminal', session, attachToken });
        }}
      />
    );
  }

  if (screen.name === 'terminal') {
    return (
      <Suspense fallback={<TerminalFallback />}>
        <TerminalScreen
          session={screen.session}
          attachToken={screen.attachToken}
          onBack={() => setScreen({ name: 'sessions' })}
        />
      </Suspense>
    );
  }

  return (
    <SessionListScreen
      onSelectSession={session => setScreen({ name: 'terminal', session })}
      onOpenSettings={() => setScreen({ name: 'settings' })}
      onNewSession={() => setScreen({ name: 'newSession' })}
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
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  placeholderIcon: {
    fontSize: 48,
    color: colors.textMuted,
  },
  placeholderText: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    fontWeight: '500',
  },
});
