// Register the TrackPlayer service
import { AppRegistry } from 'react-native';
import TrackPlayer from 'react-native-track-player';

import { Platform } from 'react-native';

// Must be registered right away
if (Platform.OS !== 'web') {
    TrackPlayer.registerPlaybackService(() => require('./service'));
}

// Proceed with standard Expo Router entry
import 'expo-router/entry';
