import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Audio, AVPlaybackStatus } from 'expo-av';
import axios from 'axios';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');

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

export default function HomeScreen() {
  const [youtubeLink, setYoutubeLink] = useState('');
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
  const soundRef = useRef<Audio.Sound | null>(null);
  const queueStateRef = useRef<{ queue: string[]; loop: boolean; index: number; groupId: string | null }>({
    queue: [],
    loop: false,
    index: 0,
    groupId: null,
  });
  const initiatePlaybackRef = useRef<((videoId: string, options?: PlaybackOptions) => Promise<void>) | null>(null);

  const parsedVideoId = useMemo(() => extractVideoId(youtubeLink), [youtubeLink]);

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
      setTracks(response.data?.tracks ?? []);
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
    const refreshAll = () => {
      if (gatewayStatus === 'online') {
        fetchTracks();
        fetchGroups();
      }
    };

    refreshAll();
    const interval = setInterval(refreshAll, 30000);
    return () => clearInterval(interval);
  }, [gatewayStatus, fetchTracks, fetchGroups]);

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
    [STREAM_BASE_URL, loopEnabled, stopPlayback, unloadCurrentSound, clearQueue, playNextInQueue, tracks]
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
      setYoutubeLink(videoId);
      await initiatePlayback(videoId);
    },
    [initiatePlayback]
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>YouTube Audio Streamer</Text>
      <Text style={styles.subtitle}>输入链接或从缓存列表选择歌曲，立即播放智能缓存音频。</Text>

      <View style={styles.section}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, gatewayStatus === 'online' ? styles.online : styles.offline]} />
          <Text style={styles.statusText}>
            {gatewayStatus === 'checking'
              ? '正在检查服务状态...'
              : gatewayStatus === 'online'
              ? '中间层在线'
              : '无法连接到中间层'}
          </Text>
        </View>

        {!STREAM_BASE_URL && (
          <Text style={styles.warning}>请在 .env 文件中设置 EXPO_PUBLIC_STREAM_BASE_URL。</Text>
        )}

        <TextInput
          accessibilityRole="search"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          placeholder="粘贴 YouTube 链接"
          placeholderTextColor="#9aa0a6"
          value={youtubeLink}
          onChangeText={setYoutubeLink}
        />
        <Text style={styles.hint}>解析的视频 ID：{parsedVideoId ?? '未解析'}</Text>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            style={[styles.button, (!parsedVideoId || playerState === 'loading') ? styles.buttonDisabled : null]}
            disabled={!parsedVideoId || playerState === 'loading'}
            onPress={playerState === 'paused' ? handleResume : handlePlay}>
            <Text style={styles.buttonText}>{playerState === 'paused' ? '继续播放' : '播放'}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={[styles.button, playerState !== 'playing' ? styles.buttonDisabled : null]}
            disabled={playerState !== 'playing'}
            onPress={handlePause}>
            <Text style={styles.buttonText}>暂停</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={[styles.button, playerState === 'idle' ? styles.buttonDisabled : null]}
            disabled={playerState === 'idle'}
            onPress={stopPlayback}>
            <Text style={styles.buttonText}>停止</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>播放状态：{PLAYER_STATE_COPY[playerState]}</Text>

        <View>
          <Slider
            key={currentTrackId ?? 'no-track'}
            style={styles.slider}
            minimumValue={0}
            maximumValue={sliderMax}
            value={sliderValue}
            minimumTrackTintColor="#1a73e8"
            maximumTrackTintColor="#2c2d30"
            thumbTintColor="#f1f3f4"
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
          <Text style={styles.progressLabel}>
            {formatTime(displayedPosition)} / {duration > 0 ? formatTime(duration) : '--:--'}
          </Text>
        </View>

        <View style={styles.loopRow}>
          <Text style={styles.statusText}>单曲循环</Text>
          <Switch
            value={loopEnabled}
            onValueChange={handleLoopToggle}
            trackColor={{ false: '#3c4043', true: '#1a73e8' }}
            thumbColor="#f1f3f4"
          />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>已缓存曲目 ({tracks.length})</Text>
          <Pressable style={styles.smallButton} onPress={fetchTracks}>
            <Text style={styles.smallButtonText}>刷新</Text>
          </Pressable>
        </View>

        {tracksLoading ? (
          <ActivityIndicator color="#4285f4" style={styles.loader} />
        ) : tracks.length === 0 ? (
          <Text style={styles.hint}>尚未缓存歌曲，播放任意链接后会自动缓存到 R2。</Text>
        ) : (
          tracks.map((track) => {
            const selected = selectedTrackIds.includes(track.videoId);
            const playing = currentTrackId === track.videoId;
            return (
              <View key={track.videoId} style={[styles.trackCard, playing ? styles.trackCardActive : null]}>
                <View style={styles.trackInfo}>
                  <Text style={styles.trackTitle}>{track.title}</Text>
                  <Text style={styles.trackMeta}>
                    {track.author ?? '未知艺人'} · {formatDuration(track.durationSeconds)}
                  </Text>
                </View>
                <View style={styles.trackActions}>
                  <Pressable style={styles.smallButton} onPress={() => handleTrackPlay(track.videoId)}>
                    <Text style={styles.smallButtonText}>播放</Text>
                  </Pressable>
                  <Pressable style={styles.smallButton} onPress={() => toggleTrackSelection(track.videoId)}>
                    <Text style={styles.smallButtonText}>{selected ? '取消' : '选择'}</Text>
                  </Pressable>
                  <Pressable style={styles.smallButton} onPress={() => handleDeleteTrack(track.videoId)}>
                    <Text style={styles.smallButtonText}>删除</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        <Text style={styles.hint}>已选择 {selectedTrackIds.length} 首歌曲用于分组</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>创建分组</Text>
        <TextInput
          style={styles.input}
          placeholder="分组名称，例如 睡前循环"
          placeholderTextColor="#9aa0a6"
          value={newGroupName}
          onChangeText={setNewGroupName}
        />
        <Pressable
          style={[styles.button, (!newGroupName.trim() || !selectedTrackIds.length) ? styles.buttonDisabled : null]}
          disabled={!newGroupName.trim() || !selectedTrackIds.length}
          onPress={handleCreateGroup}>
          <Text style={styles.buttonText}>创建分组</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>分组播放 ({groups.length})</Text>
          <View style={styles.inlineRow}>
            <Text style={styles.statusText}>循环播放</Text>
            <Switch
              value={groupLoopEnabled}
              onValueChange={setGroupLoopEnabled}
              trackColor={{ false: '#3c4043', true: '#1a73e8' }}
              thumbColor="#f1f3f4"
            />
          </View>
        </View>

        {groupsLoading ? (
          <ActivityIndicator color="#4285f4" style={styles.loader} />
        ) : groups.length === 0 ? (
          <Text style={styles.hint}>创建分组后可一键循环播放多个歌曲。</Text>
        ) : (
          groups.map((group) => (
            <View key={group.id} style={[styles.groupCard, activeGroupId === group.id ? styles.groupCardActive : null]}>
              <View>
                <Text style={styles.trackTitle}>{group.name}</Text>
                <Text style={styles.trackMeta}>{group.trackIds.length} 首歌曲</Text>
              </View>
              <View style={styles.trackActions}>
                <Pressable style={styles.smallButton} onPress={() => handleGroupPlayback(group.id)}>
                  <Text style={styles.smallButtonText}>播放分组</Text>
                </Pressable>
                <Pressable style={styles.smallButton} onPress={() => handleDeleteGroup(group.id)}>
                  <Text style={styles.smallButtonText}>删除</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      {playerState === 'loading' && <ActivityIndicator color="#4285f4" style={styles.loader} />}

      {message && <Text style={styles.warning}>{message}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  content: {
    padding: 24,
    gap: 20,
  },
  heading: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    color: '#e8eaed',
    fontSize: 14,
    marginBottom: 8,
  },
  section: {
    backgroundColor: '#0e0f11',
    padding: 16,
    borderRadius: 18,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  online: {
    backgroundColor: '#34a853',
  },
  offline: {
    backgroundColor: '#ea4335',
  },
  statusText: {
    color: '#e8eaed',
  },
  input: {
    borderRadius: 12,
    backgroundColor: '#1a1a1c',
    padding: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#3c4043',
  },
  hint: {
    color: '#9aa0a6',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#1a73e8',
  },
  buttonDisabled: {
    backgroundColor: '#3c4043',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  warning: {
    color: '#fbbc04',
    marginTop: 8,
  },
  loopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#2c2d30',
  },
  slider: {
    width: '100%',
    height: 32,
  },
  progressLabel: {
    marginTop: 6,
    color: '#bdc1c6',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  loader: {
    marginTop: 8,
  },
  trackCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2c2d30',
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#141517',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  trackCardActive: {
    borderColor: '#1a73e8',
  },
  trackInfo: {
    flex: 1,
    gap: 4,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  trackMeta: {
    color: '#9aa0a6',
    fontSize: 12,
  },
  trackActions: {
    flexDirection: 'row',
    gap: 8,
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3c4043',
    backgroundColor: '#1f2124',
  },
  smallButtonText: {
    color: '#e8eaed',
    fontSize: 12,
    fontWeight: '600',
  },
  groupCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2c2d30',
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#111215',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  groupCardActive: {
    borderColor: '#1a73e8',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
