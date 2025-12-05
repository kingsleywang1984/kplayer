import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

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

type SettingsContextValue = {
  autoRefreshEnabled: boolean;
  keepAliveEnabled: boolean;
  backgroundMode: BackgroundMode;
  setAutoRefreshEnabled: (value: boolean) => void;
  setKeepAliveEnabled: (value: boolean) => void;
  setBackgroundMode: (value: BackgroundMode) => void;
};

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(DEFAULT_AUTO_REFRESH_ENABLED);
  const [keepAliveEnabled, setKeepAliveEnabled] = useState(DEFAULT_KEEP_ALIVE_ENABLED);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('galaxy');

  const value = useMemo(
    () => ({
      autoRefreshEnabled,
      keepAliveEnabled,
      backgroundMode,
      setAutoRefreshEnabled,
      setKeepAliveEnabled,
      setBackgroundMode,
    }),
    [autoRefreshEnabled, keepAliveEnabled, backgroundMode]
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
  backgroundMode: 'galaxy' as BackgroundMode,
};

export type BackgroundMode = 'galaxy' | 'pure_black' | 'rainbow_zappers' | 'particle_sphere';

