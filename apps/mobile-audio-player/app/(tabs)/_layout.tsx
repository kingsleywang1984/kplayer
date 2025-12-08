import { Tabs } from 'expo-router';
import React from 'react';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BottomTabBar } from '@react-navigation/bottom-tabs';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useIdle } from '@/context/idle-context';

function AnimatedTabBar(props: BottomTabBarProps) {
  const { isIdleShared } = useIdle();

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isIdleShared.value === 1 ? 0 : 1, { duration: 500 }),
  }));

  return (
    <Animated.View style={[animatedStyle, { position: 'absolute', bottom: 0, left: 0, right: 0 }]}>
      <BottomTabBar {...props} />
    </Animated.View>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      tabBar={(props) => <AnimatedTabBar {...props} />}
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'rgba(20, 20, 25, 0.8)',
          borderTopWidth: 0,
          elevation: 0,
        },
        sceneStyle: { backgroundColor: 'transparent' },
        lazy: true,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
