import TrackPlayer, { Event, RepeatMode } from 'react-native-track-player';

module.exports = async function () {
    // Handle remote control events from iOS Control Center / Lock Screen
    TrackPlayer.addEventListener(Event.RemotePlay, async () => {
        console.log('Service: Remote Play');
        await TrackPlayer.play();
    });

    TrackPlayer.addEventListener(Event.RemotePause, async () => {
        console.log('Service: Remote Pause');
        await TrackPlayer.pause();
    });

    TrackPlayer.addEventListener(Event.RemoteStop, async () => {
        console.log('Service: Remote Stop');
        await TrackPlayer.stop();
    });

    TrackPlayer.addEventListener(Event.RemoteNext, async () => {
        console.log('Service: Remote Next');
        const queue = await TrackPlayer.getQueue();
        if (queue.length > 1) {
            await TrackPlayer.skipToNext();
        }
    });

    TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
        console.log('Service: Remote Previous');
        const queue = await TrackPlayer.getQueue();
        if (queue.length > 1) {
            await TrackPlayer.skipToPrevious();
        }
    });

    TrackPlayer.addEventListener(Event.RemoteSeek, async (event) => {
        console.log('Service: Remote Seek to', event.position);
        await TrackPlayer.seekTo(event.position);
    });

    // Handle playback queue ended
    // Note: On mobile with streaming URLs, this event may not fire reliably
    // The main app handles looping via progress monitoring instead
    TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async (event) => {
        console.log('Service: Queue Ended');
        const repeatMode = await TrackPlayer.getRepeatMode();
        console.log('Service: RepeatMode is', repeatMode);
    });

    // Handle playback errors
    TrackPlayer.addEventListener(Event.PlaybackError, async (error) => {
        console.warn('Service: Playback Error:', error);
    });
};
