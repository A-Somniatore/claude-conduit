import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SectionList,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius, fontFamily } from '../theme';
import { useConnectionStore } from '../stores/connection';
import type { DirectoryEntry } from '../types/session';

interface SectionData {
  title: string;
  data: DirectoryEntry[];
}

export function NewSessionScreen({
  onCreated,
  onBack,
}: {
  onCreated: (sessionId: string, attachToken: string, projectPath: string, projectName: string) => void;
  onBack: () => void;
}) {
  const { client } = useConnectionStore();
  const insets = useSafeAreaInsets();
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!client) return;
    client
      .getDirectories()
      .then(setDirectories)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [client]);

  const sections: SectionData[] = [];

  const rootDirs = directories.filter((d) => d.group === 'root');
  if (rootDirs.length > 0) {
    sections.push({ title: 'Quick Start', data: rootDirs });
  }

  const projectDirs = directories.filter((d) => d.group === 'projects');
  if (projectDirs.length > 0) {
    sections.push({ title: 'Projects', data: projectDirs });
  }

  const startupDirs = directories.filter((d) => d.group === 'startups');
  if (startupDirs.length > 0) {
    sections.push({ title: 'Startups', data: startupDirs });
  }

  const handleSelect = useCallback(
    async (dir: DirectoryEntry) => {
      if (!client || creating) return;
      setCreating(dir.path);
      setError('');

      try {
        const result = await client.createNewSession(dir.path);
        onCreated(result.sessionId, result.attachToken, result.projectPath, result.projectName);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create session');
        setCreating(null);
      }
    },
    [client, creating, onCreated],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}>
          <Text style={styles.backText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>New Session</Text>
        <View style={styles.headerRight} />
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>Loading directories...</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.path}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.dirRow}
              onPress={() => handleSelect(item)}
              activeOpacity={0.7}
              disabled={creating !== null}>
              <View style={styles.dirInfo}>
                <Text style={styles.dirName}>{item.name}</Text>
                <Text style={styles.dirPath} numberOfLines={1}>
                  {item.path.replace(/^\/Users\/[^/]+\//, '~/')}
                </Text>
              </View>
              {creating === item.path ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text style={styles.dirArrow}>+</Text>
              )}
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
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
  errorBanner: {
    backgroundColor: colors.errorMuted,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.sm,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: fontSize.md,
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
  },
  sectionCount: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  dirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dirInfo: {
    flex: 1,
  },
  dirName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  dirPath: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontFamily: fontFamily.mono,
  },
  dirArrow: {
    fontSize: fontSize.xl,
    color: colors.accent,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
});
