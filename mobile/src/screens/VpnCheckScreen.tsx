import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import { useConnectionStore } from '../stores/connection';

export function VpnCheckScreen() {
  const { isChecking, checkConnection } = useConnectionStore();
  const retryTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    // Auto-retry every 5 seconds
    retryTimer.current = setInterval(() => {
      checkConnection();
    }, 5000);

    return () => {
      if (retryTimer.current) clearInterval(retryTimer.current);
    };
  }, [checkConnection]);

  const openTailscale = () => {
    Linking.openURL('tailscale://').catch(() => {
      // Tailscale app not installed — open App Store
      Linking.openURL(
        'https://apps.apple.com/app/tailscale/id1470499037',
      );
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>⚡</Text>
        </View>

        <Text style={styles.title}>Cannot reach your Mac</Text>
        <Text style={styles.subtitle}>
          Open the Tailscale app and connect to your Headscale network, then
          tap Retry.
        </Text>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={openTailscale}
            activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>Open Tailscale</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={checkConnection}
            disabled={isChecking}
            activeOpacity={0.8}>
            {isChecking ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <Text style={styles.secondaryButtonText}>Retry</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>Auto-retrying every 5 seconds...</Text>
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
  },
  primaryButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: colors.bgSurface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 80,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
});
