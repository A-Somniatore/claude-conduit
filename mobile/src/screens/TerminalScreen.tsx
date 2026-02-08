import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import { useSessionsStore } from '../stores/sessions';
import { useConnectionStore } from '../stores/connection';
import type { Session } from '../types/session';
import { KeyboardToolbar } from '../components/KeyboardToolbar';

type TerminalState = 'connecting' | 'attached' | 'error' | 'disconnected';

export function TerminalScreen({
  session,
  onBack,
}: {
  session: Session;
  onBack: () => void;
}) {
  const { client } = useConnectionStore();
  const webViewRef = useRef<WebView>(null);
  const [state, setState] = useState<TerminalState>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const { width, height } = useWindowDimensions();

  // Calculate terminal dimensions from screen size
  const charWidth = 8.4; // Menlo 14px approximate
  const charHeight = 18;
  const cols = Math.floor((width - 16) / charWidth);
  const rows = Math.floor((height - 140) / charHeight); // account for header + toolbar

  const [wsUrl, setWsUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function attach() {
      if (!client) {
        setState('error');
        setErrorMsg('Not connected to daemon');
        return;
      }

      try {
        const result = await client.attach(session.id);
        if (cancelled) return;

        const url = client.terminalWsUrl(
          session.id,
          result.attachToken,
          cols,
          rows,
        );
        setWsUrl(url);
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setErrorMsg(
          err instanceof Error ? err.message : 'Failed to attach',
        );
      }
    }

    attach();
    return () => {
      cancelled = true;
    };
  }, [client, session.id, cols, rows]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      switch (msg.type) {
        case 'connected':
          setState('attached');
          break;
        case 'disconnected':
          setState('disconnected');
          break;
        case 'error':
          setState('error');
          setErrorMsg(msg.message || 'Terminal error');
          break;
      }
    } catch {
      // ignore non-JSON messages
    }
  }, []);

  const sendKey = useCallback(
    (key: string) => {
      webViewRef.current?.injectJavaScript(
        `window.sendKey(${JSON.stringify(key)}); true;`,
      );
    },
    [],
  );

  const terminalHtml = getTerminalHtml(wsUrl ?? '', cols, rows);

  return (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {session.projectName}
          </Text>
          <View style={styles.headerStatus}>
            <View
              style={[
                styles.statusDot,
                state === 'attached' && styles.statusDotActive,
                state === 'error' && styles.statusDotError,
                state === 'disconnected' && styles.statusDotDisconnected,
              ]}
            />
            <Text style={styles.statusText}>
              {state === 'connecting'
                ? 'Connecting...'
                : state === 'attached'
                  ? 'Connected'
                  : state === 'error'
                    ? 'Error'
                    : 'Disconnected'}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight} />
      </View>

      {/* Terminal */}
      <View style={styles.terminalContainer}>
        {state === 'connecting' && !wsUrl && (
          <View style={styles.overlay}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.overlayText}>Attaching to session...</Text>
          </View>
        )}

        {state === 'error' && (
          <View style={styles.overlay}>
            <Text style={styles.overlayIcon}>⚠</Text>
            <Text style={styles.overlayTitle}>Connection Failed</Text>
            <Text style={styles.overlayText}>{errorMsg}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={onBack}
              activeOpacity={0.8}>
              <Text style={styles.retryButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'disconnected' && (
          <View style={styles.overlay}>
            <Text style={styles.overlayIcon}>🔌</Text>
            <Text style={styles.overlayTitle}>Disconnected</Text>
            <Text style={styles.overlayText}>
              The terminal session was closed.
            </Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={onBack}
              activeOpacity={0.8}>
              <Text style={styles.retryButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {wsUrl && (
          <WebView
            ref={webViewRef}
            source={{ html: terminalHtml }}
            style={styles.webview}
            onMessage={onMessage}
            javaScriptEnabled
            originWhitelist={['*']}
            scrollEnabled={false}
            bounces={false}
            keyboardDisplayRequiresUserAction={false}
            hideKeyboardAccessoryView
            allowsInlineMediaPlayback
            contentMode="mobile"
          />
        )}
      </View>

      {/* Keyboard toolbar for special keys */}
      {state === 'attached' && <KeyboardToolbar onKey={sendKey} />}
    </View>
  );
}

function getTerminalHtml(wsUrl: string, cols: number, rows: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; background: #1A1A1A; }
  #terminal { height: 100%; width: 100%; }
  .xterm { padding: 4px; }
  .xterm-viewport::-webkit-scrollbar { display: none; }

  /* xterm.css inline (minimal) */
  .xterm { position: relative; user-select: none; -ms-user-select: none; -webkit-user-select: none; }
  .xterm.focus, .xterm:focus { outline: none; }
  .xterm .xterm-helpers { position: absolute; top: 0; z-index: 5; }
  .xterm .xterm-helper-textarea {
    padding: 0; border: 0; margin: 0; position: absolute; opacity: 0;
    left: -9999em; top: 0; width: 0; height: 0; z-index: -5;
    white-space: nowrap; overflow: hidden; resize: none;
  }
  .xterm .composition-view { background: #000; color: #FFF; display: none; position: absolute; white-space: nowrap; z-index: 1; }
  .xterm .composition-view.active { display: block; }
  .xterm .xterm-viewport { background-color: #1A1A1A; overflow-y: scroll; cursor: default; position: absolute; right: 0; left: 0; top: 0; bottom: 0; }
  .xterm .xterm-screen { position: relative; }
  .xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
  .xterm .xterm-scroll-area { visibility: hidden; }
  .xterm-char-measure-element { display: inline-block; visibility: hidden; position: absolute; top: 0; left: -9999em; line-height: normal; }
  .xterm.enable-mouse-events { cursor: default; }
  .xterm .xterm-cursor-pointer { cursor: pointer; }
  .xterm.column-select.focus { cursor: crosshair; }
  .xterm .xterm-accessibility, .xterm .xterm-message { position: absolute; left: 0; top: 0; bottom: 0; right: 0; z-index: 10; color: transparent; }
  .xterm .live-region { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  .xterm-dim { opacity: 0.5; }
  .xterm-underline-1 { text-decoration: underline; }
  .xterm-underline-2 { text-decoration: double underline; }
  .xterm-underline-3 { text-decoration: wavy underline; }
  .xterm-underline-4 { text-decoration: dotted underline; }
  .xterm-underline-5 { text-decoration: dashed underline; }
  .xterm-overline { text-decoration: overline; }
  .xterm-strikethrough { text-decoration: line-through; }
  .xterm-screen .xterm-decoration-container .xterm-decoration { z-index: 6; position: absolute; }
  .xterm-decoration-overview-ruler { z-index: 7; position: absolute; top: 0; right: 0; pointer-events: none; }
  .xterm-decoration-top { z-index: 2; position: relative; }
</style>
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.min.js"></script>
</head>
<body>
<div id="terminal"></div>
<script>
(function() {
  var wsUrl = ${JSON.stringify(wsUrl)};
  var term = new Terminal({
    cols: ${cols},
    rows: ${rows},
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#1A1A1A',
      foreground: '#E8E8E8',
      cursor: '#DA7756',
      cursorAccent: '#1A1A1A',
      selectionBackground: 'rgba(218, 119, 86, 0.3)',
      black: '#1A1A1A',
      red: '#EF5350',
      green: '#4CAF50',
      yellow: '#FFA726',
      blue: '#42A5F5',
      magenta: '#AB47BC',
      cyan: '#26C6DA',
      white: '#E8E8E8',
      brightBlack: '#666666',
      brightRed: '#EF5350',
      brightGreen: '#66BB6A',
      brightYellow: '#FFCA28',
      brightBlue: '#42A5F5',
      brightMagenta: '#CE93D8',
      brightCyan: '#26C6DA',
      brightWhite: '#FFFFFF',
    },
    allowProposedApi: true,
  });

  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.open(document.getElementById('terminal'));

  try { fitAddon.fit(); } catch(e) {}

  function notify(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  // Send key from RN
  window.sendKey = function(key) {
    if (ws && ws.readyState === 1) {
      ws.send(key);
    }
  };

  if (!wsUrl) return;

  var ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = function() {
    notify({ type: 'connected' });
    term.focus();
  };

  ws.onmessage = function(ev) {
    if (typeof ev.data === 'string') {
      term.write(ev.data);
    } else {
      term.write(new Uint8Array(ev.data));
    }
  };

  ws.onclose = function() {
    notify({ type: 'disconnected' });
  };

  ws.onerror = function(ev) {
    notify({ type: 'error', message: 'WebSocket error' });
  };

  term.onData(function(data) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  });

  // Resize
  window.addEventListener('resize', function() {
    try { fitAddon.fit(); } catch(e) {}
  });
})();
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.terminalBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
  },
  backText: {
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  headerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  statusDotActive: {
    backgroundColor: colors.success,
  },
  statusDotError: {
    backgroundColor: colors.error,
  },
  statusDotDisconnected: {
    backgroundColor: colors.textMuted,
  },
  statusText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  headerRight: {
    width: 60,
  },
  terminalContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.terminalBg,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    zIndex: 10,
  },
  overlayIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  overlayTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  overlayText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  retryButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.md,
  },
  retryButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
