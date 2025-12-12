// Web shim for react-native-track-player

export const Capability = {
    Play: 'Play',
    Pause: 'Pause',
    SkipToNext: 'SkipToNext',
    SkipToPrevious: 'SkipToPrevious',
    Stop: 'Stop',
    SeekTo: 'SeekTo',
};

export const Event = {
    PlaybackState: 'playback-state',
    PlaybackError: 'playback-error',
    PlaybackQueueEnded: 'playback-queue-ended',
    PlaybackTrackChanged: 'playback-track-changed',
    RemotePlay: 'remote-play',
    RemotePause: 'remote-pause',
    RemoteStop: 'remote-stop',
    RemoteNext: 'remote-next',
    RemotePrevious: 'remote-previous',
    RemoteSeek: 'remote-seek',
};

export const RepeatMode = {
    Off: 0,
    Track: 1,
    Queue: 2,
};

export const State = {
    None: 'none',
    Ready: 'ready',
    Playing: 'playing',
    Paused: 'paused',
    Stopped: 'stopped',
    Buffering: 'buffering',
    Connecting: 'connecting',
};

export const AppKilledPlaybackBehavior = {
    ContinuePlayback: 'continue-playback',
    PausePlayback: 'pause-playback',
    StopPlaybackAndRemoveNotification: 'stop-playback-and-remove-notification',
};

export const IOSCategory = {
    Playback: 'playback',
};

export const IOSCategoryMode = {
    Default: 'default',
};

export const IOSCategoryOptions = {
    AllowBluetooth: 'allow-bluetooth',
    DefaultToSpeaker: 'default-to-speaker',
    InterruptSpokenAudioAndMixWithOthers: 'interrupt-spoken-audio-and-mix-with-others',
};

export const usePlaybackState = () => ({ state: State.None });
export const useProgress = () => ({ position: 0, duration: 0, buffered: 0 });
export const useTrackPlayerEvents = () => { };

const TrackPlayer = {
    setupPlayer: async () => { },
    updateOptions: async () => { },
    add: async () => { },
    remove: async () => { },
    skip: async () => { },
    skipToNext: async () => { },
    skipToPrevious: async () => { },
    reset: async () => { },
    play: async () => { },
    pause: async () => { },
    stop: async () => { },
    seekTo: async () => { },
    setVolume: async () => { },
    setRate: async () => { },
    setRepeatMode: async () => { },
    getVolume: async () => 1,
    getRate: async () => 1,
    getTrack: async () => null,
    getQueue: async () => [],
    getCurrentTrack: async () => null,
    getDuration: async () => 0,
    getPosition: async () => 0,
    getBufferedPosition: async () => 0,
    getState: async () => State.None,
    addEventListener: () => ({ remove: () => { } }),
    registerPlaybackService: () => { },
};

export default TrackPlayer;
