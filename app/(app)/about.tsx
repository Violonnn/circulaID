import { Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrandHeaderTitle from '../../components/ui/BrandHeaderTitle';
import { colors, spacing } from '../../lib/theme';

// ABOUT CirculaID — a simple, centered three-line stack: the app wordmark
// (reusing the existing BrandHeaderTitle pattern), the one-line description and
// the version. No extra content.
const APP_VERSION = '1.0.0';

export default function About() {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'About' }} />
      <View style={styles.center}>
        <BrandHeaderTitle />
        <Text variant="bodyLarge" style={styles.body}>
          CirculaID connects people who need a hand with trusted local service providers.
        </Text>
        <Text variant="bodyMedium" style={styles.version}>
          Version {APP_VERSION}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.lg,
  },
  body: { textAlign: 'center', color: colors.text, lineHeight: 24 },
  version: { textAlign: 'center', color: colors.textFaint },
});
