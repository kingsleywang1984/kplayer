import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import WebView from 'react-native-webview';
import CookieManager from '@react-native-cookies/cookies';
import axios from 'axios';

import { TextColors, SurfaceColors, BorderRadius, Spacing } from '@/constants/theme';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');

interface YouTubeLoginModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
}

export function YouTubeLoginModal({ visible, onDismiss, onSuccess }: YouTubeLoginModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webViewKey, setWebViewKey] = useState(0);

  const handleExtractCookies = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('[YouTubeLogin] Extracting cookies using CookieManager...');

      // Get all cookies for YouTube domain (including HttpOnly cookies)
      const allCookies = await CookieManager.get('https://www.youtube.com', true);
      console.log('[YouTubeLogin] Retrieved cookies:', Object.keys(allCookies || {}).length, 'cookies');

      if (!allCookies || Object.keys(allCookies).length === 0) {
        setError('No cookies found. Make sure you are logged in to YouTube.');
        setLoading(false);
        return;
      }

      // Convert cookies to Netscape format (yt-dlp compatible)
      const now = Math.floor(Date.now() / 1000);
      const netscapeCookies = Object.entries(allCookies).map(([name, cookie]: [string, any]) => {
        const domain = cookie.domain || '.youtube.com';
        const path = cookie.path || '/';
        const secure = cookie.secure ? 'TRUE' : 'FALSE';
        const expires = cookie.expires
          ? (typeof cookie.expires === 'string'
              ? Math.floor(new Date(cookie.expires).getTime() / 1000)
              : cookie.expires)
          : now + (365 * 24 * 60 * 60); // 1 year default
        const value = cookie.value || '';

        // Netscape format: domain, flag, path, secure, expiration, name, value
        return `${domain}\tTRUE\t${path}\t${secure}\t${expires}\t${name}\t${value}`;
      }).join('\n');

      const cookieData = '# Netscape HTTP Cookie File\n' + netscapeCookies;
      console.log('[YouTubeLogin] Cookie data length:', cookieData.length);
      console.log('[YouTubeLogin] Sending to:', `${STREAM_BASE_URL}/api/youtube-cookies`);

      // Send cookies to Gateway
      const response = await axios.post(`${STREAM_BASE_URL}/api/youtube-cookies`, {
        cookies: cookieData
      });

      console.log('[YouTubeLogin] Cookies sent successfully:', response.data);
      setLoading(false);
      onSuccess();
      onDismiss();
    } catch (err: any) {
      console.error('[YouTubeLogin] Failed:', err);
      console.error('[YouTubeLogin] Error details:', err.message, err.response?.data);
      setError(`Failed: ${err.message || 'Unknown error'}. Check console for details.`);
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setError(null);
    setWebViewKey(prev => prev + 1); // Force WebView reload
  };

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
            source={{ uri: 'https://www.youtube.com' }}
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
            onPress={handleExtractCookies}
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
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    paddingTop: Spacing.xl + 20,
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
