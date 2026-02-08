import React, { useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  SectionList,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius, fontFamily } from '../theme';
import { useSessionsStore } from '../stores/sessions';
import { useConnectionStore } from '../stores/connection';
import type { Session } from '../types/session';

interface SectionData {
  title: string;
  sessionCount: number;
  data: Session[];
}

export function SessionListScreen({
  onSelectSession,
  onOpenSettings,
}: {
  onSelectSession: (session: Session) => void;
  onOpenSettings: () => void;
}) {
  const { sessions, isLoading, error, fetchSessions } = useSessionsStore();
  const { status } = useConnectionStore();

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const sections = useMemo(() => {
    const grouped = new Map<string, Session[]>();
    for (const session of sessions) {
      const key = session.projectPath || 'Unknown';
      const existing = grouped.get(key) ?? [];
      existing.push(session);
      grouped.set(key, existing);
    }

    const result: SectionData[] = [];
    for (const [path, items] of grouped) {
      items.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      result.push({
        title: items[0]?.projectName || path.split('/').pop() || path,
        sessionCount: items.length,
        data: items,
      });
    }

    result.sort(
      (a, b) =>
        new Date(b.data[0]!.timestamp).getTime() -
        new Date(a.data[0]!.timestamp).getTime(),
    );

    return result;
  }, [sessions]);

  const renderSession = useCallback(
    ({ item }: { item: Session }) => (
      <TouchableOpacity
        style={styles.sessionRow}
        onPress={() => onSelectSession(item)}
        activeOpacity={0.7}>
        <View style={styles.sessionHeader}>
          <StatusBadge status={item.tmuxStatus} />
          <Text style={styles.sessionTime}>{formatTime(item.timestamp)}</Text>
        </View>
        <Text style={styles.sessionPreview} numberOfLines={2}>
          {item.lastMessagePreview || 'No messages yet'}
        </Text>
        <Text style={styles.sessionMeta}>
          {item.cliVersion ? `v${item.cliVersion}` : ''} · {item.id.slice(0, 8)}
        </Text>
      </TouchableOpacity>
    ),
    [onSelectSession],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionData }) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionCount}>
          {section.sessionCount} session{section.sessionCount !== 1 ? 's' : ''}
        </Text>
      </View>
    ),
    [],
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Sessions</Text>
          {status && (
            <Text style={styles.subtitle}>
              {sessions.length} sessions · v{status.version}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={onOpenSettings}
          activeOpacity={0.7}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderItem={renderSession}
        renderSectionHeader={renderSectionHeader}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchSessions}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No sessions found</Text>
            <Text style={styles.emptySubtitle}>
              Start a Claude Code session on your Mac to see it here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function StatusBadge({ status }: { status: Session['tmuxStatus'] }) {
  const config = {
    active: { label: 'Active', bg: colors.successMuted, fg: colors.success },
    detached: {
      label: 'Detached',
      bg: colors.warningMuted,
      fg: colors.warning,
    },
    none: { label: 'Idle', bg: colors.bgHover, fg: colors.textMuted },
  }[status];

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <View style={[styles.badgeDot, { backgroundColor: config.fg }]} />
      <Text style={[styles.badgeText, { color: config.fg }]}>
        {config.label}
      </Text>
    </View>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString();
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bgSurface,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  settingsIcon: {
    fontSize: 18,
  },
  errorBanner: {
    backgroundColor: colors.errorMuted,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.sm,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  sectionCount: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  sessionRow: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sessionTime: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  sessionPreview: {
    fontSize: fontSize.md,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
  sessionMeta: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontFamily: fontFamily.mono,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    gap: 5,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    paddingTop: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
