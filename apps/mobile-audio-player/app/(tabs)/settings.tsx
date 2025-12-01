import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { SETTINGS_DEFAULTS, useSettings } from '@/context/settings-context';

export default function SettingsScreen() {
  const { autoRefreshEnabled, keepAliveEnabled, setAutoRefreshEnabled, setKeepAliveEnabled } =
    useSettings();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>用户设置</Text>
      <Text style={styles.subtitle}>可在此覆盖 .env 中的自动刷新和保活配置。</Text>

      <View style={styles.card}>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>自动刷新缓存列表</Text>
          <Text style={styles.cardSubtitle}>
            {autoRefreshEnabled ? '开启' : '关闭'}（默认：
            {SETTINGS_DEFAULTS.autoRefreshEnabled ? '开启' : '关闭'}）
          </Text>
          <Text style={styles.cardDescription}>
            每 30 秒拉取一次曲目与分组列表，方便在多设备间保持同步。
          </Text>
        </View>
        <Switch
          value={autoRefreshEnabled}
          onValueChange={setAutoRefreshEnabled}
          trackColor={{ true: Colors.dark.tint, false: '#5f6368' }}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>Render 保活</Text>
          <Text style={styles.cardSubtitle}>
            {keepAliveEnabled ? '开启' : '关闭'}（默认：
            {SETTINGS_DEFAULTS.keepAliveEnabled ? '开启' : '关闭'}）
          </Text>
          <Text style={styles.cardDescription}>
            每 10 分钟 ping 一次 /healthz，避免 Render 免费实例在使用期间休眠。
          </Text>
        </View>
        <Switch
          value={keepAliveEnabled}
          onValueChange={setKeepAliveEnabled}
          trackColor={{ true: Colors.dark.tint, false: '#5f6368' }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0d0f',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  heading: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9aa0a6',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#15171a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2c2d30',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardText: {
    flex: 1,
    marginRight: 12,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: '#9aa0a6',
    marginTop: 4,
  },
  cardDescription: {
    color: '#bdc1c6',
    marginTop: 6,
    lineHeight: 20,
  },
});

