import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { requestPasswordReset } from '../../lib/auth';
import { colors, fonts, radius, spacing } from '../../lib/theme';

// Light format check before contacting the server.
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

// Step 1 of the reset flow: the user proves they own the address by requesting a
// verification email. They can only set a new password AFTER clicking that link
// (which reopens the app at /reset-password).
export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSend() {
    const cleanEmail = email.trim().toLowerCase();
    // Guard: reject anything that isn't a plausible email before calling the API.
    if (!EMAIL_PATTERN.test(cleanEmail)) return setError('Please enter a valid email address.');

    setError('');
    setSending(true);
    const result = await requestPasswordReset(cleanEmail);
    setSending(false);

    // Guard: surface send errors (rate limits, etc.); otherwise show the notice.
    if (!result.success) return setError(result.message);
    setSent(true);
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Reset password</Text>

        {sent ? (
          <>
            <Text style={styles.text}>
              If an account exists for {email.trim().toLowerCase()}, we&apos;ve sent a
              password reset link. Open it on this device to choose a new password.
            </Text>
            <Button
              mode="contained"
              onPress={() => router.replace('/login')}
              style={styles.button}
              contentStyle={styles.buttonContent}
              labelStyle={styles.buttonLabel}
            >
              Back to login
            </Button>
          </>
        ) : (
          <>
            <Text style={styles.text}>
              Enter your account email and we&apos;ll send you a verification link to
              reset your password.
            </Text>

            <TextInput
              label="Email Address"
              mode="outlined"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={styles.input}
              outlineStyle={styles.inputOutline}
            />

            <HelperText type="error" visible={!!error}>
              {error}
            </HelperText>

            <Button
              mode="contained"
              onPress={handleSend}
              loading={sending}
              disabled={sending}
              style={styles.button}
              contentStyle={styles.buttonContent}
              labelStyle={styles.buttonLabel}
            >
              Send reset link
            </Button>

            <Button mode="text" onPress={() => router.replace('/login')} labelStyle={styles.link}>
              Back to login
            </Button>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: spacing.xxl, justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  text: { fontFamily: fonts.body, fontSize: 15, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
  input: { marginBottom: spacing.xs, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  button: { borderRadius: radius.pill, marginTop: spacing.sm, marginBottom: spacing.sm },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
  link: { fontFamily: fonts.bodyMedium, color: colors.primaryAccent },
});
