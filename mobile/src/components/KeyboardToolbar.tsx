import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../theme';

const CTRL_KEYS = [
  { label: 'Esc', key: '\x1b' },
  { label: 'Tab', key: '\t' },
  { label: 'Ctrl', key: null }, // Modifier toggle
  { label: '↑', key: '\x1b[A' },
  { label: '↓', key: '\x1b[B' },
  { label: '←', key: '\x1b[D' },
  { label: '→', key: '\x1b[C' },
  { label: '|', key: '|' },
  { label: '~', key: '~' },
  { label: '/', key: '/' },
  { label: '-', key: '-' },
];

interface KeyboardToolbarProps {
  onKey: (key: string) => void;
}

export function KeyboardToolbar({ onKey }: KeyboardToolbarProps) {
  const [ctrlActive, setCtrlActive] = useState(false);

  const handlePress = (label: string, key: string | null) => {
    if (label === 'Ctrl') {
      setCtrlActive(!ctrlActive);
      return;
    }

    if (key === null) return;

    if (ctrlActive && key.length === 1) {
      // Convert to ctrl+<char>: ASCII code - 96 for lowercase letters
      const code = key.toLowerCase().charCodeAt(0);
      if (code >= 97 && code <= 122) {
        onKey(String.fromCharCode(code - 96));
      } else {
        onKey(key);
      }
      setCtrlActive(false);
    } else {
      onKey(key);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always">
        {CTRL_KEYS.map((item, i) => (
          <TouchableOpacity
            key={i}
            style={[
              styles.key,
              item.label === 'Ctrl' && ctrlActive && styles.keyActive,
            ]}
            onPress={() => handlePress(item.label, item.key)}
            activeOpacity={0.6}>
            <Text
              style={[
                styles.keyText,
                item.label === 'Ctrl' && ctrlActive && styles.keyTextActive,
              ]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.xs,
  },
  scrollContent: {
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  key: {
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 44,
    alignItems: 'center',
  },
  keyActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  keyText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  keyTextActive: {
    color: colors.textInverse,
  },
});
