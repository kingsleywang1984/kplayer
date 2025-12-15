import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  Platform,
  FlatList,
  LogBox,
} from 'react-native';
import Slider from '@react-native-community/slider';
import TrackPlayer, {
  Capability,
  Event,
  RepeatMode,
  State,
  usePlaybackState,
  useProgress,
  useTrackPlayerEvents,
  AppKilledPlaybackBehavior,
  IOSCategory,
  IOSCategoryMode,
  IOSCategoryOptions,
} from 'react-native-track-player';
import axios from 'axios';
import { Image } from 'expo-image';
import { IconButton, Text, Button, Card, useTheme, ActivityIndicator as PaperActivityIndicator, TextInput } from 'react-native-paper';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, Easing, withRepeat } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';

import { useSettings } from '@/context/settings-context';
import { useIdle } from '@/context/idle-context';
import { TextColors, SurfaceColors, BorderColors, StatusColors, Spacing, BorderRadius } from '@/constants/theme';
import { AppBackground } from '@/components/AppBackground';
import { GroupDetailModal } from '@/components/GroupDetailModal';

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
  skipCacheCheck?: boolean;
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
  loading: '缓冲/加载中...',
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

// Suppress VirtualizedList nesting warning - safe in this context with fixed-height containers
LogBox.ignoreLogs([
  'VirtualizedLists should never be nested',
]);


export default function HomeScreen() {
  const { autoRefreshEnabled, keepAliveEnabled, showBanner, backgroundMode, idleTimeout, showDebugConsole, cachePollingInterval } = useSettings();
  const { isIdleShared } = useIdle();
  const idleTimerRef = useRef<any>(null);
  const cachingPollIntervalRef = useRef<any>(null);
  const [outerScrollEnabled, setOuterScrollEnabled] = useState(true);
  const [youtubeInput, setYoutubeInput] = useState('');

  const playbackState = usePlaybackState();
  const progress = useProgress();
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const addDebugLog = (msg: string) => {
    setDebugLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 20));
  };

  // Helper to map RNTP state to UI state
  const [isStopped, setIsStopped] = useState(false);
  const playerState = isStopped ? 'idle'
    : (playbackState.state === State.Playing) ? 'playing'
      : (playbackState.state === State.Paused || playbackState.state === State.Ready) ? 'paused'
        : (playbackState.state === State.Buffering || playbackState.state === State.Loading) ? 'loading'
          : 'idle';

  // Clean up debug logs
  // console.log(...) removed

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- only setter is used
  const [_message, setMessage] = useState<string | null>(null);
  const [cachingVideoId, setCachingVideoId] = useState<string | null>(null); // Track which video is being cached
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>('checking');
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [groupLoopEnabled, setGroupLoopEnabled] = useState(true);
  // Remove manual position/duration state, use progress hook
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

  const queueStateRef = useRef<{ queue: string[]; loop: boolean; index: number; groupId: string | null }>({
    queue: [],
    loop: false,
    index: 0,
    groupId: null,
  });
  const initiatePlaybackRef = useRef<((videoId: string, options?: PlaybackOptions) => Promise<void>) | null>(null);

  const [viewingGroup, setViewingGroup] = useState<GroupMetadata | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Animation values are stable refs
  }, [playerState]);

  // Create a ref for the latest state so callbacks don't need to depend on them causing re-renders/loop
  const stateRef = useRef({ playerState, idleTimeout });
  useEffect(() => {
    stateRef.current = { playerState, idleTimeout };
  }, [playerState, idleTimeout]);

  const startIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const { playerState, idleTimeout } = stateRef.current;

    if (idleTimeout > 0 && playerState === 'playing') {
      idleTimerRef.current = setTimeout(() => {
        isIdleShared.value = 1;
      }, idleTimeout * 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isIdleShared is a stable ref
  }, []);

  const handleActivity = useCallback(() => {
    if (isIdleShared.value === 1) {
      isIdleShared.value = 0;
    }
    startIdleTimer();
  }, [startIdleTimer, isIdleShared]);

  // Restart timer when playback state or settings change
  useEffect(() => {
    startIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [playerState, idleTimeout, startIdleTimer]);

  // Setup event listeners for Web
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    // Throttle slightly if needed, but for now direct call is fine as it just clears/sets timeout
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('click', handleActivity);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('click', handleActivity);
    };
  }, [handleActivity]);

  useEffect(() => {
    // On native, this effect is no longer primary. The BackHandler logic is tricky with shared values.
    // For now, we just keep this for reference but don't use `isIdle` state.
  }, []);

  const animatedOpacityStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isIdleShared.value === 1 ? 0 : 1, { duration: 500 }),
    };
  });

  const parsedVideoId = useMemo(() => extractVideoId(youtubeInput), [youtubeInput]);

  useEffect(() => {
    async function setup() {
      try {
        await TrackPlayer.setupPlayer({
          iosCategory: IOSCategory.Playback,
          iosCategoryMode: IOSCategoryMode.Default,
          iosCategoryOptions: [
            IOSCategoryOptions.AllowBluetooth,
            IOSCategoryOptions.DefaultToSpeaker,
            IOSCategoryOptions.InterruptSpokenAudioAndMixWithOthers
          ],
          autoHandleInterruptions: true,
          autoUpdateMetadata: true,
          waitForBuffer: true,
        });
        await TrackPlayer.updateOptions({
          capabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.Stop,
            Capability.SeekTo,
          ],
          compactCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
          ],
          progressUpdateEventInterval: 1,
        });
        setIsPlayerReady(true);
      } catch (e) {
        console.warn('TrackPlayer setup error:', e);
        // Player might be already setup if hot reloading
        setIsPlayerReady(true);
      }
    }
    setup();
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
  }, []);

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
  }, [keepAliveEnabled]);





  const clearQueue = useCallback(() => {
    queueStateRef.current = { queue: [], loop: false, index: 0, groupId: null };
    setActiveGroupId(null);
  }, []);

  const unloadCurrentSound = useCallback(async () => {
    try {
      await TrackPlayer.reset();
    } catch (error) {
      console.warn('Unable to reset player', error);
    }
  }, []);

  const stopPlayback = useCallback(async () => {
    try {
      await TrackPlayer.stop(); // Force stop state
    } catch (_) { }
    await unloadCurrentSound();
    clearQueue();
    // Do not clear currentTrackId so we stay in "Stopped" state with a selected track
    setIsStopped(true);
    setMessage(null);
    setSeekValue(0);
    setIsSeeking(false);
  }, [clearQueue, unloadCurrentSound]);

  const playNextInQueue = useCallback(async () => {
    const { queue, index, loop } = queueStateRef.current;
    if (!queue.length) {
      clearQueue();
      await TrackPlayer.reset();
      return;
    }

    let nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      if (loop && queue.length > 0) {
        nextIndex = 0;
      } else {
        clearQueue();
        await TrackPlayer.reset();
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
    try {
      await TrackPlayer.pause();
    } catch (error) {
      console.warn('Unable to pause playback', error);
    }
  }, []);

  const handleResume = useCallback(async () => {
    try {
      await TrackPlayer.play();
      setMessage(null);
    } catch (error) {
      console.warn('Unable to resume playback', error);
    }
  }, []);

  // Request stream info from Gateway - returns either R2 URL (if cached) or 202 (if caching) or error
  const requestStreamInfo = useCallback(async (videoId: string) => {
    if (!STREAM_BASE_URL) {
      throw new Error('Gateway URL not configured');
    }

    try {
      const response = await axios.get(`${STREAM_BASE_URL}/stream/${encodeURIComponent(videoId)}`);

      if (response.status === 200 && response.data.cached) {
        // Track is cached - return R2 URL
        addDebugLog(`Cache HIT for ${videoId}`);
        return { cached: true, url: response.data.url, metadata: response.data.metadata };
      }

      if (response.status === 202 || (response.data && !response.data.cached)) {
        // Track is being cached
        addDebugLog(`Cache MISS for ${videoId} - caching started`);
        return { cached: false, caching: true };
      }

      throw new Error('Unexpected response from stream endpoint');
    } catch (error: any) {
      if (error.response?.status === 202) {
        addDebugLog(`Cache MISS for ${videoId} - caching started`);
        return { cached: false, caching: true };
      }

      // Check if backend returned a caching error
      if (error.response?.status === 500 && error.response?.data?.error) {
        addDebugLog(`[ERROR] Cache failed for ${videoId}: ${error.response.data.error}`);
        return { cached: false, caching: false, error: error.response.data.error };
      }

      throw error;
    }
  }, [addDebugLog]);

  // Stop cache polling
  const stopCachePolling = useCallback(() => {
    if (cachingPollIntervalRef.current) {
      clearInterval(cachingPollIntervalRef.current);
      cachingPollIntervalRef.current = null;
    }
    setCachingVideoId(null);
  }, []);

  const initiatePlayback = useCallback(
    async (videoId: string, options?: PlaybackOptions) => {
      console.log('[initiatePlayback] Called with videoId:', videoId, 'options:', options, 'stack:', new Error().stack);
      addDebugLog(`initiatePlayback: ${videoId}`);

      if (!videoId) {
        setMessage('请选择要播放的歌曲或输入链接');
        return;
      }

      if (!STREAM_BASE_URL) {
        setMessage('未设置后端地址，请在 .env 中配置 EXPO_PUBLIC_STREAM_BASE_URL。');
        return;
      }

      if (playerState !== 'idle') {
        if (options?.fromQueue) {
          await unloadCurrentSound();
        } else {
          await stopPlayback();
        }
      }

      if (!options?.fromQueue) {
        clearQueue();
      }

      setIsStopped(false);
      setMessage(null);

      if (!options?.fromQueue) {
        Keyboard.dismiss();
      }

      setSeekValue(0);
      setIsSeeking(false);

      try {
        // First, request stream info to check if track is cached
        const streamInfo = await requestStreamInfo(videoId);

        if (!streamInfo.cached) {
          // Track is not cached - start polling for cache completion
          startCachePolling(videoId);
          return;
        }

        // Track is cached - play from R2 URL
        const metadata = tracks.find((track) => track.videoId === videoId) || streamInfo.metadata;

        await TrackPlayer.reset();
        await TrackPlayer.add({
          id: videoId,
          url: streamInfo.url, // Use R2 signed URL
          title: metadata?.title ?? videoId,
          artist: metadata?.author ?? 'Unknown',
          artwork: metadata?.thumbnailUrl ?? undefined,
          duration: metadata?.durationSeconds ?? 0,
        });

        // On mobile, we handle looping manually via PlaybackQueueEnded event (RepeatMode.Track is unreliable with streams)
        // On web, use RepeatMode.Track as it works fine
        const shouldLoop = !options?.fromQueue && loopEnabled;
        const repeatMode = Platform.OS === 'web' && shouldLoop ? RepeatMode.Track : RepeatMode.Off;
        await TrackPlayer.setRepeatMode(repeatMode);
        addDebugLog(`Track added. Loop=${loopEnabled}, Platform=${Platform.OS}, RepeatMode=${repeatMode === RepeatMode.Track ? 'Track' : 'Off'}, URL=${streamInfo.url.substring(0, 50)}...`);

        await TrackPlayer.play();
        setCurrentTrackId(videoId);

        addDebugLog(`Playing from R2: ${videoId}`);
      } catch (error) {
        console.error('Unable to start playback', error);
        addDebugLog(`Playback error: ${error}`);
        setMessage('播放失败，请稍后重试。');
        stopCachePolling(); // Stop polling if there was an error
      }
    },
    [
      loopEnabled,
      stopPlayback,
      clearQueue,
      playNextInQueue,
      tracks,
      requestStreamInfo,
      // startCachePolling is intentionally omitted to avoid circular dependency
      // eslint-disable-next-line react-hooks/exhaustive-deps
      stopCachePolling,
      addDebugLog,
    ]
  );

  // Start polling for cache completion
  const startCachePolling = useCallback((videoId: string) => {
    addDebugLog(`Starting cache polling for ${videoId} (interval: ${cachePollingInterval}s)`);
    setCachingVideoId(videoId);
    setMessage(`正在缓存音频... (${videoId})`);

    // Clear any existing polling interval
    if (cachingPollIntervalRef.current) {
      clearInterval(cachingPollIntervalRef.current);
    }

    // Poll every N seconds to check if track is cached or if caching failed
    cachingPollIntervalRef.current = setInterval(async () => {
      try {
        // First check if caching has failed with an error
        const streamInfo = await requestStreamInfo(videoId);

        if (streamInfo.error) {
          // Caching failed - stop polling and show error
          addDebugLog(`[ERROR] Cache failed for ${videoId}: ${streamInfo.error}`);
          stopCachePolling();
          setMessage(`缓存失败: ${streamInfo.error}`);
          return;
        }

        // Check if track is now cached
        const cachedTracks = await axios.get(`${STREAM_BASE_URL}/tracks`);
        const foundTrack = cachedTracks.data?.tracks?.find((t: TrackMetadata) => t.videoId === videoId);

        if (foundTrack) {
          addDebugLog(`Cache completed for ${videoId}`);
          clearInterval(cachingPollIntervalRef.current);
          cachingPollIntervalRef.current = null;
          setCachingVideoId(null);
          setMessage(null);

          // Refresh tracks list
          await fetchTracks();

          // Now play the cached track
          await initiatePlayback(videoId, { skipCacheCheck: true });
        } else {
          addDebugLog(`Still caching ${videoId}...`);
        }
      } catch (error) {
        console.error('Failed to poll cache status', error);
      }
    }, cachePollingInterval * 1000);
  }, [cachePollingInterval, addDebugLog, fetchTracks, initiatePlayback, requestStreamInfo, stopCachePolling]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (cachingPollIntervalRef.current) {
        clearInterval(cachingPollIntervalRef.current);
      }
    };
  }, []);

  // Handle queue completion manually via event since we are managing the queue state manually for now
  useTrackPlayerEvents([Event.PlaybackQueueEnded, Event.PlaybackError, Event.PlaybackState, Event.PlaybackTrackChanged], async (event) => {
    if (event.type === Event.PlaybackTrackChanged) {
      const trackId = typeof event.track === 'object' && event.track !== null ? (event.track as any).id : event.track;
      const nextTrackId = typeof event.nextTrack === 'object' && event.nextTrack !== null ? (event.nextTrack as any).id : event.nextTrack;
      addDebugLog(`TrackChanged: ${trackId}, Index: ${(event as any).index}, NextTrack: ${nextTrackId}`);
      console.log('Track changed:', event);
    }
    if (event.type === Event.PlaybackError) {
      console.warn('Playback Error:', event);
      addDebugLog(`Error: ${event.message} (${event.code})`);
      setMessage(`播放出错: ${event.message || '未知错误'}`);

      // Stop playback on error to prevent infinite retries
      try {
        await TrackPlayer.reset();
        setCurrentTrackId(null);
        clearQueue();
      } catch (err) {
        console.warn('Failed to reset player after error', err);
      }
      return;
    }

    if (event.type === Event.PlaybackState) {
      console.log('Playback State:', event.state);
      addDebugLog(`State: ${event.state}`);
    }

    if (event.type === Event.PlaybackQueueEnded) {
      addDebugLog(`QueueEnded (Loop: ${loopEnabled})`);
      console.log('Queue ended. Loop:', loopEnabled, 'Queue:', queueStateRef.current.queue.length);

      // Handle group queue playback
      if (queueStateRef.current.queue.length) {
        playNextInQueue();
        return;
      }

      // For single track loop on mobile, we need to fully reset and re-add the track
      // seekTo(0) doesn't work reliably with streaming URLs on mobile
      if (loopEnabled && currentTrackId) {
        console.log('Looping single track - doing full reset');
        addDebugLog('Looping: Reloading track...');

        const metadata = tracks.find((track) => track.videoId === currentTrackId);
        if (metadata) {
          try {
            // Request stream info to get R2 URL (should be cached since we just played it)
            const streamInfo = await requestStreamInfo(currentTrackId);

            if (!streamInfo.cached) {
              addDebugLog('Warning: Track not cached during loop, will wait for caching');
              return;
            }

            await TrackPlayer.reset();
            await TrackPlayer.add({
              id: currentTrackId,
              url: streamInfo.url, // Use R2 signed URL
              title: metadata.title,
              artist: metadata.author,
              artwork: metadata.thumbnailUrl ?? undefined,
              duration: metadata.durationSeconds ?? 0,
            });
            await TrackPlayer.play();
            addDebugLog('Looping: Track reloaded and playing from R2');
          } catch (error) {
            console.error('Failed to loop track', error);
            addDebugLog(`Loop error: ${error}`);
          }
        }
        return;
      }

      // Track finished and no loop enabled
      if (!loopEnabled) {
        setMessage('播放完成');
        setCurrentTrackId(null);
        clearQueue();

        // Auto-play next track from library if available
        autoPlayLibraryTrack(currentTrackId);
      }
    }
  });

  useEffect(() => {
    initiatePlaybackRef.current = initiatePlayback;
  }, [initiatePlayback]);

  // Note: We rely on PlaybackQueueEnded event for looping, not progress monitoring
  // Progress monitoring was causing false triggers (restarting in middle of playback)

  const handlePlay = async () => {
    const targetId = parsedVideoId || currentTrackId;

    if (!targetId) {
      setMessage('请输入有效的 YouTube 链接或视频 ID。');
      return;
    }

    await initiatePlayback(targetId);
  };

  const handleLoopToggle = async (value: boolean) => {
    setLoopEnabled(value);
    addDebugLog(`Loop toggle: ${value} (platform: ${Platform.OS})`);
    try {
      // On mobile, we handle looping manually, so don't set RepeatMode.Track
      const repeatMode = Platform.OS === 'web' && value ? RepeatMode.Track : RepeatMode.Off;
      await TrackPlayer.setRepeatMode(repeatMode);
      const currentMode = await TrackPlayer.getRepeatMode();
      addDebugLog(`RepeatMode: ${currentMode} (mobile uses PlaybackQueueEnded event)`);
      console.log('Repeat mode changed to:', currentMode, 'Platform:', Platform.OS);
    } catch (error) {
      console.warn('Unable to toggle loop', error);
      addDebugLog(`Loop toggle error: ${error}`);
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
          setCurrentTrackId(null);
        }
        fetchGroups();
      } catch (error) {
        console.error('Failed to delete group', error);
        setMessage('删除分组失败');
      }
    },
    [fetchGroups, stopPlayback]
  );

  const handleUpdateGroup = useCallback(async (groupId: string, name: string, trackIds: string[]) => {
    if (!STREAM_BASE_URL) {
      setMessage('Backend not configured');
      return;
    }
    try {
      await axios.put(`${STREAM_BASE_URL}/groups/${groupId}`, {
        name,
        trackIds
      });
      fetchGroups();
      // Update the currently viewing group to reflect changes immediately in UI if needed,
      // but fetchGroups should handle it. However, fetchGroups is async.
      // We can also optimize by updating the local state.
      setViewingGroup(prev => prev ? { ...prev, trackIds } : null);
    } catch (error) {
      console.error('Failed to update group', error);
      setMessage('Failed to update group');
    }
  }, [fetchGroups]);

  const handleTrackPlay = useCallback(
    async (videoId: string) => {
      setYoutubeInput(''); // Clear search input when playing
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
  }, []);

  const handlePrimaryAction = useCallback(async () => {
    const trimmed = youtubeInput.trim();
    if (!trimmed) {
      setMessage('请输入 YouTube 链接或搜索内容');
      return;
    }

    if (parsedVideoId) {
      await initiatePlayback(parsedVideoId);
      setYoutubeInput(''); // Clear search input when playing
      return;
    }

    await handleSearch(trimmed);
  }, [youtubeInput, parsedVideoId, initiatePlayback, handleSearch]);

  const handleSearchResultSelect = useCallback(
    async (result: YouTubeSearchResult) => {
      if (playerState !== 'idle') {
        await stopPlayback();
      }

      try {
        await initiatePlayback(result.videoId);
        setMessage(`正在播放：${result.title}`);
        setYoutubeInput(''); // Clear search input when playing
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
          setCurrentTrackId(null);
        }
        setMessage('曲目已删除');
        fetchTracks();
        fetchGroups();
      } catch (error) {
        console.error('Failed to delete track', error);
        setMessage('删除曲目失败');
      }
    },
    [fetchGroups, fetchTracks, stopPlayback, currentTrackId]
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

  const sliderMax = progress.duration > 0 ? progress.duration * 1000 : 1;
  const displayedPosition = isSeeking ? seekValue : progress.position * 1000;
  const sliderValue = progress.duration > 0 ? Math.min(displayedPosition, sliderMax) : 0;

  const currentTrack = tracks.find((t) => t.videoId === currentTrackId);

  return (
    <View
      style={{ flex: 1, backgroundColor: 'black' }}
      onTouchStart={handleActivity}
    >
      <AppBackground
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
      <Animated.View style={[{ flex: 1 }, animatedOpacityStyle]}>
        <View style={styles.container}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.content}
            scrollEnabled={outerScrollEnabled}
          >
            <Text variant="headlineMedium" style={[styles.heading, { color: TextColors.primary }]}>
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
                  multiline={false}
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
                          <Text variant="titleSmall" numberOfLines={1} style={{ color: TextColors.primary }}>
                            {result.title}
                          </Text>
                          <Text variant="bodySmall" numberOfLines={1} style={{ color: TextColors.secondary }}>
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

                {(showBanner || backgroundMode !== 'pure_black') && (
                  <View style={styles.albumContainer}>
                    {playerState === 'loading' && (
                      <Animated.View style={[styles.ripple, rippleStyle]} />
                    )}
                    {currentTrack && showBanner ? (
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
                )}

                {currentTrack && showBanner && (
                  <View style={styles.trackInfoContainer}>
                    <Text variant="titleMedium" numberOfLines={1} style={{ textAlign: 'center', color: TextColors.primary }}>
                      {currentTrack.title}
                    </Text>
                    <Text variant="bodySmall" style={{ color: TextColors.secondary }}>
                      {currentTrack.author}
                    </Text>
                  </View>
                )}

                {cachingVideoId && (
                  <View style={styles.cachingIndicator}>
                    <PaperActivityIndicator animating={true} size="large" color={theme.colors.primary} />
                    <Text variant="titleMedium" style={{ color: TextColors.primary, marginTop: 12 }}>
                      正在缓存音频...
                    </Text>
                    <Text variant="bodySmall" style={{ color: TextColors.secondary, marginTop: 4 }}>
                      请稍候，首次播放需要下载并转码
                    </Text>
                  </View>
                )}

                {!cachingVideoId && (parsedVideoId || currentTrackId) && (
                  <View style={styles.controls}>
                    <IconButton
                      icon="play"
                      mode="contained"
                      containerColor={(playerState === 'playing' || playerState === 'loading') ? '#E0B0FF' : '#FFFFFF'}
                      iconColor={(playerState === 'playing' || playerState === 'loading') ? '#FFFFFF' : '#000000'}
                      size={Platform.OS === 'web' ? 40 : 32}
                      onPress={playerState === 'paused' ? handleResume : handlePlay}
                    />
                    <IconButton
                      icon="pause"
                      mode="contained"
                      containerColor={playerState === 'paused' ? '#E0B0FF' : '#FFFFFF'}
                      iconColor={playerState === 'paused' ? '#FFFFFF' : '#000000'}
                      size={Platform.OS === 'web' ? 32 : 28}
                      onPress={handlePause}
                    />
                    <IconButton
                      icon="stop"
                      mode="contained"
                      containerColor={(playerState === 'idle' && !!currentTrackId) ? '#E0B0FF' : '#FFFFFF'}
                      iconColor={(playerState === 'idle' && !!currentTrackId) ? '#FFFFFF' : '#000000'}
                      size={Platform.OS === 'web' ? 32 : 28}
                      onPress={stopPlayback}
                    />
                    <IconButton
                      icon={loopEnabled ? "repeat-once" : "repeat-off"}
                      mode="contained"
                      containerColor={loopEnabled ? '#E0B0FF' : '#FFFFFF'}
                      iconColor={loopEnabled ? '#FFFFFF' : '#000000'}
                      size={Platform.OS === 'web' ? 32 : 28}
                      onPress={() => handleLoopToggle(!loopEnabled)}
                    />
                  </View>
                )}

                {playerState !== 'idle' && !cachingVideoId && (
                  <Text variant="labelSmall" style={{ textAlign: 'center', marginTop: 10 }}>
                    {PLAYER_STATE_COPY[playerState]}
                  </Text>
                )}

                {playerState !== 'idle' && (
                  <View style={styles.sliderContainer}>
                    <Slider
                      style={styles.slider}
                      minimumValue={0}
                      maximumValue={sliderMax}
                      value={sliderValue}
                      minimumTrackTintColor={theme.colors.primary}
                      maximumTrackTintColor={theme.colors.surfaceVariant}
                      thumbTintColor={theme.colors.primary}
                      disabled={progress.duration <= 0}
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
                        try {
                          await TrackPlayer.seekTo(nextValue / 1000);
                        } catch (error) {
                          console.warn('Unable to seek playback', error);
                        }
                      }}
                    />
                    <View style={styles.timeRow}>
                      <Text variant="labelSmall" style={{ color: TextColors.primary }}>{formatTime(displayedPosition)}</Text>
                      <Text variant="labelSmall" style={{ color: TextColors.primary }}>{progress.duration > 0 ? formatTime(progress.duration * 1000) : '--:--'}</Text>
                    </View>
                  </View>
                )}


                {/* Debug Logs Section */}
                {showDebugConsole && (
                  <View style={{ marginTop: 20, padding: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8 }}>
                    <Text style={{ color: 'white', fontWeight: 'bold', marginBottom: 5 }}>Debug Console:</Text>
                    {debugLogs.map((log, i) => (
                      <Text key={i} style={{ color: '#ccc', fontSize: 10 }}>{log}</Text>
                    ))}
                  </View>
                )}
              </View>
            </BlurView>

            <BlurView intensity={20} tint="dark" style={styles.glassCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{`Tracks (${tracks.length})`}</Text>
                <IconButton icon="refresh" onPress={fetchTracks} iconColor={theme.colors.onSurface} />
              </View>
              <View style={styles.cardContent}>
                {tracksLoading ? (
                  <PaperActivityIndicator />
                ) : tracks.length === 0 ? (
                  <Text style={{ color: TextColors.secondary }}>No cached tracks.</Text>
                ) : (
                  Platform.OS === 'web' ? (
                    <View style={{ height: 400 }}>
                      <FlatList
                        data={tracks}
                        scrollEnabled={true}
                        nestedScrollEnabled
                        keyExtractor={(item) => item.videoId}
                        renderItem={({ item }) => {
                          const selected = selectedTrackIds.includes(item.videoId);
                          const playing = currentTrackId === item.videoId;
                          return (
                            <Card mode="contained" style={[styles.trackItem, playing && { borderColor: theme.colors.primary, borderWidth: 1 }]}>
                              <Card.Content style={styles.trackItemContent}>
                                <View style={{ flex: 1 }}>
                                  <Text variant="titleSmall" numberOfLines={1} style={{ color: TextColors.primary }}>{item.title}</Text>
                                  <Text variant="bodySmall" style={{ color: TextColors.secondary }}>{item.author} · {formatDuration(item.durationSeconds)}</Text>
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
                    <View style={{ height: 450 }}>
                      <DraggableFlatList
                        data={tracks}
                        scrollEnabled={true}
                        nestedScrollEnabled
                        onDragBegin={() => setOuterScrollEnabled(false)}
                        onRelease={() => setOuterScrollEnabled(true)}
                        onDragEnd={async ({ data }) => {
                          setTracks(data);
                          setOuterScrollEnabled(true);
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
                                      <Text variant="titleSmall" numberOfLines={1} style={{ color: TextColors.primary }}>{item.title}</Text>
                                      <Text variant="bodySmall" style={{ color: TextColors.secondary }}>{item.author} · {formatDuration(item.durationSeconds)}</Text>
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
                    </View>
                  )
                )}
                <Text style={styles.hint}>Selected: {selectedTrackIds.length}</Text>
              </View>
            </BlurView>

            {selectedTrackIds.length > 0 && (
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
            )}

            <BlurView intensity={20} tint="dark" style={styles.glassCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{`Groups (${groups.length})`}</Text>
              </View>
              <View style={styles.cardContent}>
                <ScrollView style={{ maxHeight: 450 }} nestedScrollEnabled>
                  {groupsLoading ? (
                    <PaperActivityIndicator />
                  ) : (
                    groups.map((group) => (
                      <Card key={group.id} mode="contained" style={[styles.groupItem, activeGroupId === group.id && { borderColor: theme.colors.primary, borderWidth: 1 }]}>
                        <Card.Content style={styles.groupItemContent}>
                          <View style={{ flex: 1 }}>
                            <Text variant="titleSmall" style={{ color: TextColors.primary }}>{group.name}</Text>
                            <Text variant="bodySmall" style={{ color: TextColors.secondary }}>{group.trackIds.length} tracks</Text>
                          </View>
                          <View style={styles.trackActions}>
                            <IconButton icon="play" iconColor="white" onPress={() => handleGroupPlayback(group.id)} />
                            <IconButton icon="playlist-edit" iconColor="white" onPress={() => setViewingGroup(group)} />
                            <IconButton icon="delete" iconColor="white" onPress={() => handleDeleteGroup(group.id)} />
                            <IconButton
                              icon={groupLoopEnabled ? "repeat" : "repeat-off"}
                              iconColor="white"
                              onPress={() => setGroupLoopEnabled(!groupLoopEnabled)}
                            />
                          </View>
                        </Card.Content>
                      </Card>
                    ))
                  )}
                </ScrollView>
              </View>
            </BlurView>
          </ScrollView>
        </View >
        <GroupDetailModal
          visible={!!viewingGroup}
          onDismiss={() => setViewingGroup(null)}
          group={viewingGroup}
          allTracks={tracks}
          onUpdateGroup={handleUpdateGroup}
          onPlayGroup={(groupId) => {
            handleGroupPlayback(groupId);
            setViewingGroup(null);
          }}
        />
      </Animated.View>
    </View >
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Platform.OS === 'web' ? 20 : 16,
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
    fontSize: Platform.OS === 'web' ? 20 : 18,
    fontWeight: 'bold',
    color: TextColors.primary,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 20 : 12, // Increased padding to prevent clipping
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
    backgroundColor: StatusColors.success,
  },
  offline: {
    backgroundColor: StatusColors.error,
  },
  input: {
    marginBottom: Spacing.md,
    backgroundColor: SurfaceColors.input,
  },
  searchResultsContainer: {
    gap: 8,
    marginVertical: 8,
  },
  searchResultCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  searchThumbnail: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.sm,
    backgroundColor: SurfaceColors.input,
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
    borderRadius: BorderRadius.xxl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BorderColors.subtle,
    marginVertical: Spacing.xl,
    backgroundColor: SurfaceColors.card,
  },
  cardContent: {
    padding: Platform.OS === 'web' ? Spacing.xxl : Spacing.lg,
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
    gap: Platform.OS === 'web' ? Spacing.xl : Spacing.md,
    marginBottom: Spacing.xl,
  },
  cachingIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    marginBottom: Spacing.xl,
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
    marginBottom: Spacing.md,
    backgroundColor: SurfaceColors.listItem,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: BorderColors.subtle,
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
    color: TextColors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  trackArtist: {
    color: TextColors.secondary,
    fontSize: 14,
  },
  trackActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupItem: {
    marginBottom: Spacing.md,
    backgroundColor: SurfaceColors.listItem,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: BorderColors.subtle,
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
