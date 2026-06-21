import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text } from 'react-native-paper';
import { resendConfirmation } from '../../lib/auth';
import { colors, fonts, radius, spacing } from '../../lib/theme';

// Shown right after sign-up while we wait for the user to confirm their email.
// It is "dynamic": if the confirmation link reopens the app, we detect it and
// move the user to Login automatically. They can also leave and log in later.
export default function Confirm() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();

  // The URL the app was opened with. Expo updates this when a deep link (like
  // our email confirmation link) reopens the app.
  const incomingUrl = Linking.useURL();

  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    // Guard: nothing to react to until a deep link actually arrives.
    if (!incomingUrl) return;

    // The confirmation link carries auth tokens (access_token / code). Seeing
    // them means the email is now verified, so move the user to Login.
    const isConfirmCallback =
      incomingUrl.includes('access_token') ||
      incomingUrl.includes('type=signup') ||
      incomingUrl.includes('code=');

    // Guard: ignore any other deep link that isn't the confirmation callback.
    if (!isConfirmCallback) return;

    router.replace('/login');
  }, [incomingUrl, router]);

  async function handleResend() {
    // Guard: we can only resend if we know which email to send to.
    if (!email) return setNotice('No email on file — please register again.');

    setNotice('');
    setResending(true);
    const { error } = await resendConfirmation(email);
    setResending(false);

    // Guard: surface any send error; otherwise confirm it went out.
    if (error) return setNotice(error.message);
    setNotice('Confirmation email re-sent.');
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" style={styles.spinner} />

      <Text style={styles.title}>Confirm your email</Text>
      <Text style={styles.body}>
        We sent a confirmation link to {email ? email : 'your email'}. Tap the link to
        verify your account, then log in.
      </Text>

      <HelperText type="info" visible={!!notice} style={styles.notice}>
        {notice}
      </HelperText>

      <Button
        mode="contained"
        onPress={() => router.replace('/login')}
        style={styles.button}
        contentStyle={styles.buttonContent}
        labelStyle={styles.buttonLabel}
      >
        I&apos;ve confirmed — go to Login
      </Button>
      <Button mode="outlined" onPress={handleResend} loading={resending} disabled={resending} style={styles.outlined}>
        Resend email
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.xxl, justifyContent: 'center' },
  spinner: { marginBottom: spacing.lg },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  body: { fontFamily: fonts.body, fontSize: 15, textAlign: 'center', color: colors.textMuted, marginBottom: spacing.sm },
  notice: { textAlign: 'center' },
  button: { borderRadius: radius.pill, marginBottom: spacing.sm },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 15 },
  outlined: { borderRadius: radius.pill },
});
