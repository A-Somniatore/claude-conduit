import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius, fontFamily } from '../theme';
import { useConnectionStore } from '../stores/connection';
import { clearConfig } from '../services/storage';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { daemonHost, status, reset } = useConnectionStore();
  const insets = useSafeAreaInsets();

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect',
      'This will clear your saved relay configuration. You will need to set it up again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await clearConfig();
            reset();
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Daemon</Text>
          <Text style={styles.rowValue}>{daemonHost}</Text>
        </View>

        {status && (
          <>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Daemon version</Text>
              <Text style={styles.rowValue}>v{status.version}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Claude CLI</Text>
              <Text style={styles.rowValue}>{status.claude}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Active tmux</Text>
              <Text style={styles.rowValue}>
                {status.tmuxSessions.length} session
                {status.tmuxSessions.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Uptime</Text>
              <Text style={styles.rowValue}>
                {formatUptime(status.uptime)}
              </Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.section}>
        <TouchableOpacity
          style={styles.dangerButton}
          onPress={handleDisconnect}
          activeOpacity={0.8}>
          <Text style={styles.dangerButtonText}>Disconnect & Reset</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 60,
  },
  backText: {
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerRight: {
    width: 60,
  },
  section: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.bgElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  rowLabel: {
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  rowValue: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontFamily: fontFamily.mono,
  },
  dangerButton: {
    padding: spacing.md,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: colors.error,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
