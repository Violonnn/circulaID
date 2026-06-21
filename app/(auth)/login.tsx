import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { signIn } from '../../lib/auth';
import { colors, fonts, radius, spacing } from '../../lib/theme';

// Shared login screen. Regular users AND admins log in here; where they land
// afterwards is decided by RootLayout based on their database role.
export default function Login() {
  const router = useRouter();
  // Size the logo relative to the device width so it adapts across screens,
  // capped so it never gets oversized on tablets.
  const { width } = useWindowDimensions();
  const logoSize = Math.min(width * 0.32, 140);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    // Guard: don't call the API with missing credentials.
    if (!email.trim() || !password) return setError('Please fill in all fields.');

    setError('');
    setSubmitting(true);
    const { error: signInError } = await signIn(email.trim(), password);
    setSubmitting(false);

    // Guard: stop on bad credentials and show Supabase's message inline.
    if (signInError) return setError(signInError.message);
    // Success: the auth listener in RootLayout routes us to the right home.
  }

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/images/icon.png')}
        style={[styles.logo, { width: logoSize, height: logoSize }]}
        resizeMode="contain"
        accessibilityLabel="CirculaID logo"
      />
      <Text style={styles.title}>Welcome back!</Text>
      <Text style={styles.subtitle}>Log in to explore clients or workers</Text>

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

      <TextInput
        label="Password"
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

      <Button
        mode="text"
        compact
        onPress={() => router.push('/forgotPasswod')}
        labelStyle={styles.link}
        style={styles.forgot}
      >
        Forgot password?
      </Button>

      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>

      <Button
        mode="contained"
        onPress={handleLogin}
        loading={submitting}
        disabled={submitting}
        style={styles.button}
        contentStyle={styles.buttonContent}
        labelStyle={styles.buttonLabel}
      >
        Log in
      </Button>

      <Button mode="text" onPress={() => router.push('/register')} labelStyle={styles.link}>
        Don&apos;t have an account? Register
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.xxl, justifyContent: 'center' },
  logo: { alignSelf: 'center', marginBottom: spacing.lg },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.xxl,
  },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  forgot: { alignSelf: 'flex-end', marginTop: -spacing.xs },
  button: { borderRadius: radius.pill, marginTop: spacing.sm, marginBottom: spacing.sm },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
  link: { fontFamily: fonts.bodyMedium, color: colors.primaryAccent },
});
