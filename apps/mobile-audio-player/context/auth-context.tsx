import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

/**
 * The access code decides which library the gateway serves, so it is no longer something
 * the app can check locally and forget. Verifying a code returns a token that every request
 * must carry; this holds it, restores it across launches, and drops it the moment the
 * gateway says it is no longer good.
 */

const STORAGE_KEY = '@kplayer/access-token';

// Optional client-side cap, kept from the previous access gate. The gateway sets its own
// expiry too - whichever runs out first wins.
const ACCESS_CODE_TTL_MINUTES = Number(process.env.EXPO_PUBLIC_ACCESS_CODE_TTL_MINUTES ?? '0');
const ACCESS_CODE_TTL_MS =
  Number.isFinite(ACCESS_CODE_TTL_MINUTES) && ACCESS_CODE_TTL_MINUTES > 0
    ? ACCESS_CODE_TTL_MINUTES * 60 * 1000
    : 0;

export type Credentials = {
  token: string;
  expiresAt: number | null;
  label?: string | null;
};

type AuthContextValue = {
  token: string | null;
  label: string | null;
  /** False until the stored token has been read, so the gate does not flash on launch. */
  ready: boolean;
  signIn: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function applyToken(token: string | null) {
  if (token) {
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common.Authorization;
  }
}

function effectiveExpiry(serverExpiresAt: number | null) {
  const clientExpiry = ACCESS_CODE_TTL_MS ? Date.now() + ACCESS_CODE_TTL_MS : null;
  if (serverExpiresAt && clientExpiry) {
    return Math.min(serverExpiresAt, clientExpiry);
  }
  return serverExpiresAt ?? clientExpiry;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const signOutRef = useRef<() => Promise<void>>(async () => {});

  const signOut = useCallback(async () => {
    applyToken(null);
    setToken(null);
    setLabel(null);
    setExpiresAt(null);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[Auth] Failed to clear stored token', error);
    }
  }, []);

  signOutRef.current = signOut;

  const signIn = useCallback(async (credentials: Credentials) => {
    const expiry = effectiveExpiry(credentials.expiresAt);
    applyToken(credentials.token);
    setToken(credentials.token);
    setLabel(credentials.label ?? null);
    setExpiresAt(expiry);
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ token: credentials.token, expiresAt: expiry, label: credentials.label ?? null })
      );
    } catch (error) {
      console.warn('[Auth] Failed to persist token', error);
    }
  }, []);

  // Restore a previous session before the gate decides whether to show itself.
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw && mounted) {
          const stored = JSON.parse(raw) as Credentials;
          const stillValid = !stored.expiresAt || stored.expiresAt > Date.now();
          if (stored.token && stillValid) {
            applyToken(stored.token);
            setToken(stored.token);
            setLabel(stored.label ?? null);
            setExpiresAt(stored.expiresAt ?? null);
          } else {
            await AsyncStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (error) {
        console.warn('[Auth] Failed to restore token', error);
      } finally {
        if (mounted) {
          setReady(true);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // A token the gateway rejects is worthless, whatever the local expiry says - drop it so
  // the gate comes back instead of leaving the app silently unable to load anything.
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error?.response?.status === 401) {
          signOutRef.current();
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, []);

  useEffect(() => {
    if (!token || !expiresAt) {
      return undefined;
    }

    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      signOut();
      return undefined;
    }

    const timeout = setTimeout(signOut, remaining);
    return () => clearTimeout(timeout);
  }, [token, expiresAt, signOut]);

  const value = useMemo(
    () => ({ token, label, ready, signIn, signOut }),
    [token, label, ready, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
