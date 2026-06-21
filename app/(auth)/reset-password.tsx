import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, TextInput } from 'react-native-paper';
import { updatePassword } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';

// Step 2 of the reset flow. The verification link from the email reopens the app
// here with a short-lived recovery session. Once that session exists, the user
// can set a new password. We never let someone set a password without it.
export default function ResetPassword() {
  const router = useRouter();
  const incomingUrl = Linking.useURL();

  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Establish the recovery session from the deep link. Supabase may deliver
  // either a PKCE `code` (query) or access/refresh tokens (URL hash).
  useEffect(() => {
    if (!incomingUrl) return;
    const code = Linking.parse(incomingUrl).queryParams?.code;
    const { access_token, refresh_token } = parseHashTokens(incomingUrl);

    if (typeof code === 'string') {
      supabase.auth.exchangeCodeForSession(code).catch(() => {});
      return;
    }
    if (access_token && refresh_token) {
      supabase.auth.setSession({ access_token, refresh_token }).catch(() => {});
    }
  }, [incomingUrl]);

  // Mark the screen "ready" once a session exists (existing or via the link's
  // PASSWORD_RECOVERY event).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
      setChecking(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSave() {
    // Guard: match the registration password rules.
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirm) return setError('Passwords do not match.');

    setError('');
    setSaving(true);
    const result = await updatePassword(password);
    if (!result.success) {
      setSaving(false);
      return setError(result.message);
    }
    // Clear the recovery session so the user signs in fresh with the new password.
    await supabase.auth.signOut();
    setSaving(false);
    setDone(true);
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Set a new password</Text>

        {done ? (
          <>
            <Text style={styles.text}>Your password has been updated. Please log in.</Text>
            <Button
              mode="contained"
              onPress={() => router.replace('/login')}
              style={styles.button}
              contentStyle={styles.buttonContent}
              labelStyle={styles.buttonLabel}
            >
              Go to login
            </Button>
          </>
        ) : checking ? (
          <ActivityIndicator size="large" style={styles.spinner} />
        ) : ready ? (
          <>
            <Text style={styles.text}>Choose a new password for your account.</Text>

            <TextInput
              label="New password"
              mode="outlined"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              style={styles.input}
              outlineStyle={styles.inputOutline}
              right={
                <TextInput.Icon
                  icon={showPassword ? 'eye' : 'eye-off'}
                  onPress={() => setShowPassword((v) => !v)}
                  forceTextInputFocus={false}
                />
              }
            />
            <TextInput
              label="Confirm new password"
              mode="outlined"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              style={styles.input}
              outlineStyle={styles.inputOutline}
            />

            <HelperText type="error" visible={!!error}>
              {error}
            </HelperText>

            <Button
              mode="contained"
              onPress={handleSave}
              loading={saving}
              disabled={saving}
              style={styles.button}
              contentStyle={styles.buttonContent}
              labelStyle={styles.buttonLabel}
            >
              Update password
            </Button>
          </>
        ) : (
          <View>
            <Text style={styles.text}>
              Open the password reset link from your email on this device to
              continue.
            </Text>
            <Button mode="text" onPress={() => router.replace('/login')} labelStyle={styles.link}>
              Back to login
            </Button>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Pull access/refresh tokens out of a URL fragment ("#access_token=...&...").
function parseHashTokens(url: string): { access_token?: string; refresh_token?: string } {
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) return {};
  const result: Record<string, string> = {};
  for (const pair of url.slice(hashIndex + 1).split('&')) {
    const [key, value] = pair.split('=');
    if (key && value) result[key] = decodeURIComponent(value);
  }
  return { access_token: result.access_token, refresh_token: result.refresh_token };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: spacing.xxl, justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  text: { fontFamily: fonts.body, fontSize: 15, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
  spinner: { marginVertical: spacing.xl },
  input: { marginBottom: spacing.xs, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  button: { borderRadius: radius.pill, marginTop: spacing.sm, marginBottom: spacing.sm },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
  link: { fontFamily: fonts.bodyMedium, color: colors.primaryAccent },
});
