import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import axios from 'axios';

import { useAuth } from '@/context/auth-context';

const STREAM_BASE_URL = (process.env.EXPO_PUBLIC_STREAM_BASE_URL ?? '').replace(/\/$/, '');

/**
 * The code is no longer just a local unlock - it selects which library the gateway serves,
 * so verifying it exchanges it for a token that every later request carries. The token
 * lives in the auth context; this component only collects the code.
 */
export function AccessGate() {
  const { token, ready, signIn } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!STREAM_BASE_URL) {
      setEnabled(false);
      setLoadingStatus(false);
      return;
    }

    try {
      setLoadingStatus(true);
      setStatusError(null);
      const response = await axios.get(`${STREAM_BASE_URL}/api/access-control/status`);
      setEnabled(Boolean(response.data?.enabled));
    } catch (error) {
      console.warn('[AccessGate] Failed to fetch status', error);
      setStatusError('无法获取访问控制状态，请检查后端服务');
      // Fail closed: if we cannot tell, assume a code is needed rather than exposing the app.
      setEnabled(true);
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
      if (response.data?.success && response.data?.token) {
        await signIn({
          token: response.data.token,
          expiresAt: response.data.expiresAt ?? null,
          label: response.data.label ?? null,
        });
        setCode('');
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

  if (!enabled || token) {
    return null;
  }

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <KeyboardAvoidingView
        style={styles.centerContent}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {loadingStatus || !ready ? (
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
              onSubmitEditing={handleSubmit}
            />
            <Pressable
              style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={styles.submitText}>{submitting ? '验证中...' : '解锁'}</Text>
            </Pressable>
            {(submitError || statusError) && (
              <Text style={styles.errorText}>{submitError || statusError}</Text>
            )}
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
  errorText: {
    color: '#ff6b6b',
    textAlign: 'center',
  },
});
