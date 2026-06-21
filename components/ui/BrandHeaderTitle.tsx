import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, fonts } from '../../lib/theme';

// The "circulaID" wordmark used as the navigator headerTitle so the app name
// shows consistently in the top bar. Presentational only.
export default function BrandHeaderTitle() {
  return (
    <Text style={styles.brand}>
      circula<Text style={styles.accent}>ID</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  brand: { fontFamily: fonts.display, fontSize: 22, color: colors.primary, letterSpacing: 0.3 },
  accent: { fontFamily: fonts.display, color: colors.primaryAccent },
});
