import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import axios from 'axios';

import { Colors } from '@/constants/theme';
import { SETTINGS_DEFAULTS, useSettings } from '@/context/settings-context';
import { Galaxy3D } from '@/components/Galaxy3D';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');

type GatewayStatus = 'checking' | 'online' | 'offline';

export default function SettingsScreen() {
  const { autoRefreshEnabled, keepAliveEnabled, setAutoRefreshEnabled, setKeepAliveEnabled } =
    useSettings();
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('checking');

  useEffect(() => {
    let mounted = true;

    async function pingGateway() {
      if (!STREAM_BASE_URL) {
        setGatewayStatus('offline');
        return;
      }

      try {
        await axios.get(`${STREAM_BASE_URL}/healthz`, { timeout: 4000 });
        if (mounted) {
          setGatewayStatus('online');
        }
      } catch (error) {
        console.warn('Gateway health check failed', error);
        if (mounted) {
          setGatewayStatus('offline');
        }
      }
    }

    pingGateway();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      <Galaxy3D style={{ position: 'absolute', width: '100%', height: '100%' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>用户设置</Text>
        <Text style={styles.subtitle}>可在此覆盖 .env 中的自动刷新和保活配置。</Text>

        <BlurView intensity={20} tint="dark" style={styles.glassCard}>
          <View style={styles.cardContent}>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>服务状态</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <View
                  style={[
                    styles.statusDot,
                    gatewayStatus === 'online' ? styles.online : styles.offline,
                  ]}
                />
                <Text style={styles.cardSubtitle}>
                  {gatewayStatus === 'checking'
                    ? '检查中...'
                    : gatewayStatus === 'online'
                      ? '服务在线'
                      : '服务离线'}
                </Text>
              </View>
              <Text style={styles.cardDescription}>
                显示后端服务的连接状态。
              </Text>
            </View>
          </View>
        </BlurView>

        <BlurView intensity={20} tint="dark" style={styles.glassCard}>
          <View style={styles.cardContent}>
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
        </BlurView>

        <BlurView intensity={20} tint="dark" style={styles.glassCard}>
          <View style={styles.cardContent}>
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
        </BlurView>
      </ScrollView>
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 20,
    paddingTop: 60,
    gap: 16,
  },
  heading: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  glassCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(30, 30, 40, 0.3)',
  },
  cardContent: {
    padding: 16,
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
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 4,
  },
  cardDescription: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  online: {
    backgroundColor: '#34a853',
  },
  offline: {
    backgroundColor: '#ea4335',
  },
});
