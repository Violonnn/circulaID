import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, spacing } from '../../lib/theme';

// STEP 0 — Intent confirmation. We show this BEFORE the setup form so becoming a
// worker is always a deliberate choice. This is a different confirmation from the
// later "Confirm and Save" on the bio review screen — do not merge the two.
export default function WorkerIntent() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Become a Worker' }} />
      <View style={styles.content}>
        <Text style={styles.title}>Set up your worker profile?</Text>
        <Text style={styles.body}>
          You&apos;ll be able to post jobs and get hired from this same account.
        </Text>

        <Button
          mode="contained"
          onPress={() => router.replace('/worker-setup')}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Yes, continue
        </Button>
        <Button mode="text" onPress={() => router.back()} labelStyle={styles.link}>
          Cancel
        </Button>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, paddingHorizontal: spacing.xxl, justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.text, textAlign: 'center' },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  button: { borderRadius: radius.pill, marginTop: spacing.sm },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
  link: { fontFamily: fonts.bodyMedium, color: colors.textMuted, marginTop: spacing.xs },
});
