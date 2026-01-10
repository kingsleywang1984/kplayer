import { ScrollView, StyleSheet, Switch, Text, View, Pressable, Platform } from 'react-native';
import Slider from '@react-native-community/slider';
import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import axios from 'axios';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';

import { Colors, TextColors, SurfaceColors, BorderColors, StatusColors, Spacing, BorderRadius } from '@/constants/theme';
import { SETTINGS_DEFAULTS, useSettings } from '@/context/settings-context';
import { useIdle } from '@/context/idle-context';
import { AppBackground } from '@/components/AppBackground';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { YouTubeLoginModal } from '@/components/YouTubeLoginModal';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');

type GatewayStatus = 'checking' | 'online' | 'offline';

type YouTubeCookiesStatus = {
  hasCookies: boolean;
  lastUpdated?: string;
  ageHours?: number;
  message: string;
};

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
    showDebugConsole,
    setShowDebugConsole,
  } = useSettings();
  const { isIdleShared } = useIdle();

  // Wrapper to reset idle state when changing background mode
  const handleBackgroundModeChange = (mode: typeof backgroundMode) => {
    setBackgroundMode(mode);
    // Reset idle state to ensure tab bar is visible when switching backgrounds
    isIdleShared.value = 0;
  };
  const isWeb = Platform.OS === 'web';
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('checking');
  const [localIdleTimeout, setLocalIdleTimeout] = useState(idleTimeout);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [youtubeCookiesStatus, setYoutubeCookiesStatus] = useState<YouTubeCookiesStatus | null>(null);
  const [showYouTubeLogin, setShowYouTubeLogin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const rotation = useSharedValue(0);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  useEffect(() => {
    setLocalIdleTimeout(idleTimeout);
  }, [idleTimeout]);

  const pingGateway = async () => {
    if (!STREAM_BASE_URL) {
      setGatewayStatus('offline');
      return;
    }

    setGatewayStatus('checking');
    setIsRefreshing(true);

    // Start rotation animation
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1, // infinite
      false
    );

    try {
      await axios.get(`${STREAM_BASE_URL}/healthz`, { timeout: 4000 });
      setGatewayStatus('online');
    } catch (error) {
      console.warn('Gateway health check failed', error);
      setGatewayStatus('offline');
    } finally {
      // Stop rotation animation
      cancelAnimation(rotation);
      rotation.value = 0;
      setIsRefreshing(false);
    }
  };

  const checkYouTubeCookiesStatus = async () => {
    if (!STREAM_BASE_URL) {
      return;
    }

    try {
      const response = await axios.get(`${STREAM_BASE_URL}/api/youtube-cookies/status`);
      setYoutubeCookiesStatus(response.data);
    } catch (error) {
      console.warn('Failed to check YouTube cookies status', error);
      setYoutubeCookiesStatus({
        hasCookies: false,
        message: 'Failed to check status'
      });
    }
  };

  const logoutFromYouTube = async () => {
    if (!STREAM_BASE_URL || isLoggingOut) {
      return;
    }

    try {
      setIsLoggingOut(true);
      await axios.delete(`${STREAM_BASE_URL}/api/youtube-cookies`);
      await checkYouTubeCookiesStatus();
    } catch (error) {
      console.warn('Failed to logout from YouTube', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  useEffect(() => {
    pingGateway();
    checkYouTubeCookiesStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run only on mount
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
                onPress={() => handleBackgroundModeChange('galaxy')}
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
                onPress={() => handleBackgroundModeChange('rainbow_zappers')}
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
                onPress={() => handleBackgroundModeChange('particle_sphere')}
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
                onPress={() => handleBackgroundModeChange('tunnel_animation')}
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
                onPress={() => handleBackgroundModeChange('wormhole')}
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
                onPress={() => handleBackgroundModeChange('pure_black')}
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
            <Pressable
              onPress={pingGateway}
              disabled={isRefreshing}
              style={[
                styles.refreshButton,
                isRefreshing && styles.refreshButtonDisabled,
              ]}
            >
              <Animated.View style={animatedIconStyle}>
                <IconSymbol
                  name="arrow.clockwise"
                  size={20}
                  color={isRefreshing ? TextColors.muted : TextColors.primary}
                />
              </Animated.View>
            </Pressable>
          </View>
        </BlurView>

        <BlurView intensity={20} tint="dark" style={styles.glassCard}>
          <View style={styles.cardContent}>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>YouTube 登录</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
                <View
                  style={[
                    styles.statusDot,
                    youtubeCookiesStatus?.hasCookies ? styles.online : styles.offline,
                  ]}
                />
                <Text style={styles.cardSubtitle}>
                  {youtubeCookiesStatus?.hasCookies ? '已登录' : '未登录'}
                </Text>
                {!isWeb && !youtubeCookiesStatus?.hasCookies && (
                  <Pressable
                    onPress={() => setShowYouTubeLogin(true)}
                    disabled={isLoggingOut}
                    style={[styles.logoutTextButton, isLoggingOut && styles.logoutDisabled]}
                  >
                    <Text style={styles.logoutText}>登录</Text>
                  </Pressable>
                )}
                {!isWeb && youtubeCookiesStatus?.hasCookies && (
                  <Pressable
                    onPress={logoutFromYouTube}
                    disabled={isLoggingOut}
                    style={[styles.logoutTextButton, isLoggingOut && styles.logoutDisabled]}
                  >
                    <Text style={styles.logoutText}>登出</Text>
                  </Pressable>
                )}
              </View>
              {youtubeCookiesStatus?.lastUpdated && (
                <Text style={[styles.cardDescription, { fontSize: 12, marginTop: 4 }]}>
                  更新于: {new Date(youtubeCookiesStatus.lastUpdated).toLocaleString('zh-CN')}
                  {youtubeCookiesStatus.ageHours !== undefined && ` (${youtubeCookiesStatus.ageHours}小时前)`}
                </Text>
              )}
              <Text style={styles.cardDescription}>
                {isWeb && !youtubeCookiesStatus?.hasCookies
                  ? '请在移动端登录后点击刷新查看状态。'
                  : youtubeCookiesStatus?.message || '用于确保 YouTube 流畅播放。'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => {
                  if (isWeb) {
                    checkYouTubeCookiesStatus();
                    return;
                  }
                  checkYouTubeCookiesStatus();
                }}
                disabled={isLoggingOut}
                style={[styles.refreshButton, isLoggingOut && styles.refreshButtonDisabled]}
              >
                <IconSymbol
                  name="arrow.clockwise"
                  size={20}
                  color={TextColors.primary}
                />
              </Pressable>
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
              <Text style={styles.cardTitle}>显示 Debug Console</Text>
              <Text style={styles.cardSubtitle}>
                {showDebugConsole ? '开启' : '关闭'}
              </Text>
              <Text style={styles.cardDescription}>
                是否显示调试控制台，用于开发和调试。
              </Text>
            </View>
            <Switch
              value={showDebugConsole}
              onValueChange={setShowDebugConsole}
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
              <Text style={{ color: TextColors.primary, minWidth: 24, textAlign: 'right', fontSize: 12 }}>{localIdleTimeout}s</Text>
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
      <YouTubeLoginModal
        visible={!isWeb && showYouTubeLogin}
        onDismiss={() => {
          setShowYouTubeLogin(false);
          // Reset idle state to ensure tab bar is visible when returning from modal
          isIdleShared.value = 0;
        }}
        onSuccess={() => {
          checkYouTubeCookiesStatus();
        }}
      />
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
    color: TextColors.primary,
    fontSize: 24,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtitle: {
    color: TextColors.secondary,
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  glassCard: {
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BorderColors.subtle,
    backgroundColor: SurfaceColors.card,
  },
  cardContent: {
    padding: Spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardText: {
    flex: 1,
    marginRight: Spacing.md,
  },
  cardTitle: {
    color: TextColors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: TextColors.secondary,
    marginTop: 4,
  },
  cardDescription: {
    color: TextColors.tertiary,
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
    backgroundColor: StatusColors.success,
  },
  offline: {
    backgroundColor: StatusColors.error,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    backgroundColor: SurfaceColors.hover,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modeButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: BorderColors.active,
  },
  modeButtonText: {
    color: TextColors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: TextColors.primary,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: SurfaceColors.hover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonDisabled: {
    opacity: 0.7,
  },
  loginButton: {
    backgroundColor: Colors.dark.tint,
  },
  logoutTextButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: 999,
    minHeight: 28,
    justifyContent: 'center',
  },
  logoutText: {
    color: TextColors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  logoutDisabled: {
    opacity: 0.6,
  },
});
