import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, fonts, spacing } from '../../lib/theme';

// The per-screen title shown directly BELOW the "circulaID" brand header (e.g.
// "Feed", "Hires", "Chat", "Profile", "Job"). It sits at the start of the row
// but slightly indented from the brand wordmark, so it reads as the section
// name for the current screen rather than lining up exactly under the logo.
export default function ScreenTitle({ title }: { title: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // A little starting space so the title is nudged to the right of the brand.
    paddingLeft: spacing.xxl,
    paddingRight: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.text },
});
