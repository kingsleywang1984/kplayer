import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import { TextColors } from '@/constants/theme';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');
const ACCESS_CODE_TTL_MINUTES = Number(process.env.EXPO_PUBLIC_ACCESS_CODE_TTL_MINUTES ?? '0');
const ACCESS_CODE_TTL_MS = Number.isFinite(ACCESS_CODE_TTL_MINUTES) && ACCESS_CODE_TTL_MINUTES > 0
  ? ACCESS_CODE_TTL_MINUTES * 60 * 1000
  : 0;
const STORAGE_KEY = '@kplayer/access-gate';

type AccessStatus = {
  enabled: boolean;
  version: string | null;
};

export function AccessGate() {
  const [status, setStatus] = useState<AccessStatus>({ enabled: false, version: null });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!STREAM_BASE_URL) {
      setStatus({ enabled: false, version: null });
      setVerified(true);
      setExpiresAt(null);
      setLoadingStatus(false);
      return;
    }

    try {
      setLoadingStatus(true);
      setStatusError(null);
      const response = await axios.get(`${STREAM_BASE_URL}/api/access-control/status`);
      const payload: AccessStatus = {
        enabled: Boolean(response.data?.enabled),
        version: response.data?.version ?? null,
      };
      setStatus(payload);

      if (!payload.enabled) {
        setVerified(true);
        setExpiresAt(null);
      } else {
        const storedRaw = await AsyncStorage.getItem(STORAGE_KEY);
        if (storedRaw) {
          try {
            const stored = JSON.parse(storedRaw) as { version: string | null; expiresAt?: number | null };
            const notExpired = !ACCESS_CODE_TTL_MS || (typeof stored.expiresAt === 'number' && stored.expiresAt > Date.now());
            if (stored.version && stored.version === payload.version && notExpired) {
              setVerified(true);
              setExpiresAt(stored.expiresAt ?? null);
            } else {
              setVerified(false);
              await AsyncStorage.removeItem(STORAGE_KEY);
              setExpiresAt(null);
            }
          } catch (error) {
            console.warn('[AccessGate] Failed to parse stored state', error);
            setVerified(false);
            setExpiresAt(null);
          }
        } else {
          setVerified(false);
          setExpiresAt(null);
        }
      }
    } catch (error) {
      console.warn('[AccessGate] Failed to fetch status', error);
      setStatusError('无法获取访问控制状态，请检查后端服务');
      setStatus({ enabled: true, version: null });
      setVerified(false);
      setExpiresAt(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSubmit = async () => {
    if (!STREAM_BASE_URL) {
      return;
    }
    const trimmed = code.trim();
    if (!trimmed) {
      setSubmitError('请输入访问码');
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      const response = await axios.post(`${STREAM_BASE_URL}/api/access-control/verify`, { code: trimmed });
      if (response.data?.success) {
        const expiresAt = ACCESS_CODE_TTL_MS ? Date.now() + ACCESS_CODE_TTL_MS : null;
        await AsyncStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: response.data?.version ?? status.version, expiresAt })
        );
        setVerified(true);
        setCode('');
        setExpiresAt(expiresAt);
      } else {
        setSubmitError(response.data?.message || '访问码错误');
      }
    } catch (error: any) {
      const message = error?.response?.data?.message || '验证失败，请稍后再试';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!ACCESS_CODE_TTL_MS || !verified || !expiresAt) {
      return undefined;
    }

    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      AsyncStorage.removeItem(STORAGE_KEY).catch((error) => {
        console.warn('[AccessGate] Failed to clear expired key', error);
      });
      setVerified(false);
      setExpiresAt(null);
      setCode('');
      return undefined;
    }

    const timeout = setTimeout(() => {
      AsyncStorage.removeItem(STORAGE_KEY).catch((error) => {
        console.warn('[AccessGate] Failed to clear expired key', error);
      });
      setVerified(false);
      setExpiresAt(null);
      setCode('');
    }, remaining);

    return () => clearTimeout(timeout);
  }, [verified, expiresAt]);

  if (!status.enabled || verified) {
    return null;
  }

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <KeyboardAvoidingView
        style={styles.centerContent}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {loadingStatus ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <View style={styles.form}>
            <TextInput
              style={[
                styles.input,
                (submitError || statusError) && styles.inputError,
              ]}
              value={code}
              onChangeText={setCode}
              placeholder="access code"
              placeholderTextColor="rgba(255,255,255,0.6)"
              editable={!submitting}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Pressable
              style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={styles.submitText}>{submitting ? '验证中...' : '解锁'}</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerContent: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 12,
  },
  form: {
    width: '100%',
    gap: 12,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    color: '#ffffff',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  inputError: {
    borderColor: '#ff6b6b',
  },
  submitButton: {
    width: '100%',
    borderRadius: 999,
    paddingVertical: 12,
    backgroundColor: '#6c63ff',
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
