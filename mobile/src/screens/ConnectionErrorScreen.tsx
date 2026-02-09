import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import { useConnectionStore } from '../stores/connection';

export function ConnectionErrorScreen() {
  const { isChecking, checkConnection } = useConnectionStore();
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attemptRef = useRef(0);

  useEffect(() => {
    // Exponential backoff: 5s, 10s, 20s, 30s cap
    function scheduleRetry() {
      const delay = Math.min(5000 * Math.pow(2, attemptRef.current), 30000);
      retryTimer.current = setTimeout(async () => {
        attemptRef.current++;
        await checkConnection();
        scheduleRetry();
      }, delay);
    }
    scheduleRetry();

    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [checkConnection]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>⚡</Text>
        </View>

        <Text style={styles.title}>Cannot reach your Mac</Text>
        <Text style={styles.subtitle}>
          Make sure the Claude Relay daemon is running and your device can reach
          it over the network.
        </Text>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={checkConnection}
            disabled={isChecking}
            activeOpacity={0.8}>
            {isChecking ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Retry</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>Auto-retrying with backoff...</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  content: {
    alignItems: 'center',
    maxWidth: 360,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.accentMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  icon: {
    fontSize: 36,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    minWidth: 100,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
});
