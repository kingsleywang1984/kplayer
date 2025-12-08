// Register the TrackPlayer service
import { AppRegistry } from 'react-native';
import TrackPlayer from 'react-native-track-player';

// Must be registered right away
TrackPlayer.registerPlaybackService(() => require('./service'));

// Proceed with standard Expo Router entry
import 'expo-router/entry';
