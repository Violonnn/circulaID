import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, fonts } from '../lib/theme';

type Props = {
  // The label shown inside the gray box, e.g. "Home Banner" or initials "MA".
  label: string;
  // When provided, the real image is rendered instead of the labeled box.
  uri?: string | null;
  width?: DimensionValue;
  height?: DimensionValue;
  // Override the default rounding — pass a large value for a circular avatar.
  borderRadius?: number;
};

// Stand-in for a real image that hasn't been designed yet. Renders a gray box
// with the intended label inside, so layouts can be built before assets exist.
// Doubles as a neutral avatar placeholder when given a small square size and a
// large borderRadius (e.g. width/height 44, borderRadius 22). If a `uri` is
// passed, it shows that actual image (e.g. a user's uploaded profile photo).
export default function PlaceholderImage({
  label,
  uri,
  width = '100%',
  height = 160,
  borderRadius = 12,
}: Props) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius }}
        contentFit="cover"
        transition={150}
      />
    );
  }

  return (
    <View style={[styles.box, { width, height, borderRadius }]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: colors.primary,
    fontFamily: fonts.display,
  },
});
