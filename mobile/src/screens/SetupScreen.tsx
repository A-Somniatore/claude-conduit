import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import { useConnectionStore } from '../stores/connection';
import { RelayClient } from '../services/relay';
import type { DaemonStatus } from '../types/session';

interface CheckItem {
  label: string;
  status: 'pending' | 'checking' | 'pass' | 'fail';
  detail?: string;
}

export function SetupScreen() {
  const { configure } = useConnectionStore();
  const [host, setHost] = useState('100.64.0.2:7860');
  const [psk, setPsk] = useState('');
  const [checks, setChecks] = useState<CheckItem[]>([
    { label: 'Mac reachable', status: 'pending' },
    { label: 'Relay daemon running', status: 'pending' },
    { label: 'Authentication', status: 'pending' },
  ]);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const updateCheck = (index: number, update: Partial<CheckItem>) => {
    setChecks(prev =>
      prev.map((c, i) => (i === index ? { ...c, ...update } : c)),
    );
  };

  const validate = async () => {
    setIsValidating(true);

    // Reset
    setChecks(prev => prev.map(c => ({ ...c, status: 'pending', detail: undefined })));

    // Check 1: Reachable
    updateCheck(0, { status: 'checking' });
    const client = new RelayClient(host, psk);
    const reachable = await client.ping(5000);
    if (!reachable) {
      updateCheck(0, {
        status: 'fail',
        detail: `Cannot reach ${host} — is the daemon running?`,
      });
      setIsValidating(false);
      return;
    }
    updateCheck(0, { status: 'pass' });

    // Check 2: Daemon running
    updateCheck(1, { status: 'checking' });
    try {
      const status = await client.getStatus();
      setDaemonStatus(status);
      updateCheck(1, {
        status: 'pass',
        detail: `v${status.version}, Claude ${status.claude}`,
      });
    } catch {
      updateCheck(1, {
        status: 'fail',
        detail: 'Daemon responded but status check failed',
      });
      setIsValidating(false);
      return;
    }

    // Check 3: Auth
    updateCheck(2, { status: 'checking' });
    if (!psk.trim()) {
      updateCheck(2, {
        status: 'fail',
        detail: 'Enter the relay key from your daemon config',
      });
      setIsValidating(false);
      return;
    }
    try {
      await client.getSessions();
      updateCheck(2, { status: 'pass' });
    } catch {
      updateCheck(2, {
        status: 'fail',
        detail: 'Invalid relay key — check ~/.config/claude-relay/config.yaml',
      });
      setIsValidating(false);
      return;
    }

    // All passed — save and continue
    await configure(host, psk);
    setIsValidating(false);
  };

  const allPassed = checks.every(c => c.status === 'pass');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <Text style={styles.title}>Setup Claude Relay</Text>
        <Text style={styles.subtitle}>
          Connect to your Mac's relay daemon to access Claude sessions.
        </Text>

        {/* Host input */}
        <View style={styles.field}>
          <Text style={styles.label}>Daemon address</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="100.64.0.2:7860"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>

        {/* PSK input */}
        <View style={styles.field}>
          <Text style={styles.label}>Relay key</Text>
          <TextInput
            style={styles.input}
            value={psk}
            onChangeText={setPsk}
            placeholder="From ~/.config/claude-relay/config.yaml"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>

        {/* Checklist */}
        <View style={styles.checklist}>
          {checks.map((check, i) => (
            <View key={i} style={styles.checkRow}>
              <View style={styles.checkIcon}>
                {check.status === 'checking' ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Text style={styles.checkMark}>
                    {check.status === 'pass'
                      ? '✓'
                      : check.status === 'fail'
                        ? '✗'
                        : '○'}
                  </Text>
                )}
              </View>
              <View style={styles.checkContent}>
                <Text
                  style={[
                    styles.checkLabel,
                    check.status === 'pass' && styles.checkLabelPass,
                    check.status === 'fail' && styles.checkLabelFail,
                  ]}>
                  {check.label}
                </Text>
                {check.detail && (
                  <Text
                    style={[
                      styles.checkDetail,
                      check.status === 'fail' && styles.checkDetailFail,
                    ]}>
                    {check.detail}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Connect button */}
        <TouchableOpacity
          style={[styles.connectButton, isValidating && styles.connectButtonDisabled]}
          onPress={validate}
          disabled={isValidating || !host.trim()}
          activeOpacity={0.8}>
          {isValidating ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.connectButtonText}>
              {allPassed ? 'Connected!' : 'Connect'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  content: {
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    fontFamily: 'Menlo',
  },
  checklist: {
    backgroundColor: colors.bgElevated,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  checkIcon: {
    width: 28,
    alignItems: 'center',
    marginTop: 2,
  },
  checkMark: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
  },
  checkContent: {
    flex: 1,
  },
  checkLabel: {
    fontSize: fontSize.md,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  checkLabelPass: {
    color: colors.success,
  },
  checkLabelFail: {
    color: colors.error,
  },
  checkDetail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  checkDetailFail: {
    color: colors.error,
  },
  connectButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  connectButtonDisabled: {
    opacity: 0.6,
  },
  connectButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
});
