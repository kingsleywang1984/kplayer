import { ScrollView, StyleSheet, Switch, Text, View, Pressable, TextInput, Platform } from 'react-native';
import Slider from '@react-native-community/slider';
import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import axios from 'axios';

import { Colors } from '@/constants/theme';
import { SETTINGS_DEFAULTS, useSettings } from '@/context/settings-context';
import { AppBackground } from '@/components/AppBackground';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');

type GatewayStatus = 'checking' | 'online' | 'offline';

export default function SettingsScreen() {
  const {
    autoRefreshEnabled,
    keepAliveEnabled,
    backgroundMode,
    setAutoRefreshEnabled,
    setKeepAliveEnabled,
    setBackgroundMode,
    showBanner,
    setShowBanner,
    idleTimeout,
    setIdleTimeout,
  } = useSettings();
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('checking');
  const [localIdleTimeout, setLocalIdleTimeout] = useState(idleTimeout);

  useEffect(() => {
    setLocalIdleTimeout(idleTimeout);
  }, [idleTimeout]);

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
      <AppBackground style={{ position: 'absolute', width: '100%', height: '100%' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>用户设置</Text>
        <Text style={styles.subtitle}>可在此覆盖 .env 中的自动刷新和保活配置。</Text>

        <BlurView intensity={20} tint="dark" style={styles.glassCard}>
          <View style={styles.cardContent}>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>背景设置</Text>
              <Text style={styles.cardSubtitle}>
                当前背景：
                {backgroundMode === 'galaxy'
                  ? '星空特效'
                  : backgroundMode === 'rainbow_zappers'
                    ? '炫酷电光'
                    : backgroundMode === 'particle_sphere'
                      ? '粒子球体'
                      : backgroundMode === 'tunnel_animation'
                        ? '旋转隧道'
                        : backgroundMode === 'wormhole'
                          ? '时空虫洞'
                          : '纯黑背景'}
              </Text>
              <Text style={styles.cardDescription}>
                选择您喜欢的应用背景风格。
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Pressable
                onPress={() => setBackgroundMode('galaxy')}
                style={[
                  styles.modeButton,
                  backgroundMode === 'galaxy' && styles.modeButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    backgroundMode === 'galaxy' && styles.modeButtonTextActive,
                  ]}
                >
                  星空
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setBackgroundMode('rainbow_zappers')}
                style={[
                  styles.modeButton,
                  backgroundMode === 'rainbow_zappers' && styles.modeButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    backgroundMode === 'rainbow_zappers' && styles.modeButtonTextActive,
                  ]}
                >
                  电光
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setBackgroundMode('particle_sphere')}
                style={[
                  styles.modeButton,
                  backgroundMode === 'particle_sphere' && styles.modeButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    backgroundMode === 'particle_sphere' && styles.modeButtonTextActive,
                  ]}
                >
                  粒子
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setBackgroundMode('tunnel_animation')}
                style={[
                  styles.modeButton,
                  backgroundMode === 'tunnel_animation' && styles.modeButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    backgroundMode === 'tunnel_animation' && styles.modeButtonTextActive,
                  ]}
                >
                  隧道
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setBackgroundMode('wormhole')}
                style={[
                  styles.modeButton,
                  backgroundMode === 'wormhole' && styles.modeButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    backgroundMode === 'wormhole' && styles.modeButtonTextActive,
                  ]}
                >
                  虫洞
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setBackgroundMode('pure_black')}
                style={[
                  styles.modeButton,
                  backgroundMode === 'pure_black' && styles.modeButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    backgroundMode === 'pure_black' && styles.modeButtonTextActive,
                  ]}
                >
                  纯黑
                </Text>
              </Pressable>
            </View>
          </View>
        </BlurView>

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
              <Text style={styles.cardTitle}>显示歌曲封面</Text>
              <Text style={styles.cardSubtitle}>
                {showBanner ? '开启' : '关闭'}
              </Text>
              <Text style={styles.cardDescription}>
                播放时是否在中间显示歌曲的封面图片。关闭后将显示背景动画。
              </Text>
            </View>
            <Switch
              value={showBanner}
              onValueChange={setShowBanner}
              trackColor={{ true: Colors.dark.tint, false: '#5f6368' }}
            />
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
              <Text style={styles.cardTitle}>闲置自动淡出/后台</Text>
              <Text style={styles.cardSubtitle}>
                {localIdleTimeout > 0 ? `${localIdleTimeout} 秒后执行` : '已关闭'}
              </Text>
              <Text style={styles.cardDescription}>
                播放时若无操作，Web端淡出界面，Mobile端切入后台。设为 0 关闭。
              </Text>
            </View>
            <View style={{ width: 160, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {Platform.OS === 'web' ? (
                // @ts-ignore
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={localIdleTimeout}
                  onInput={(e: any) => {
                    const val = parseInt(e.target.value, 10);
                    setLocalIdleTimeout(val);
                  }}
                  onChange={(e: any) => {
                    const val = parseInt(e.target.value, 10);
                    setIdleTimeout(val);
                  }}
                  style={{
                    flex: 1,
                    accentColor: Colors.dark.tint,
                    cursor: 'pointer',
                    height: 40,
                  }}
                />
              ) : (
                <Slider
                  style={{ flex: 1, height: 40 }}
                  minimumValue={0}
                  maximumValue={60}
                  step={1}
                  value={localIdleTimeout}
                  onValueChange={setLocalIdleTimeout}
                  onSlidingComplete={setIdleTimeout}
                  minimumTrackTintColor={Colors.dark.tint}
                  maximumTrackTintColor="#5f6368"
                  thumbTintColor={Colors.dark.tint}
                />
              )}
              <Text style={{ color: '#fff', minWidth: 24, textAlign: 'right', fontSize: 12 }}>{localIdleTimeout}s</Text>
            </View>
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
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modeButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: '#fff',
  },
  modeButtonText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: '#fff',
  },
});
