import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider, MD3DarkTheme, MD3LightTheme, adaptNavigationTheme } from 'react-native-paper';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { SettingsProvider } from '@/context/settings-context';
import { IdleProvider } from '@/context/idle-context';

export const unstable_settings = {
  anchor: '(tabs)',
};

const { LightTheme, DarkTheme: NavigationDarkTheme } = adaptNavigationTheme({
  reactNavigationLight: DefaultTheme,
  reactNavigationDark: DarkTheme,
});

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const paperTheme = colorScheme === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const navigationTheme = colorScheme === 'dark' ? NavigationDarkTheme : LightTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SettingsProvider>
        <IdleProvider>
          <PaperProvider theme={paperTheme}>
            <ThemeProvider value={navigationTheme}>
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
              </Stack>
              <StatusBar style="auto" />
            </ThemeProvider>
          </PaperProvider>
        </IdleProvider>
      </SettingsProvider>
    </GestureHandlerRootView>
  );
}
