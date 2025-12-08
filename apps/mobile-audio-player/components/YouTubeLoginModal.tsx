import { useState } from 'react';
import { Modal, StyleSheet, View, Platform } from 'react-native';
import { Button, Text, ActivityIndicator } from 'react-native-paper';
import WebView from 'react-native-webview';
import axios from 'axios';

import { TextColors, SurfaceColors, BorderRadius, Spacing } from '@/constants/theme';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');

// JavaScript to extract cookies from YouTube page
const COOKIE_EXTRACTION_SCRIPT = `
(function() {
  // Get all cookies in Netscape format (yt-dlp compatible)
  const cookies = document.cookie;
  const domain = '.youtube.com';
  const path = '/';
  const now = Math.floor(Date.now() / 1000);
  const expires = now + (365 * 24 * 60 * 60); // 1 year from now

  // Convert document.cookie format to Netscape format
  const cookiePairs = cookies.split('; ');
  const netscapeCookies = cookiePairs.map(pair => {
    const [name, value] = pair.split('=');
    // Netscape format: domain, flag, path, secure, expiration, name, value
    return domain + '\\tTRUE\\t' + path + '\\tFALSE\\t' + expires + '\\t' + name + '\\t' + value;
  }).join('\\n');

  // Send cookies to React Native
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: 'COOKIES',
    cookies: '# Netscape HTTP Cookie File\\n' + netscapeCookies
  }));
})();
true; // Prevent "Evaluated JavaScript" warning
`;

interface YouTubeLoginModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
}

export function YouTubeLoginModal({ visible, onDismiss, onSuccess }: YouTubeLoginModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webViewKey, setWebViewKey] = useState(0);

  const handleMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === 'COOKIES') {
        setLoading(true);
        setError(null);

        // Send cookies to Gateway
        const response = await axios.post(`${STREAM_BASE_URL}/api/youtube-cookies`, {
          cookies: data.cookies
        });

        console.log('[YouTubeLogin] Cookies sent successfully:', response.data);
        setLoading(false);
        onSuccess();
        onDismiss();
      }
    } catch (err) {
      console.error('[YouTubeLogin] Failed to send cookies:', err);
      setError('Failed to save cookies. Please try again.');
      setLoading(false);
    }
  };

  const handleNavigationStateChange = (navState: any) => {
    // Check if user is logged in (URL contains specific patterns)
    const url = navState.url;
    console.log('[YouTubeLogin] Navigation:', url);

    // If user reached YouTube home page or any authenticated page, we can extract cookies
    if (url.includes('youtube.com') && !url.includes('accounts.google.com')) {
      // User might be logged in, but we'll let them click "Extract Cookies" button
      // to ensure they're fully logged in
    }
  };

  const handleExtractCookies = (webViewRef: any) => {
    if (webViewRef) {
      webViewRef.injectJavaScript(COOKIE_EXTRACTION_SCRIPT);
    }
  };

  const handleRetry = () => {
    setError(null);
    setWebViewKey(prev => prev + 1); // Force WebView reload
  };

  if (Platform.OS === 'web') {
    const loginScript = `(async function() {
  const cookies = document.cookie.split('; ');
  const domain = '.youtube.com';
  const path = '/';
  const expires = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
  const netscapeCookies = cookies.map(pair => {
    const [name, value] = pair.split('=');
    return \`\${domain}\\tTRUE\\t\${path}\\tFALSE\\t\${expires}\\t\${name}\\t\${value}\`;
  }).join('\\n');
  const cookieData = '# Netscape HTTP Cookie File\\n' + netscapeCookies;
  const response = await fetch('${STREAM_BASE_URL}/api/youtube-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies: cookieData })
  });
  const result = await response.json();
  console.log('✅', result);
  alert('✅ Cookies saved! Refresh Settings to see status.');
})();`;

    const handleCopyScript = () => {
      navigator.clipboard.writeText(loginScript);
      alert('Script copied! Now:\n1. Open YouTube.com and login\n2. Press F12 → Console\n3. Paste & press Enter');
    };

    const handleOpenYouTube = () => {
      window.open('https://www.youtube.com', '_blank');
      handleCopyScript();
    };

    return (
      <Modal visible={visible} onRequestClose={onDismiss} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 600 }]}>
            <Text variant="titleLarge" style={styles.title}>YouTube Login</Text>

            <Text variant="bodyMedium" style={[styles.message, { marginTop: 16 }]}>
              Simple 3-step process:
            </Text>

            <View style={{ marginVertical: 16, gap: 8 }}>
              <Text style={styles.message}>1️⃣ Click "Open YouTube & Copy Script"</Text>
              <Text style={styles.message}>2️⃣ Login to YouTube (if not already)</Text>
              <Text style={styles.message}>3️⃣ Press F12 → Console → Paste → Enter</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <Button mode="outlined" onPress={onDismiss}>
                Cancel
              </Button>
              <Button mode="contained" onPress={handleOpenYouTube}>
                Open YouTube & Copy Script
              </Button>
            </View>

            <Text variant="bodySmall" style={[styles.message, { marginTop: 16, fontSize: 12, opacity: 0.7 }]}>
              After running the script, manually refresh this page to see login status.
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  let webViewRef: any = null;

  return (
    <Modal visible={visible} onRequestClose={onDismiss} animationType="slide">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.headerTitle}>Login to YouTube</Text>
          <Button mode="text" onPress={onDismiss} disabled={loading}>
            Cancel
          </Button>
        </View>

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <Button mode="outlined" onPress={handleRetry} style={{ marginTop: 8 }}>
              Retry
            </Button>
          </View>
        )}

        <View style={styles.webViewContainer}>
          <WebView
            key={webViewKey}
            ref={(ref) => { webViewRef = ref; }}
            source={{ uri: 'https://www.youtube.com' }}
            onMessage={handleMessage}
            onNavigationStateChange={handleNavigationStateChange}
            style={styles.webView}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
          />
        </View>

        <View style={styles.footer}>
          <Text variant="bodySmall" style={styles.instructions}>
            1. Login to your YouTube account{'\n'}
            2. Once logged in, tap "Extract Cookies" below{'\n'}
            3. Cookies will be saved automatically
          </Text>
          <Button
            mode="contained"
            onPress={() => handleExtractCookies(webViewRef)}
            disabled={loading}
            loading={loading}
            style={styles.extractButton}
          >
            {loading ? 'Extracting...' : 'Extract Cookies'}
          </Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: SurfaceColors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    marginHorizontal: Spacing.xl,
    maxWidth: 400,
  },
  message: {
    color: TextColors.secondary,
    marginTop: Spacing.md,
  },
  title: {
    color: TextColors.primary,
  },
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    paddingTop: Spacing.xl + 20, // Account for status bar
    backgroundColor: SurfaceColors.card,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerTitle: {
    color: TextColors.primary,
  },
  webViewContainer: {
    flex: 1,
  },
  webView: {
    flex: 1,
  },
  footer: {
    padding: Spacing.lg,
    backgroundColor: SurfaceColors.card,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  instructions: {
    color: TextColors.secondary,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  extractButton: {
    marginTop: Spacing.sm,
  },
  errorContainer: {
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    padding: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 0, 0, 0.3)',
  },
  errorText: {
    color: '#ff6b6b',
    textAlign: 'center',
  },
});
