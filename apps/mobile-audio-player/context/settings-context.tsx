import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const toBooleanWithDefaultTrue = (value?: string | null) => {
  if (typeof value !== 'string') {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return !['false', '0', 'off', 'disabled', 'no'].includes(normalized);
};

const autoRefreshEnvValue =
  process.env.EXPO_PUBLIC_ENABLE_AUTO_REFRESH ??
  process.env.enable_auto_refresh ??
  process.env.ENABLE_AUTO_REFRESH ??
  null;

const keepAliveEnvValue =
  process.env.EXPO_PUBLIC_ENABLE_KEEP_ALIVE ??
  process.env.enable_keep_alive ??
  process.env.ENABLE_KEEP_ALIVE ??
  null;

const DEFAULT_AUTO_REFRESH_ENABLED = toBooleanWithDefaultTrue(autoRefreshEnvValue);
const DEFAULT_KEEP_ALIVE_ENABLED = toBooleanWithDefaultTrue(keepAliveEnvValue);

const STORAGE_KEYS = {
  BACKGROUND_MODE: 'kplayer_background_mode',
  SHOW_BANNER: 'kplayer_show_banner',
  IDLE_TIMEOUT: 'kplayer_idle_timeout',
  SHOW_DEBUG_CONSOLE: 'kplayer_show_debug_console',
  CACHE_POLLING_INTERVAL: 'kplayer_cache_polling_interval',
};

type SettingsContextValue = {
  autoRefreshEnabled: boolean;
  keepAliveEnabled: boolean;
  backgroundMode: BackgroundMode;
  setAutoRefreshEnabled: (value: boolean) => void;
  setKeepAliveEnabled: (value: boolean) => void;
  setBackgroundMode: (value: BackgroundMode) => void;
  showBanner: boolean;
  setShowBanner: (value: boolean) => void;
  idleTimeout: number;
  setIdleTimeout: (value: number) => void;
  showDebugConsole: boolean;
  setShowDebugConsole: (value: boolean) => void;
  cachePollingInterval: number;
  setCachePollingInterval: (value: number) => void;
};

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(DEFAULT_AUTO_REFRESH_ENABLED);
  const [keepAliveEnabled, setKeepAliveEnabled] = useState(DEFAULT_KEEP_ALIVE_ENABLED);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('pure_black'); // Default to pure_black for safety
  const [showBanner, setShowBanner] = useState(false);
  const [idleTimeout, setIdleTimeout] = useState(30);
  const [showDebugConsole, setShowDebugConsole] = useState(false);
  const [cachePollingInterval, setCachePollingInterval] = useState(10); // Default 10 seconds
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings from AsyncStorage on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const [storedMode, storedBanner, storedTimeout, storedDebug, storedPolling] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.BACKGROUND_MODE),
          AsyncStorage.getItem(STORAGE_KEYS.SHOW_BANNER),
          AsyncStorage.getItem(STORAGE_KEYS.IDLE_TIMEOUT),
          AsyncStorage.getItem(STORAGE_KEYS.SHOW_DEBUG_CONSOLE),
          AsyncStorage.getItem(STORAGE_KEYS.CACHE_POLLING_INTERVAL),
        ]);

        if (storedMode) setBackgroundMode(storedMode as BackgroundMode);
        if (storedBanner !== null) setShowBanner(storedBanner === 'true');
        if (storedTimeout) setIdleTimeout(parseInt(storedTimeout, 10));
        if (storedDebug !== null) setShowDebugConsole(storedDebug === 'true');
        if (storedPolling) setCachePollingInterval(parseInt(storedPolling, 10));

        setIsLoaded(true);
      } catch (error) {
        console.error('Failed to load settings:', error);
        setIsLoaded(true);
      }
    }
    loadSettings();
  }, []);

  // Save backgroundMode when it changes
  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.BACKGROUND_MODE, backgroundMode);
  }, [backgroundMode, isLoaded]);

  // Save showBanner when it changes
  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.SHOW_BANNER, String(showBanner));
  }, [showBanner, isLoaded]);

  // Save idleTimeout when it changes
  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.IDLE_TIMEOUT, String(idleTimeout));
  }, [idleTimeout, isLoaded]);

  // Save showDebugConsole when it changes
  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.SHOW_DEBUG_CONSOLE, String(showDebugConsole));
  }, [showDebugConsole, isLoaded]);

  // Save cachePollingInterval when it changes
  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.CACHE_POLLING_INTERVAL, String(cachePollingInterval));
  }, [cachePollingInterval, isLoaded]);

  const value = useMemo(
    () => ({
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
      cachePollingInterval,
      setCachePollingInterval,
    }),
    [autoRefreshEnabled, keepAliveEnabled, backgroundMode, showBanner, idleTimeout, showDebugConsole, cachePollingInterval]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

export const SETTINGS_DEFAULTS = {
  autoRefreshEnabled: DEFAULT_AUTO_REFRESH_ENABLED,
  keepAliveEnabled: DEFAULT_KEEP_ALIVE_ENABLED,
  backgroundMode: 'pure_black' as BackgroundMode, // Default to pure_black to avoid background crashes
  showBanner: false,
  idleTimeout: 30,
  showDebugConsole: false,
  cachePollingInterval: 10,
};

export type BackgroundMode = 'galaxy' | 'pure_black' | 'rainbow_zappers' | 'particle_sphere' | 'tunnel_animation' | 'wormhole';

