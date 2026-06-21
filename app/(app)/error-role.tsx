import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut } from '../../lib/auth';
import { colors, fonts, radius, spacing } from '../../lib/theme';

// Shown when a session exists but no users row could be loaded for it. We never
// silently let such an account through to Home or Admin.
export default function ErrorRole() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await signOut();
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Text style={styles.message}>
        Something went wrong with your account. Please contact support.
      </Text>
      <Button
        mode="contained"
        onPress={handleLogout}
        loading={loggingOut}
        disabled={loggingOut}
        style={styles.button}
        contentStyle={styles.buttonContent}
        labelStyle={styles.buttonLabel}
      >
        Log out
      </Button>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.xxl, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  message: { fontFamily: fonts.displaySemi, fontSize: 18, color: colors.text, textAlign: 'center', marginBottom: spacing.xxl },
  button: { borderRadius: radius.pill },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 15 },
});
