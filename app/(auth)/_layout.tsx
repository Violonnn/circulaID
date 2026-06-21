import { Slot } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrandHeaderTitle from '../../components/ui/BrandHeaderTitle';
import { colors, spacing } from '../../lib/theme';

export default function AuthLayout() {
  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Simple "circulaID" text header — the exact same wordmark used app-wide
            (BrandHeaderTitle). Replaces the previous photo/image header. */}
        <View style={styles.header}>
          <BrandHeaderTitle />
        </View>

        {/* The auth screen content sits naturally below the header. */}
        <Slot />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  header: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
