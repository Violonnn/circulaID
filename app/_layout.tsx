import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import {
  Quicksand_500Medium,
  Quicksand_600SemiBold,
  Quicksand_700Bold,
} from '@expo-google-fonts/quicksand';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { RoleProvider } from '../lib/role-context';
import { colors, paperTheme } from '../lib/theme';

export default function RootLayout() {
  // Load the brand fonts (rounded Quicksand for display, Nunito for body). This
  // only gates the first render; it does not affect any auth/routing logic.
  const [fontsLoaded] = useFonts({
    Quicksand_500Medium,
    Quicksand_600SemiBold,
    Quicksand_700Bold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  return (
    <SafeAreaProvider>
      {/* Custom MD3 theme makes every Paper component adopt the purple, rounded,
          font-themed look. Icons still use Expo's bundled icon font. */}
      <PaperProvider
        theme={paperTheme}
        settings={{ icon: (props) => <MaterialCommunityIcons {...props} /> }}
      >
        <AuthProvider>
          {/* RoleProvider tracks the UI-only client/worker context. It sits
              inside AuthProvider because it reads the current session. */}
          <RoleProvider>
            <RootNavigation fontsLoaded={fontsLoaded} />
          </RoleProvider>
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

// Holds all the routing rules. Every decision reads from the database-backed
// auth state (session + profile), never from anything the user can fake locally.
function RootNavigation({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { session, profile, profileMissing, loading } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Guard: don't route while we're still reading the encrypted session from
    // SecureStore (or loading the profile). The spinner below covers this.
    if (loading) return;

    // Guard: the password-recovery link briefly creates a real session. Stay on
    // the reset screen regardless, so the user can set a new password instead of
    // being bounced into the app (or to login).
    if (pathname === '/reset-password') return;

    const inAppGroup = segments[0] === '(app)';

    // Guard: no session -> protect the logged-in area, allow splash/auth screens.
    if (!session) {
      if (inAppGroup) router.replace('/login');
      return;
    }

    // Guard: session but no users row -> error screen, never let them through.
    if (profileMissing || !profile) {
      if (pathname !== '/error-role') router.replace('/error-role');
      return;
    }

    // Guard: admins go to their own separate screen.
    if (profile.role === 'admin') {
      if (pathname !== '/admin') router.replace('/admin');
      return;
    }

    // Otherwise: regular user (client or worker-enabled). We only redirect them
    // INTO the app area once (e.g. straight after login). We must NOT force a
    // single pathname here, or moving between tabs / opening a post detail would
    // immediately bounce back. Once they're inside (app), routing is hands-off.
    if (!inAppGroup) router.replace('/feed');
  }, [loading, session, profile, profileMissing, pathname, segments, router]);

  // Guard clause: while the app boots and checks secure storage for a saved
  // session (or while the brand fonts load), show a clean centered spinner
  // instead of flashing a wrong screen or un-themed text.
  if (loading || !fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Once we know the auth state, render the navigator. The effect above has
  // already decided which screen (Login / Home / Admin / Error) to show.
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
