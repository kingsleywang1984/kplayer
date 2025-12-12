import { Modal, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { TextColors, SurfaceColors, BorderRadius, Spacing } from '@/constants/theme';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');

interface YouTubeLoginModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
}

export function YouTubeLoginModal({ visible, onDismiss }: YouTubeLoginModalProps) {
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

  const handleOpenYouTube = () => {
    window.open('https://www.youtube.com', '_blank');
    navigator.clipboard.writeText(loginScript);
    alert('Script copied! Now:\n1. Login to YouTube\n2. Press F12 → Console\n3. Paste & press Enter');
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
            After running the script, refresh Settings to see login status.
          </Text>
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
});
