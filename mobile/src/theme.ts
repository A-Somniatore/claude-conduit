/**
 * Claude-inspired design tokens.
 *
 * Dark background, warm terracotta accent, clean sans-serif type.
 * Matches the Claude Code CLI aesthetic.
 */

export const colors = {
  // Backgrounds
  bg: '#1A1A1A',
  bgElevated: '#242424',
  bgSurface: '#2A2A2A',
  bgHover: '#333333',
  bgInput: '#1E1E1E',

  // Text
  textPrimary: '#E8E8E8',
  textSecondary: '#999999',
  textMuted: '#666666',
  textInverse: '#1A1A1A',

  // Accent — Claude's warm terracotta/orange
  accent: '#DA7756',
  accentHover: '#C4684A',
  accentMuted: 'rgba(218, 119, 86, 0.15)',

  // Status
  success: '#4CAF50',
  successMuted: 'rgba(76, 175, 80, 0.15)',
  warning: '#FFA726',
  warningMuted: 'rgba(255, 167, 38, 0.15)',
  error: '#EF5350',
  errorMuted: 'rgba(239, 83, 80, 0.15)',

  // Borders
  border: '#333333',
  borderLight: '#2A2A2A',

  // Specific UI
  separator: '#2A2A2A',
  overlay: 'rgba(0, 0, 0, 0.6)',

  // Terminal
  terminalBg: '#1A1A1A',
  terminalCursor: '#DA7756',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  title: 34,
} as const;

export const fontFamily = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
  mono: 'Menlo',
} as const;

export const borderRadius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
} as const;
