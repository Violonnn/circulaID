import React from 'react';
import { StyleSheet } from 'react-native';
import { Banner, Text } from 'react-native-paper';
import { useRole } from '../lib/role-context';
import { colors, fonts } from '../lib/theme';

// Persistent banner shown whenever the signed-in user's worker profile has been
// suspended by an admin. It is purely a UX heads-up: the database RLS policies
// are what actually block a suspended account from posting, accepting hires or
// messaging. Even if this banner were removed, those writes would still fail.
export default function SuspendedBanner() {
  const { isWorkerSuspended } = useRole();

  // Guard: nothing to warn about unless the worker profile is suspended.
  if (!isWorkerSuspended) return null;

  return (
    <Banner visible icon="alert-circle" style={styles.banner}>
      <Text style={styles.text}>
        Your service provider account is suspended. Posting, accepting hires and sending
        messages are disabled until an admin reactivates it.
      </Text>
    </Banner>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.dangerSoft },
  text: { color: colors.danger, fontFamily: fonts.bodyMedium },
});
