import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  Platform,
  FlatList,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Audio, AVPlaybackStatus } from 'expo-av';
import axios from 'axios';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { IconButton, Text, Button, Card, useTheme, ActivityIndicator as PaperActivityIndicator, TextInput } from 'react-native-paper';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, Easing, withRepeat } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NestableDraggableFlatList, NestableScrollContainer, ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSettings } from '@/context/settings-context';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');
const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;
const TRACK_ORDER_KEY = 'kplayer_track_order';

type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

type GatewayStatus = 'checking' | 'online' | 'offline';

type TrackMetadata = {
  videoId: string;
  title: string;
  author?: string;
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
  createdAt?: string;
};

type GroupMetadata = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt?: string;
  updatedAt?: string;
};

type PlaybackOptions = {
  fromQueue?: boolean;
};

type YouTubeSearchResult = {
  videoId: string;
  title: string;
  channelTitle?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
};

const PLAYER_STATE_COPY: Record<PlayerState, string> = {
  idle: '待命',
  loading: '缓冲中',
  playing: '播放中',
  paused: '已暂停',
  error: '错误'
};

const formatTime = (value: number) => {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return '--:--';
  }
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const formatDuration = (seconds?: number | null) => {
  if (!seconds && seconds !== 0) {
    return '--:--';
  }
  return formatTime((seconds ?? 0) * 1000);
};

const extractVideoId = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  const regexes = [
    /[?&]v=([a-zA-Z0-9_-]{11})/, // watch URLs
    /youtu\.be\/([a-zA-Z0-9_-]{11})/, // share links
    /shorts\/([a-zA-Z0-9_-]{11})/ // shorts links
  ];

  for (const regex of regexes) {
    const match = trimmed.match(regex);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
};

import { AppBackground } from '@/components/AppBackground';
import { BlurView } from 'expo-blur';

export default function HomeScreen() {
  const { autoRefreshEnabled, keepAliveEnabled } = useSettings();
  const [youtubeInput, setYoutubeInput] = useState('');
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('checking');
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [groupLoopEnabled, setGroupLoopEnabled] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [tracks, setTracks] = useState<TrackMetadata[]>([]);
  const [groups, setGroups] = useState<GroupMetadata[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const queueStateRef = useRef<{ queue: string[]; loop: boolean; index: number; groupId: string | null }>({
    queue: [],
    loop: false,
    index: 0,
    groupId: null,
  });
  const initiatePlaybackRef = useRef<((videoId: string, options?: PlaybackOptions) => Promise<void>) | null>(null);

  const autoPlayLibraryTrack = useCallback(
    (previousVideoId?: string | null) => {
      if (loopEnabled || queueStateRef.current.queue.length) {
        return false;
      }

      if (!tracks.length) {
        return false;
      }

      const currentIndex = previousVideoId
        ? tracks.findIndex((track) => track.videoId === previousVideoId)
        : -1;
      const nextIndex = (currentIndex + 1) % tracks.length;
      const nextTrack = tracks[nextIndex];
      if (!nextTrack) {
        return false;
      }

      const initiator = initiatePlaybackRef.current;
      if (!initiator) {
        return false;
      }

      initiator(nextTrack.videoId).catch((error) =>
        console.warn('Auto library playback failed', error)
      );
      return true;
    },
    [loopEnabled, tracks]
  );

  const theme = useTheme();
  const scale = useSharedValue(0.8);
  const rippleOpacity = useSharedValue(0);
  const rippleScale = useSharedValue(1);

  const animatedImageStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const rippleStyle = useAnimatedStyle(() => {
    return {
      opacity: rippleOpacity.value,
      transform: [{ scale: rippleScale.value }],
    };
  });

  useEffect(() => {
    if (playerState === 'playing') {
      scale.value = withSpring(1, { damping: 10, stiffness: 100 });
      rippleOpacity.value = withTiming(0);
    } else if (playerState === 'loading') {
      scale.value = withTiming(0.9, { duration: 500, easing: Easing.inOut(Easing.quad) });
      rippleOpacity.value = 1;
      rippleScale.value = withRepeat(
        withTiming(1.5, { duration: 1500, easing: Easing.out(Easing.quad) }),
        -1,
        false
      );
      rippleOpacity.value = withRepeat(
        withTiming(0, { duration: 1500, easing: Easing.out(Easing.quad) }),
        -1,
        false
      );
    } else {
      scale.value = withTiming(0.8, { duration: 300, easing: Easing.out(Easing.quad) });
      rippleOpacity.value = withTiming(0);
    }
  }, [playerState]);

  const parsedVideoId = useMemo(() => extractVideoId(youtubeInput), [youtubeInput]);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true
    }).catch((error) => {
      console.warn('Failed to configure Audio mode', error);
    });

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setGatewayStatus('checking');

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
  }, [STREAM_BASE_URL]);

  const fetchTracks = useCallback(async () => {
    if (!STREAM_BASE_URL) {
      return;
    }
    setTracksLoading(true);
    try {
      const response = await axios.get(`${STREAM_BASE_URL}/tracks`);
      const fetchedTracks: TrackMetadata[] = response.data?.tracks ?? [];

      const savedOrderString = await AsyncStorage.getItem(TRACK_ORDER_KEY);
      if (savedOrderString) {
        try {
          const savedOrder: string[] = JSON.parse(savedOrderString);
          const orderedTracks: TrackMetadata[] = [];
          const remainingTracks = [...fetchedTracks];

          savedOrder.forEach(id => {
            const index = remainingTracks.findIndex(t => t.videoId === id);
            if (index !== -1) {
              orderedTracks.push(remainingTracks[index]);
              remainingTracks.splice(index, 1);
            }
          });

          setTracks([...orderedTracks, ...remainingTracks]);
        } catch (e) {
          console.warn('Failed to parse saved track order', e);
          setTracks(fetchedTracks);
        }
      } else {
        setTracks(fetchedTracks);
      }
    } catch (error) {
      console.warn('Failed to fetch track metadata', error);
    } finally {
      setTracksLoading(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    if (!STREAM_BASE_URL) {
      return;
    }
    setGroupsLoading(true);
    try {
      const response = await axios.get(`${STREAM_BASE_URL}/groups`);
      setGroups(response.data?.groups ?? []);
    } catch (error) {
      console.warn('Failed to fetch groups', error);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gatewayStatus === 'online') {
      fetchTracks();
      fetchGroups();
    }
  }, [gatewayStatus, fetchTracks, fetchGroups]);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }

    const refreshAll = () => {
      if (gatewayStatus === 'online') {
        fetchTracks();
        fetchGroups();
      }
    };

    refreshAll();
    const interval = setInterval(refreshAll, 30000);
    return () => clearInterval(interval);
  }, [gatewayStatus, fetchTracks, fetchGroups, autoRefreshEnabled]);

  useEffect(() => {
    if (!STREAM_BASE_URL || !keepAliveEnabled) {
      return;
    }

    const pingHealth = () => {
      axios
        .get(`${STREAM_BASE_URL}/healthz`, { timeout: 4000 })
        .catch((error) => console.warn('Keep-alive ping failed', error));
    };

    pingHealth();
    const keepAliveInterval = setInterval(pingHealth, KEEP_ALIVE_INTERVAL_MS);
    return () => clearInterval(keepAliveInterval);
  }, [STREAM_BASE_URL, keepAliveEnabled]);

  useEffect(() => {
    if (!isSeeking) {
      setSeekValue(position);
    }
  }, [position, isSeeking]);

  useEffect(() => {
    if (duration <= 0) {
      return;
    }
    setSeekValue((prev) => Math.min(prev, duration));
  }, [duration]);

  useEffect(() => {
    if (!currentTrackId) {
      return;
    }
    const metadata = tracks.find((track) => track.videoId === currentTrackId);
    if (metadata?.durationSeconds) {
      setDuration(metadata.durationSeconds * 1000);
    }
  }, [tracks, currentTrackId]);

  const clearQueue = useCallback(() => {
    queueStateRef.current = { queue: [], loop: false, index: 0, groupId: null };
    setActiveGroupId(null);
  }, []);

  const unloadCurrentSound = useCallback(async () => {
    if (!soundRef.current) {
      return;
    }

    try {
      await soundRef.current.stopAsync();
    } catch (error) {
      console.warn('Unable to stop current sound cleanly', error);
    }

    try {
      await soundRef.current.unloadAsync();
    } catch (error) {
      console.warn('Unable to unload current sound', error);
    }

    soundRef.current = null;
  }, []);

  const stopPlayback = useCallback(async () => {
    await unloadCurrentSound();
    clearQueue();
    setPlayerState('idle');
    setPosition(0);
    setDuration(0);
    setMessage(null);
    setCurrentTrackId(null);
    setSeekValue(0);
    setIsSeeking(false);
  }, [clearQueue, unloadCurrentSound]);

  const playNextInQueue = useCallback(async () => {
    const { queue, index, loop } = queueStateRef.current;
    if (!queue.length) {
      clearQueue();
      setPlayerState('idle');
      return;
    }

    let nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      if (loop && queue.length > 0) {
        nextIndex = 0;
      } else {
        clearQueue();
        setPlayerState('idle');
        setMessage('分组播放结束');
        return;
      }
    }

    queueStateRef.current = {
      ...queueStateRef.current,
      index: nextIndex,
    };

    const initiator = initiatePlaybackRef.current;
    if (initiator) {
      await initiator(queue[nextIndex], { fromQueue: true });
    }
  }, [clearQueue]);

  const handlePause = useCallback(async () => {
    if (!soundRef.current) {
      return;
    }

    try {
      await soundRef.current.pauseAsync();
      setPlayerState('paused');
    } catch (error) {
      console.warn('Unable to pause playback', error);
    }
  }, []);

  const handleResume = useCallback(async () => {
    if (!soundRef.current) {
      return;
    }

    try {
      await soundRef.current.playAsync();
      setPlayerState('playing');
      setMessage(null);
    } catch (error) {
      console.warn('Unable to resume playback', error);
    }
  }, []);

  const initiatePlayback = useCallback(
    async (videoId: string, options?: PlaybackOptions) => {
      if (!videoId) {
        setMessage('请选择要播放的歌曲或输入链接');
        return;
      }

      if (!STREAM_BASE_URL) {
        setMessage('未设置后端地址，请在 .env 中配置 EXPO_PUBLIC_STREAM_BASE_URL。');
        return;
      }

      if (soundRef.current) {
        if (options?.fromQueue) {
          await unloadCurrentSound();
        } else {
          await stopPlayback();
        }
      }

      if (!options?.fromQueue) {
        clearQueue();
      }

      setPlayerState('loading');
      setMessage(null);

      if (!options?.fromQueue) {
        Keyboard.dismiss();
      }

      const metadata = tracks.find((track) => track.videoId === videoId);
      if (metadata?.durationSeconds) {
        setDuration(metadata.durationSeconds * 1000);
      } else {
        setDuration(0);
      }
      setPosition(0);
      setSeekValue(0);
      setIsSeeking(false);

      try {
        const source = {
          uri: `${STREAM_BASE_URL}/stream/${encodeURIComponent(videoId)}`,
        };

        const { sound } = await Audio.Sound.createAsync(
          source,
          { shouldPlay: true, isLooping: !options?.fromQueue && loopEnabled },
          (status: AVPlaybackStatus) => {
            if (!status.isLoaded) {
              if ('error' in status && status.error) {
                setPlayerState('error');
                setMessage(`播放失败: ${status.error}`);
              }
              return;
            }

            setPosition(status.positionMillis ?? 0);

            if (typeof status.durationMillis === 'number' && Number.isFinite(status.durationMillis)) {
              setDuration(status.durationMillis);
            }

            if (status.didJustFinish && !status.isLooping) {
              if (queueStateRef.current.queue.length) {
                playNextInQueue();
                return;
              }
              const handled = autoPlayLibraryTrack(videoId);
              if (handled) {
                return;
              }
              setPlayerState('idle');
              setMessage('播放完成');
              setPosition(0);
              setSeekValue(0);
              setIsSeeking(false);
              clearQueue();
            } else if (status.isPlaying) {
              setPlayerState('playing');
              setMessage(null);
            } else {
              setPlayerState('paused');
            }
          }
        );

        soundRef.current = sound;
        setCurrentTrackId(videoId);
      } catch (error) {
        console.error('Unable to start playback', error);
        setPlayerState('error');
        setMessage('播放失败，请稍后重试。');
      }
    },
    [
      STREAM_BASE_URL,
      loopEnabled,
      stopPlayback,
      unloadCurrentSound,
      clearQueue,
      playNextInQueue,
      tracks,
      autoPlayLibraryTrack,
    ]
  );

  useEffect(() => {
    initiatePlaybackRef.current = initiatePlayback;
  }, [initiatePlayback]);

  const handlePlay = async () => {
    if (!parsedVideoId) {
      setMessage('请输入有效的 YouTube 链接或视频 ID。');
      return;
    }

    await initiatePlayback(parsedVideoId);
  };

  const handleLoopToggle = async (value: boolean) => {
    setLoopEnabled(value);
    if (soundRef.current) {
      try {
        await soundRef.current.setIsLoopingAsync(value);
      } catch (error) {
        console.warn('Unable to toggle loop', error);
      }
    }
  };

  const toggleTrackSelection = (videoId: string) => {
    setSelectedTrackIds((prev) =>
      prev.includes(videoId) ? prev.filter((id) => id !== videoId) : [...prev, videoId]
    );
  };

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) {
      setMessage('请填写分组名称');
      return;
    }

    if (!selectedTrackIds.length) {
      setMessage('请至少选择一首歌曲用于分组');
      return;
    }

    if (!STREAM_BASE_URL) {
      setMessage('未设置后端地址，无法创建分组');
      return;
    }

    try {
      await axios.post(`${STREAM_BASE_URL}/groups`, {
        name: newGroupName.trim(),
        trackIds: selectedTrackIds,
      });
      setNewGroupName('');
      setSelectedTrackIds([]);
      setMessage('分组已创建');
      fetchGroups();
      fetchTracks();
    } catch (error) {
      console.error('Failed to create group', error);
      setMessage('创建分组失败，请稍后重试');
    }
  }, [newGroupName, selectedTrackIds, fetchGroups, fetchTracks]);

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      if (!STREAM_BASE_URL) {
        setMessage('未设置后端地址，无法删除分组');
        return;
      }

      try {
        await axios.delete(`${STREAM_BASE_URL}/groups/${groupId}`);
        if (queueStateRef.current.groupId === groupId) {
          await stopPlayback();
        }
        fetchGroups();
      } catch (error) {
        console.error('Failed to delete group', error);
        setMessage('删除分组失败');
      }
    },
    [fetchGroups, stopPlayback]
  );

  const handleTrackPlay = useCallback(
    async (videoId: string) => {
      setYoutubeInput(`https://www.youtube.com/watch?v=${videoId}`);
      await initiatePlayback(videoId);
    },
    [initiatePlayback]
  );

  const handleSearch = useCallback(async (query: string) => {
    if (!STREAM_BASE_URL) {
      setMessage('未设置后端地址，无法搜索 YouTube');
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setSearchError('请输入要搜索的歌曲名称或歌词');
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const response = await axios.get(`${STREAM_BASE_URL}/search`, {
        params: { q: trimmed },
      });
      const results = response.data?.results ?? [];
      setSearchResults(results);
      if (!results.length) {
        setSearchError('未找到匹配的歌曲');
      }
    } catch (error) {
      console.error('搜索 YouTube 失败', error);
      setSearchError('搜索失败，请稍后再试');
    } finally {
      setSearchLoading(false);
    }
  }, [STREAM_BASE_URL]);

  const handlePrimaryAction = useCallback(async () => {
    const trimmed = youtubeInput.trim();
    if (!trimmed) {
      setMessage('请输入 YouTube 链接或搜索内容');
      return;
    }

    if (parsedVideoId) {
      await initiatePlayback(parsedVideoId);
      return;
    }

    await handleSearch(trimmed);
  }, [youtubeInput, parsedVideoId, initiatePlayback, handleSearch]);

  const handleSearchResultSelect = useCallback(
    async (result: YouTubeSearchResult) => {
      if (soundRef.current) {
        await stopPlayback();
      }

      try {
        await initiatePlayback(result.videoId);
        setMessage(`正在播放：${result.title}`);
        setYoutubeInput(`https://www.youtube.com/watch?v=${result.videoId}`);
        setSearchResults([]);
        setSearchError(null);
      } catch (error) {
        console.error('Unable to play selected search result', error);
      }
    },
    [initiatePlayback, stopPlayback]
  );

  const handleDeleteTrack = useCallback(
    async (videoId: string) => {
      if (!STREAM_BASE_URL) {
        setMessage('未设置后端地址，无法删除曲目');
        return;
      }

      try {
        await axios.delete(`${STREAM_BASE_URL}/tracks/${videoId}`);
        setSelectedTrackIds((prev) => prev.filter((id) => id !== videoId));
        if (currentTrackId === videoId) {
          await stopPlayback();
        }
        setMessage('曲目已删除');
        fetchTracks();
        fetchGroups();
      } catch (error) {
        console.error('Failed to delete track', error);
        setMessage('删除曲目失败');
      }
    },
    [STREAM_BASE_URL, fetchGroups, fetchTracks, stopPlayback, currentTrackId]
  );

  const handleGroupPlayback = useCallback(
    async (groupId: string) => {
      const group = groups.find((item) => item.id === groupId);
      if (!group) {
        setMessage('未找到该分组');
        return;
      }

      if (!group.trackIds?.length) {
        setMessage('该分组暂无歌曲');
        return;
      }

      queueStateRef.current = {
        queue: group.trackIds,
        loop: groupLoopEnabled,
        index: 0,
        groupId: group.id,
      };
      setActiveGroupId(group.id);
      await initiatePlayback(group.trackIds[0], { fromQueue: true });
    },
    [groups, groupLoopEnabled, initiatePlayback]
  );

  const sliderMax = duration > 0 ? duration : 1;
  const displayedPosition = isSeeking ? seekValue : position;
  const sliderValue = duration > 0 ? Math.min(displayedPosition, sliderMax) : 0;

  const currentTrack = tracks.find((t) => t.videoId === currentTrackId);

  const ScrollComponent = (Platform.OS === 'web' ? ScrollView : NestableScrollContainer) as React.ComponentType<any>;

  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      <AppBackground style={{ position: 'absolute', width: '100%', height: '100%' }} />
      <View style={styles.container}>
        <ScrollComponent style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Text variant="headlineMedium" style={[styles.heading, { color: 'white' }]}>
            Kingsley Player
          </Text>

          <BlurView intensity={20} tint="dark" style={styles.glassCard}>
            <View style={styles.cardContent}>
              <TextInput
                mode="outlined"
                label="YouTube 链接或关键词"
                placeholder="粘贴链接或输入歌曲名称/歌词"
                value={youtubeInput}
                onChangeText={(value) => {
                  setYoutubeInput(value);
                  if (!value.trim()) {
                    setSearchError(null);
                    setSearchResults([]);
                  }
                }}
                onSubmitEditing={() => {
                  if (!STREAM_BASE_URL || searchLoading) {
                    return;
                  }
                  handlePrimaryAction();
                }}
                returnKeyType={parsedVideoId ? 'go' : 'search'}
                style={styles.input}
                textColor="white"
                theme={{
                  colors: {
                    onSurfaceVariant: 'rgba(255, 255, 255, 0.7)',
                    primary: 'white',
                    background: '#1e1e28',
                  },
                }}
                right={
                  <TextInput.Icon
                    icon={parsedVideoId ? 'play' : 'magnify'}
                    onPress={() => {
                      if (!STREAM_BASE_URL || searchLoading) {
                        return;
                      }
                      handlePrimaryAction();
                    }}
                    disabled={!STREAM_BASE_URL || searchLoading}
                    forceTextInputFocus={false}
                  />
                }
              />
              {parsedVideoId && (
                <Text variant="bodySmall" style={{ color: theme.colors.primary }}>
                  解析到的视频 ID：{parsedVideoId}
                </Text>
              )}
              {searchError ? (
                <Text variant="bodySmall" style={[styles.searchErrorText, { color: theme.colors.error }]}>
                  {searchError}
                </Text>
              ) : null}
              {searchResults.length > 0 && (
                <View style={styles.searchResultsContainer}>
                  {searchResults.map((result) => (
                    <Pressable
                      key={result.videoId}
                      style={[styles.searchResultCard, { borderColor: theme.colors.surfaceVariant }]}
                      onPress={() => handleSearchResultSelect(result)}
                    >
                      <Image
                        source={
                          result.thumbnailUrl
                            ? { uri: result.thumbnailUrl }
                            : require('@/assets/images/react-logo.png')
                        }
                        style={styles.searchThumbnail}
                        contentFit="cover"
                      />
                      <View style={styles.searchInfo}>
                        <Text variant="titleSmall" numberOfLines={1}>
                          {result.title}
                        </Text>
                        <Text variant="bodySmall" numberOfLines={1}>
                          {result.channelTitle ?? '未知频道'}
                        </Text>
                      </View>
                      <Button mode="contained" onPress={() => handleSearchResultSelect(result)}>
                        播放
                      </Button>
                    </Pressable>
                  ))}
                </View>
              )}

              <View style={styles.albumContainer}>
                {playerState === 'loading' && (
                  <Animated.View style={[styles.ripple, rippleStyle]} />
                )}
                {currentTrack ? (
                  currentTrack.thumbnailUrl ? (
                    <Animated.Image
                      source={{ uri: currentTrack.thumbnailUrl }}
                      style={[styles.albumArt, animatedImageStyle]}
                    />
                  ) : (
                    <View style={[styles.albumArt, { backgroundColor: 'rgba(255, 255, 255, 0.1)' }]} />
                  )
                ) : (
                  <View style={[styles.albumArt, { overflow: 'hidden', backgroundColor: 'black' }]}>
                    <AppBackground style={{ width: '100%', height: '100%' }} />
                  </View>
                )}
              </View>

              <View style={styles.trackInfoContainer}>
                <Text variant="titleMedium" numberOfLines={1} style={{ textAlign: 'center' }}>
                  {currentTrack?.title || 'No Track Playing'}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {currentTrack?.author || 'Unknown Artist'}
                </Text>
              </View>

              <View style={styles.controls}>
                <IconButton
                  icon="play"
                  mode="contained"
                  containerColor={theme.colors.primary}
                  iconColor={theme.colors.onPrimary}
                  size={40}
                  onPress={playerState === 'paused' ? handleResume : handlePlay}
                  disabled={!parsedVideoId || playerState === 'loading'}
                />
                <IconButton
                  icon="pause"
                  mode="contained-tonal"
                  size={32}
                  onPress={handlePause}
                  disabled={playerState !== 'playing'}
                />
                <IconButton
                  icon="stop"
                  mode="outlined"
                  size={32}
                  onPress={stopPlayback}
                  disabled={playerState === 'idle'}
                />
              </View>

              <Text variant="labelSmall" style={{ textAlign: 'center', marginTop: 10 }}>
                {PLAYER_STATE_COPY[playerState]}
              </Text>

              <View style={styles.sliderContainer}>
                <Slider
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={sliderMax}
                  value={sliderValue}
                  minimumTrackTintColor={theme.colors.primary}
                  maximumTrackTintColor={theme.colors.surfaceVariant}
                  thumbTintColor={theme.colors.primary}
                  disabled={duration <= 0}
                  onSlidingStart={(value) => {
                    setIsSeeking(true);
                    setSeekValue(value ?? 0);
                  }}
                  onValueChange={(value) => {
                    if (!isSeeking) {
                      setIsSeeking(true);
                    }
                    setSeekValue(value ?? 0);
                  }}
                  onSlidingComplete={async (value) => {
                    const nextValue = value ?? 0;
                    setIsSeeking(false);
                    setSeekValue(nextValue);
                    setPosition(nextValue);
                    if (soundRef.current) {
                      try {
                        await soundRef.current.setPositionAsync(nextValue);
                      } catch (error) {
                        console.warn('Unable to seek playback', error);
                      }
                    }
                  }}
                />
                <View style={styles.timeRow}>
                  <Text variant="labelSmall">{formatTime(displayedPosition)}</Text>
                  <Text variant="labelSmall">{duration > 0 ? formatTime(duration) : '--:--'}</Text>
                </View>
              </View>

              <View style={styles.loopRow}>
                <Text style={{ color: theme.colors.onSurface }}>Single Loop</Text>
                <Switch
                  value={loopEnabled}
                  onValueChange={handleLoopToggle}
                  trackColor={{ false: '#767577', true: theme.colors.primary }}
                  thumbColor={loopEnabled ? theme.colors.onPrimary : '#f4f3f4'}
                />
              </View>
            </View>
          </BlurView>

          <BlurView intensity={20} tint="dark" style={styles.glassCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{`My Tracks (${tracks.length})`}</Text>
              <IconButton icon="refresh" onPress={fetchTracks} iconColor={theme.colors.onSurface} />
            </View>
            <View style={styles.cardContent}>
              {tracksLoading ? (
                <PaperActivityIndicator />
              ) : tracks.length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant }}>No cached tracks.</Text>
              ) : (
                Platform.OS === 'web' ? (
                  <View style={{ height: 400 }}>
                    <FlatList
                      data={tracks}
                      keyExtractor={(item) => item.videoId}
                      renderItem={({ item }) => {
                        const selected = selectedTrackIds.includes(item.videoId);
                        const playing = currentTrackId === item.videoId;
                        return (
                          <Card mode="contained" style={[styles.trackItem, playing && { borderColor: theme.colors.primary, borderWidth: 1 }]}>
                            <Card.Content style={styles.trackItemContent}>
                              <View style={{ flex: 1 }}>
                                <Text variant="titleSmall" numberOfLines={1} style={{ color: 'white' }}>{item.title}</Text>
                                <Text variant="bodySmall" style={{ color: 'rgba(255,255,255,0.7)' }}>{item.author} · {formatDuration(item.durationSeconds)}</Text>
                              </View>
                              <View style={styles.trackActions}>
                                <IconButton icon="play-circle" size={20} iconColor="white" onPress={() => handleTrackPlay(item.videoId)} />
                                <IconButton icon={selected ? "check-circle" : "circle-outline"} size={20} iconColor="white" onPress={() => toggleTrackSelection(item.videoId)} />
                                <IconButton icon="delete" size={20} iconColor="white" onPress={() => handleDeleteTrack(item.videoId)} />
                              </View>
                            </Card.Content>
                          </Card>
                        );
                      }}
                    />
                  </View>
                ) : (
                  <NestableDraggableFlatList
                    data={tracks}
                    style={{ maxHeight: 600 }}
                    onDragEnd={async ({ data }) => {
                      setTracks(data);
                      try {
                        const order = data.map(t => t.videoId);
                        await AsyncStorage.setItem(TRACK_ORDER_KEY, JSON.stringify(order));
                      } catch (e) {
                        console.warn('Failed to save track order', e);
                      }
                    }}
                    keyExtractor={(item) => item.videoId}
                    renderItem={({ item, drag, isActive }: RenderItemParams<TrackMetadata>) => {
                      const selected = selectedTrackIds.includes(item.videoId);
                      const playing = currentTrackId === item.videoId;
                      return (
                        <ScaleDecorator>
                          <Pressable onLongPress={drag} disabled={isActive} delayLongPress={200}>
                            <Card mode="contained" style={[styles.trackItem, playing && { borderColor: theme.colors.primary, borderWidth: 1 }, isActive && { opacity: 0.7, backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                              <Card.Content style={styles.trackItemContent}>
                                <View style={{ flex: 1 }}>
                                  <Text variant="titleSmall" numberOfLines={1} style={{ color: 'white' }}>{item.title}</Text>
                                  <Text variant="bodySmall" style={{ color: 'rgba(255,255,255,0.7)' }}>{item.author} · {formatDuration(item.durationSeconds)}</Text>
                                </View>
                                <View style={styles.trackActions}>
                                  <IconButton icon="play-circle" size={20} iconColor="white" onPress={() => handleTrackPlay(item.videoId)} />
                                  <IconButton icon={selected ? "check-circle" : "circle-outline"} size={20} iconColor="white" onPress={() => toggleTrackSelection(item.videoId)} />
                                  <IconButton icon="delete" size={20} iconColor="white" onPress={() => handleDeleteTrack(item.videoId)} />
                                  <Pressable onLongPress={drag} delayLongPress={0} disabled={isActive} hitSlop={20} style={{ padding: 8 }}>
                                    <MaterialCommunityIcons name="drag" size={24} color="rgba(255,255,255,0.5)" />
                                  </Pressable>
                                </View>
                              </Card.Content>
                            </Card>
                          </Pressable>
                        </ScaleDecorator>
                      );
                    }}
                  />
                )
              )}
              <Text style={styles.hint}>Selected: {selectedTrackIds.length}</Text>
            </View>
          </BlurView>

          <BlurView intensity={20} tint="dark" style={styles.glassCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Create Group</Text>
            </View>
            <View style={styles.cardContent}>
              <TextInput
                mode="outlined"
                label="Group Name"
                value={newGroupName}
                onChangeText={setNewGroupName}
                style={styles.input}
                textColor="white"
                theme={{
                  colors: {
                    onSurfaceVariant: 'rgba(255, 255, 255, 0.7)',
                    primary: 'white',
                    background: '#1e1e28',
                  },
                }}
              />
              <Button
                mode="contained"
                onPress={handleCreateGroup}
                disabled={!newGroupName.trim() || !selectedTrackIds.length}
                style={{ marginTop: 10 }}
              >
                Create Group
              </Button>
            </View>
          </BlurView>

          <BlurView intensity={20} tint="dark" style={styles.glassCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{`My Groups (${groups.length})`}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurface }}>Loop</Text>
                <Switch
                  value={groupLoopEnabled}
                  onValueChange={setGroupLoopEnabled}
                  trackColor={{ false: '#767577', true: theme.colors.primary }}
                  thumbColor={groupLoopEnabled ? theme.colors.onPrimary : '#f4f3f4'}
                />
              </View>
            </View>
            <View style={styles.cardContent}>
              <View style={styles.loopRow}>
                {/* Loop toggle moved to header, keeping this empty or removing if not needed, but keeping structure for now if other content exists */}
              </View>
              <ScrollView style={{ maxHeight: 450 }} nestedScrollEnabled>
                {groupsLoading ? (
                  <PaperActivityIndicator />
                ) : (
                  groups.map((group) => (
                    <Card key={group.id} mode="contained" style={[styles.groupItem, activeGroupId === group.id && { borderColor: theme.colors.primary, borderWidth: 1 }]}>
                      <Card.Content style={styles.groupItemContent}>
                        <View style={{ flex: 1 }}>
                          <Text variant="titleSmall" style={{ color: 'white' }}>{group.name}</Text>
                          <Text variant="bodySmall" style={{ color: 'rgba(255,255,255,0.7)' }}>{group.trackIds.length} tracks</Text>
                        </View>
                        <View style={styles.trackActions}>
                          <IconButton icon="play" iconColor="white" onPress={() => handleGroupPlayback(group.id)} />
                          <IconButton icon="delete" iconColor="white" onPress={() => handleDeleteGroup(group.id)} />
                        </View>
                      </Card.Content>
                    </Card>
                  ))
                )}
              </ScrollView>
            </View>
          </BlurView>
        </ScrollComponent>
      </View >
    </View >
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  heading: {
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 20, // Increased padding to prevent clipping
    paddingBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 24,
    opacity: 0.8,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  mainCard: {
    marginBottom: 20,
    elevation: 4,
  },
  sectionCard: {
    marginBottom: 16,
    elevation: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
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
  input: {
    marginBottom: 12,
    backgroundColor: '#1e1e28',
  },
  searchResultsContainer: {
    gap: 8,
    marginVertical: 8,
  },
  searchResultCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchThumbnail: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#1f1f23',
  },
  searchInfo: {
    flex: 1,
    gap: 4,
  },
  searchErrorText: {
    marginTop: 4,
  },
  albumContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  albumArt: {
    width: 280,
    height: 280,
    borderRadius: 140,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  ripple: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    zIndex: -1,
  },
  albumImage: {
    width: '100%',
    height: '100%',
  },
  glassCard: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 20,
    backgroundColor: 'rgba(30, 30, 40, 0.3)', // Reduced opacity
  },
  cardContent: {
    padding: 24,
    backgroundColor: 'transparent',
  },
  trackInfoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    marginBottom: 20,
  },
  sliderContainer: {
    marginTop: 10,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  loopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  trackList: {
    paddingBottom: 16,
  },
  trackItem: {
    marginBottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // Reduced opacity
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  trackItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
  },
  trackTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  trackArtist: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
  trackActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupItem: {
    marginBottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // Reduced opacity
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  groupItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hint: {
    marginTop: 8,
    textAlign: 'center',
    opacity: 0.6,
  },
});
