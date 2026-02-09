import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  useWindowDimensions,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import { useConnectionStore } from '../stores/connection';
import type { Session } from '../types/session';
import { XTERM_JS, XTERM_CSS, FIT_ADDON_JS, WEB_LINKS_ADDON_JS } from '../assets/xterm/xterm-bundle';

type TerminalState = 'connecting' | 'attached' | 'error' | 'disconnected' | 'reconnecting';

const MAX_RECONNECT = 3;

export function TerminalScreen({
  session,
  attachToken: preAttachToken,
  onBack,
}: {
  session: Session;
  attachToken?: string;
  onBack: () => void;
}) {
  const { client } = useConnectionStore();
  const webViewRef = useRef<WebView>(null);
  const inputRef = useRef<TextInput>(null);
  const [state, setState] = useState<TerminalState>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [inputText, setInputText] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const usedPreToken = useRef(false);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const attachedRef = useRef(false);

  const doAttach = useCallback(async () => {
    if (!client) {
      setState('error');
      setErrorMsg('Not connected to daemon');
      return;
    }

    // Prevent double-attach from layout re-renders
    if (attachedRef.current) return;
    attachedRef.current = true;

    // Initial cols/rows for the PTY — fitAddon.fit() sends the real
    // dimensions immediately after WS connects, so these are just hints.
    const defaultCols = Math.max(40, Math.floor((width - 16) / 8.4));
    const defaultRows = 24;

    try {
      // If we have a pre-existing attach token (from new session creation)
      // and haven't used it yet, skip the attach API call and connect directly.
      if (preAttachToken && !usedPreToken.current) {
        usedPreToken.current = true;
        const url = client.terminalWsUrl(session.id, preAttachToken, defaultCols, defaultRows);
        setWsUrl(url);
        return;
      }

      const result = await client.attach(session.id);
      const url = client.terminalWsUrl(
        session.id,
        result.attachToken,
        defaultCols,
        defaultRows,
      );
      setWsUrl(url);
    } catch (err) {
      attachedRef.current = false; // Allow retry on error
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to attach');
    }
  }, [client, session.id, preAttachToken]);

  useEffect(() => {
    attachedRef.current = false; // Reset on mount

    let cancelled = false;
    async function attach() {
      if (cancelled) return;
      await doAttach();
    }

    attach();
    return () => {
      cancelled = true;
      // Close the WebSocket inside the WebView before unmount
      webViewRef.current?.injectJavaScript('if(window._ws) window._ws.close(); true;');
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (focusTimer.current) clearTimeout(focusTimer.current);
    };
  }, [doAttach]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      switch (msg.type) {
        case 'connected':
          setState('attached');
          setReconnectCount(0);
          focusTimer.current = setTimeout(() => inputRef.current?.focus(), 500);
          break;
        case 'disconnected': {
          const code = msg.code as number | undefined;
          // Don't reconnect on auth/conflict errors (4xxx)
          if (code && code >= 4400 && code < 4500) {
            setState('error');
            setErrorMsg(msg.reason || `Connection refused (code ${code})`);
          } else if (reconnectCount < MAX_RECONNECT) {
            setState('reconnecting');
            const delay = Math.min(1000 * Math.pow(2, reconnectCount), 10000);
            reconnectTimer.current = setTimeout(() => {
              setReconnectCount(c => c + 1);
              setWsUrl(null);
              attachedRef.current = false;
              doAttach();
            }, delay);
          } else {
            setState('disconnected');
          }
          break;
        }
        case 'error':
          setState('error');
          setErrorMsg(msg.message || 'Terminal error');
          break;
      }
    } catch {
      // ignore non-JSON messages
    }
  }, [reconnectCount, doAttach]);

  // Send data to the WebView's WebSocket
  const sendToTerminal = useCallback(
    (data: string) => {
      webViewRef.current?.injectJavaScript(
        `window.sendKey(${JSON.stringify(data)}); true;`,
      );
    },
    [],
  );

  // Handle text input changes — send each new character
  // Value is always '' (controlled), so any text in onChangeText is new input
  const handleTextChange = useCallback(
    (text: string) => {
      if (text.length > 0) {
        sendToTerminal(text);
      }
      // Reset synchronously — blurOnSubmit={false} keeps keyboard open
      setInputText('');
    },
    [sendToTerminal],
  );

  // Handle special keys via keyPress event
  // Enter is handled by onSubmitEditing to avoid double-send
  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const { key } = e.nativeEvent;
      if (key === 'Backspace') {
        sendToTerminal('\x7f');
      }
    },
    [sendToTerminal],
  );

  // Toggle keyboard on tap — tap to show, tap again to dismiss
  const focusInput = useCallback(() => {
    if (keyboardHeight > 0) {
      inputRef.current?.blur();
    } else {
      // Small delay ensures iOS has finished any dismiss animation
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [keyboardHeight]);

  // Clear terminal screen
  const clearScreen = useCallback(() => {
    sendToTerminal('\x0c'); // Ctrl-L
    webViewRef.current?.injectJavaScript('window.scrollToBottom(); true;');
  }, [sendToTerminal]);

  // Manual reconnect
  const handleReconnect = useCallback(() => {
    setReconnectCount(0);
    setState('connecting');
    setWsUrl(null);
    attachedRef.current = false;
    doAttach();
  }, [doAttach]);

  // Memoize HTML — only rebuild when wsUrl changes (new connection).
  // Terminal sizing is handled entirely inside the WebView via ResizeObserver.
  const terminalHtml = useMemo(
    () => getTerminalHtml(wsUrl ?? '', width),
    [wsUrl, width],
  );

  // Track keyboard height — adjusts container padding so WebView shrinks,
  // which triggers ResizeObserver inside the WebView to refit the terminal.
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0),
    );
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: keyboardHeight }]}>
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
                state === 'connecting' && styles.statusDotConnecting,
                state === 'reconnecting' && styles.statusDotConnecting,
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
        <View style={styles.headerRight}>
          {state === 'attached' && (
            <TouchableOpacity onPress={clearScreen} activeOpacity={0.7}>
              <Text style={styles.headerAction}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Terminal area — tap to focus hidden input (brings up keyboard) */}
      <TouchableOpacity
        style={styles.terminalContainer}
        activeOpacity={1}
        onPress={focusInput}>
        {state === 'connecting' && (
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

        {state === 'reconnecting' && (
          <View style={styles.overlay}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.overlayText}>
              Reconnecting... (attempt {reconnectCount + 1}/{MAX_RECONNECT})
            </Text>
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
              onPress={handleReconnect}
              activeOpacity={0.8}>
              <Text style={styles.retryButtonText}>Reconnect</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onBack}
              activeOpacity={0.8}>
              <Text style={styles.secondaryButtonText}>Go Back</Text>
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
            allowsInlineMediaPlayback
            contentMode="mobile"
          />
        )}
      </TouchableOpacity>

      {/* Hidden TextInput — captures keyboard input, sends to terminal.
          Positioned within viewport (opacity 0) so iOS handles blur/refocus correctly. */}
      {state === 'attached' && (
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType="ascii-capable"
          textContentType="none"
          onChangeText={handleTextChange}
          onKeyPress={handleKeyPress}
          value={inputText}
          blurOnSubmit={false}
          returnKeyType="send"
          onSubmitEditing={() => {
            sendToTerminal('\r');
            setInputText('');
          }}
        />
      )}
    </View>
  );
}

function getTerminalHtml(wsUrl: string, screenWidth: number): string {
  // Estimate initial cols from screen width (fitAddon.fit() will correct immediately)
  const estCols = Math.max(40, Math.floor((screenWidth - 16) / 8.4));

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
</style>
<style>${XTERM_CSS}</style>
<script>${XTERM_JS}</script>
<script>${FIT_ADDON_JS}</script>
<script>${WEB_LINKS_ADDON_JS}</script>
</head>
<body>
<div id="terminal"></div>
<script>
(function() {
  var wsUrl = ${JSON.stringify(wsUrl)};
  var term = new Terminal({
    cols: ${estCols},
    rows: 24,
    scrollback: 5000,
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
    disableStdin: true,
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

  // Debounced resize — called by ResizeObserver when container changes.
  // Refits the terminal and tells the PTY the new dimensions.
  var lastCols = term.cols;
  var lastRows = term.rows;
  var resizeTimer = null;

  function doResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      try {
        fitAddon.fit();
        // Only send resize if dimensions actually changed
        if (term.cols !== lastCols || term.rows !== lastRows) {
          lastCols = term.cols;
          lastRows = term.rows;
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        }
      } catch(e) {}
    }, 100);
  }

  // ResizeObserver — the single source of truth for terminal sizing.
  // Fires when the WebView container changes (keyboard show/hide, rotation).
  try {
    var ro = new ResizeObserver(doResize);
    ro.observe(document.getElementById('terminal'));
  } catch(e) {
    // Fallback for older WebKit
    window.addEventListener('resize', doResize);
  }

  window._term = term;
  window._fitAddon = fitAddon;
  var ws = null;

  // Send key from React Native keyboard input
  var encoder = new TextEncoder();
  window.sendKey = function(key) {
    if (ws && ws.readyState === 1) {
      ws.send(encoder.encode(key));
    }
  };

  window.scrollToBottom = function() {
    term.scrollToBottom();
  };

  if (!wsUrl) return;

  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  window._ws = ws;

  ws.onopen = function() {
    // Fit to actual container size, then tell daemon the real dimensions
    try {
      fitAddon.fit();
      lastCols = term.cols;
      lastRows = term.rows;
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    } catch(e) {}
    notify({ type: 'connected' });
  };

  ws.onmessage = function(ev) {
    if (typeof ev.data === 'string') {
      term.write(ev.data);
    } else {
      term.write(new Uint8Array(ev.data));
    }
  };

  ws.onclose = function(ev) {
    notify({ type: 'disconnected', code: ev.code, reason: ev.reason || '' });
  };

  ws.onerror = function() {
    notify({ type: 'error', message: 'WebSocket error' });
  };
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
    backgroundColor: colors.textMuted,
  },
  statusDotConnecting: {
    backgroundColor: colors.accent,
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
    alignItems: 'flex-end',
  },
  headerAction: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  terminalContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.terminalBg,
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0.01,
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
  secondaryButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
});
