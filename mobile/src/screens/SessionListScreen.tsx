import React, { useEffect, useCallback, useMemo, useState, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Animated,
  Alert,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius, fontFamily } from '../theme';
import { useSessionsStore } from '../stores/sessions';
import { useConnectionStore } from '../stores/connection';
import type { Session } from '../types/session';

const PREVIEW_COUNT = 5;

const STATUS_CFG = {
  active: { color: colors.success, label: 'Active' },
  detached: { color: colors.warning, label: 'Detached' },
  none: { color: colors.textMuted, label: 'Idle' },
} as const;

const CLAUDE_STATE_CFG = {
  thinking: { color: colors.accent, label: 'Thinking' },
  waiting: { color: colors.success, label: 'Waiting' },
  idle: { color: colors.textMuted, label: 'Idle' },
  unknown: { color: colors.textMuted, label: '' },
} as const;

interface ProjectGroup {
  path: string;
  name: string;
  sessions: Session[];
  activeTmuxCount: number;
}

type ListItem =
  | { type: 'activeHeader'; count: number }
  | { type: 'activeSession'; session: Session }
  | { type: 'sectionDivider' }
  | { type: 'project'; group: ProjectGroup }
  | { type: 'session'; session: Session; isLast: boolean }
  | { type: 'showMore'; path: string; remaining: number };

function cleanPreview(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim() || 'No preview';
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return date.toLocaleDateString();
}

export function SessionListScreen({
  onSelectSession,
  onOpenSettings,
  onNewSession,
}: {
  onSelectSession: (session: Session) => void;
  onOpenSettings: () => void;
  onNewSession?: () => void;
}) {
  const { sessions, isLoading, isCached, isStreaming, error, fetchSessions, startSSE, stopSSE } = useSessionsStore();
  const { status, client, isReachable } = useConnectionStore();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [killingSession, setKillingSession] = useState<string | null>(null);

  // Debounce search to avoid re-rendering on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Subtle pulse for footer
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulseAnim]);

  const { startAutoReconnect, stopAutoReconnect } = useConnectionStore();

  // Auto-reconnect on mount
  useEffect(() => {
    startAutoReconnect();
    return () => stopAutoReconnect();
  }, [startAutoReconnect, stopAutoReconnect]);

  // Start SSE for real-time updates; fall back to 60s polling
  useEffect(() => {
    fetchSessions();
    startSSE();

    // Polling fallback when SSE isn't active
    const interval = setInterval(() => {
      if (!useSessionsStore.getState().isStreaming) {
        fetchSessions();
      }
    }, 60000);

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        startSSE();
        fetchSessions();
      } else {
        stopSSE();
      }
    });

    return () => {
      clearInterval(interval);
      sub.remove();
      stopSSE();
    };
  }, [fetchSessions, startSSE, stopSSE]);

  // Group sessions by project
  const groups = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const key = s.projectPath || 'Unknown';
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }

    const result: ProjectGroup[] = [];
    for (const [path, items] of map) {
      items.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      result.push({
        path,
        name: items[0]?.projectName || path.split('/').pop() || path,
        sessions: items,
        activeTmuxCount: items.filter(s => s.tmuxStatus !== 'none').length,
      });
    }

    result.sort(
      (a, b) =>
        new Date(b.sessions[0]!.timestamp).getTime() -
        new Date(a.sessions[0]!.timestamp).getTime(),
    );
    return result;
  }, [sessions]);

  // Auto-expand first project on initial load
  const didAutoExpand = useRef(false);
  useEffect(() => {
    if (groups.length > 0 && !didAutoExpand.current) {
      didAutoExpand.current = true;
      setExpanded({ [groups[0].path]: true });
    }
  }, [groups]);

  // Filter by search (uses debounced value)
  const filteredGroups = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      g =>
        g.name.toLowerCase().includes(q) ||
        g.sessions.some(
          s =>
            s.id.toLowerCase().includes(q) ||
            s.lastMessagePreview.toLowerCase().includes(q),
        ),
    );
  }, [groups, debouncedSearch]);

  // Active tmux sessions (must be computed before listData)
  const activeSessions = useMemo(
    () => sessions.filter(s => s.tmuxStatus !== 'none'),
    [sessions],
  );

  const totalTmux = activeSessions.length;

  const [killingAll, setKillingAll] = useState(false);

  const handleKillAll = useCallback(() => {
    if (!client || killingAll || totalTmux === 0) return;
    Alert.alert(
      'Kill All Sessions',
      `This will stop Claude and close ${totalTmux} tmux session${totalTmux > 1 ? 's' : ''}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Kill All',
          style: 'destructive',
          onPress: async () => {
            setKillingAll(true);
            try {
              await client.killAllSessions();
              fetchSessions();
            } catch {
              Alert.alert('Error', 'Failed to kill sessions');
            } finally {
              setKillingAll(false);
            }
          },
        },
      ],
    );
  }, [client, killingAll, totalTmux, fetchSessions]);

  // Flatten to list items — active sessions at top, then project groups
  const listData = useMemo(() => {
    const items: ListItem[] = [];

    // Active tmux sessions section (only when not searching)
    if (activeSessions.length > 0 && !debouncedSearch) {
      items.push({ type: 'activeHeader', count: activeSessions.length });
      for (const s of activeSessions) {
        items.push({ type: 'activeSession', session: s });
      }
      items.push({ type: 'sectionDivider' });
    }

    for (const group of filteredGroups) {
      items.push({ type: 'project', group });
      if (!expanded[group.path]) continue;

      const all = showAll[group.path];
      const visible = all
        ? group.sessions
        : group.sessions.slice(0, PREVIEW_COUNT);

      for (let i = 0; i < visible.length; i++) {
        const isLast =
          all || group.sessions.length <= PREVIEW_COUNT
            ? i === visible.length - 1
            : false;
        items.push({ type: 'session', session: visible[i], isLast });
      }

      if (!all && group.sessions.length > PREVIEW_COUNT) {
        items.push({
          type: 'showMore',
          path: group.path,
          remaining: group.sessions.length - PREVIEW_COUNT,
        });
      }
    }
    return items;
  }, [filteredGroups, expanded, showAll, activeSessions, debouncedSearch]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const handleKill = useCallback(
    (sessionId: string) => {
      if (!client || killingSession) return;
      Alert.alert(
        'Kill Session',
        'This will stop Claude and close the tmux session.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Kill',
            style: 'destructive',
            onPress: async () => {
              setKillingSession(sessionId);
              try {
                await client.killSession(sessionId);
                fetchSessions();
              } catch {
                Alert.alert('Error', 'Failed to kill session');
              } finally {
                setKillingSession(null);
              }
            },
          },
        ],
      );
    },
    [client, killingSession, fetchSessions],
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'activeHeader') {
        return (
          <View style={styles.activeHeader}>
            <View style={styles.activeHeaderLeft}>
              <View style={styles.activeIndicator} />
              <Text style={styles.activeHeaderTitle}>Active Sessions</Text>
              <Text style={styles.activeHeaderCount}>{item.count}</Text>
            </View>
            <TouchableOpacity
              style={styles.killAllBtn}
              onPress={handleKillAll}
              disabled={killingAll}
              activeOpacity={0.7}>
              <Text style={styles.killAllText}>
                {killingAll ? 'Killing...' : 'Kill All'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      }

      if (item.type === 'activeSession') {
        const { session } = item;
        const statusCfg = STATUS_CFG[session.tmuxStatus];
        const claudeCfg = CLAUDE_STATE_CFG[session.claudeState ?? 'unknown'];
        const activePreview = cleanPreview(session.lastMessagePreview);
        const hasActivePreview = activePreview !== 'No preview';
        const stateLabel = claudeCfg.label || statusCfg.label;
        return (
          <TouchableOpacity
            style={styles.activeSessionRow}
            onPress={() => onSelectSession(session)}
            activeOpacity={0.7}>
            <View style={[styles.activeSessionDot, { backgroundColor: claudeCfg.color }]} />
            <View style={styles.activeSessionContent}>
              <Text style={styles.activeSessionName} numberOfLines={1}>
                {hasActivePreview ? activePreview : session.projectName}
              </Text>
              <Text style={styles.activeSessionMeta}>
                {session.projectName} · {session.id.slice(0, 7)} · {formatTime(session.timestamp)} · {stateLabel}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.killBtn}
              onPress={() => handleKill(session.id)}
              activeOpacity={0.5}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.killIcon}>×</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        );
      }

      if (item.type === 'sectionDivider') {
        return (
          <View style={styles.sectionDivider}>
            <Text style={styles.sectionDividerText}>All Projects</Text>
            <View style={styles.sectionDividerLine} />
          </View>
        );
      }

      if (item.type === 'project') {
        const { group } = item;
        const isOpen = !!expanded[group.path];
        return (
          <TouchableOpacity
            style={styles.projectRow}
            onPress={() => toggleExpand(group.path)}
            activeOpacity={0.7}>
            <Text style={styles.chevron}>{isOpen ? '▾' : '▸'}</Text>
            <Text style={styles.projectName} numberOfLines={1}>
              {group.name}
            </Text>
            {group.activeTmuxCount > 0 && (
              <View style={styles.tmuxBadge}>
                <View style={styles.tmuxDot} />
                <Text style={styles.tmuxCount}>{group.activeTmuxCount}</Text>
              </View>
            )}
            <Text style={styles.projectSessionCount}>{group.sessions.length}</Text>
          </TouchableOpacity>
        );
      }

      if (item.type === 'showMore') {
        return (
          <TouchableOpacity
            style={styles.sessionRow}
            onPress={() =>
              setShowAll(prev => ({ ...prev, [item.path]: true }))
            }
            activeOpacity={0.7}>
            <Text style={styles.treeLine}>{'  └─ '}</Text>
            <Text style={styles.showMoreText}>
              Show all (+{item.remaining} more)
            </Text>
          </TouchableOpacity>
        );
      }

      const { session, isLast } = item;
      const claudeCfg = CLAUDE_STATE_CFG[session.claudeState ?? 'unknown'];
      const statusCfg = STATUS_CFG[session.tmuxStatus];
      const hasTmux = session.tmuxStatus !== 'none';
      const line = isLast ? '└─' : '├─';
      const preview = cleanPreview(session.lastMessagePreview);
      const hasPreview = preview !== 'No preview';
      const dotColor = hasTmux ? claudeCfg.color : statusCfg.color;
      const label = hasTmux && claudeCfg.label ? claudeCfg.label : statusCfg.label;

      return (
        <TouchableOpacity
          style={styles.sessionRow}
          onPress={() => onSelectSession(session)}
          activeOpacity={0.7}>
          <Text style={styles.treeLine}>{'  '}{line}{' '}</Text>
          <View style={styles.sessionContent}>
            <Text style={styles.sessionName} numberOfLines={1}>
              {hasPreview ? preview : session.id.slice(0, 8)}
            </Text>
            <View style={styles.sessionMetaLine}>
              <Text style={styles.sessionMeta}>
                {session.id.slice(0, 7)} · {formatTime(session.timestamp)}
              </Text>
              <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
              <Text style={[styles.statusLabel, { color: dotColor }]}>
                {label}
              </Text>
              <View style={styles.rowSpacer} />
              {hasTmux && (
                <TouchableOpacity
                  style={styles.killBtn}
                  onPress={() => handleKill(session.id)}
                  activeOpacity={0.5}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.killIcon}>×</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [expanded, showAll, onSelectSession, toggleExpand, handleKill, handleKillAll, killingAll],
  );

  const keyExtractor = useCallback((item: ListItem) => {
    if (item.type === 'activeHeader') return 'active-header';
    if (item.type === 'activeSession') return `a:${item.session.id}`;
    if (item.type === 'sectionDivider') return 'section-divider';
    if (item.type === 'project') return `p:${item.group.path}`;
    if (item.type === 'session') return `s:${item.session.id}`;
    return `m:${item.path}`;
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Sessions</Text>
          <Text style={styles.subtitle}>
            {sessions.length} sessions
            {totalTmux > 0 ? ` · ${totalTmux} active` : ''}
            {status ? ` · v${status.version}` : ''}
            {isCached ? ' · Refreshing...' : ''}
            {isStreaming ? ' · Live' : ''}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {onNewSession && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={onNewSession}
              activeOpacity={0.7}>
              <Text style={styles.actionBtnText}>+</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionBtnMuted}
            onPress={onOpenSettings}
            activeOpacity={0.7}>
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search projects..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>

      {!isReachable && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>Offline — reconnecting...</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Tree list */}
      <FlatList
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        initialNumToRender={20}
        maxToRenderPerBatch={15}
        windowSize={5}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchSessions}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {search ? 'No matches' : 'No sessions'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {search
                ? 'Try a different search term.'
                : 'Start a Claude Code session on your Mac.'}
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <View style={styles.footerLine} />
            <View style={styles.footerRow}>
              <Animated.View
                style={[styles.pulseDot, { opacity: pulseAnim }]}
              />
              <Text style={styles.footerLabel}>Internal Use Only</Text>
            </View>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + 8,
    paddingBottom: spacing.sm,
  },
  headerLeft: {
    flex: 1,
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
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 20,
    color: colors.textInverse,
    fontWeight: '600',
    lineHeight: 22,
  },
  actionBtnMuted: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bgSurface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsIcon: {
    fontSize: 16,
  },

  // ── Search ──
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  searchInput: {
    backgroundColor: colors.bgElevated,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  // ── Offline ──
  offlineBanner: {
    backgroundColor: colors.warningMuted,
    marginHorizontal: spacing.lg,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  offlineText: {
    color: colors.warning,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },

  // ── Error ──
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

  // ── List ──
  listContent: {
    paddingBottom: spacing.xxl,
  },

  // ── Active sessions section ──
  activeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  activeHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  activeHeaderTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  activeHeaderCount: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontFamily: fontFamily.mono,
  },
  killAllBtn: {
    backgroundColor: colors.errorMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  killAllText: {
    fontSize: fontSize.xs,
    color: colors.error,
    fontWeight: '600',
  },
  activeSessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  activeSessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.sm,
  },
  activeSessionContent: {
    flex: 1,
  },
  activeSessionName: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  activeSessionMeta: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  sectionDividerText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },

  // ── Project row ──
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  chevron: {
    fontSize: 14,
    color: colors.textMuted,
    width: 20,
  },
  projectName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  tmuxBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentMuted,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    marginRight: spacing.sm,
    gap: 4,
  },
  tmuxDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.accent,
  },
  tmuxCount: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: '600',
  },
  projectSessionCount: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontFamily: fontFamily.mono,
    minWidth: 24,
    textAlign: 'right',
  },

  // ── Session row ──
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    paddingRight: spacing.lg,
  },
  treeLine: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontFamily: fontFamily.mono,
    paddingLeft: spacing.lg,
    width: 72,
    paddingTop: 2,
  },
  sessionContent: {
    flex: 1,
  },
  sessionName: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sessionMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  sessionMeta: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontFamily: fontFamily.mono,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginLeft: 8,
    marginRight: 4,
  },
  statusLabel: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  rowSpacer: {
    flex: 1,
  },
  killBtn: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  killIcon: {
    fontSize: 18,
    color: colors.error,
    fontWeight: '700',
  },

  // ── Show more ──
  showMoreText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '500',
  },

  // ── Empty ──
  empty: {
    alignItems: 'center',
    paddingTop: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
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

  // ── Footer ──
  footer: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  footerLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginBottom: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  footerLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});
