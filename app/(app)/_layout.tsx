import { Stack } from 'expo-router';
import { colors, fonts } from '../../lib/theme';

// Logged-in area. This is a plain Stack so the bottom-tab shell, post detail,
// new post, proof upload and chat thread can push over each other. We do NOT
// wrap it in a SafeAreaView here: the tab navigator and each screen manage their
// own safe-area insets, which avoids double padding under headers/tab bars.
//
// Detail screens (post / new-post / proof / chat thread) use the native Stack
// header (back button + title). The tab shell and the standalone admin/error
// screens draw their own chrome, so their headers are hidden.
export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        headerTitleStyle: { fontFamily: fonts.displaySemi, fontSize: 20, color: colors.text },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="error-role" options={{ headerShown: false }} />
      <Stack.Screen name="worker-intent" />
      <Stack.Screen name="worker-setup" />
      <Stack.Screen name="skill-post-create" />
      <Stack.Screen name="worker-post/[id]" />
      <Stack.Screen name="hire/[postId]" />
      <Stack.Screen name="rating/[hireId]" />
      <Stack.Screen name="receipt/[hireId]" options={{ title: 'Receipt' }} />
      <Stack.Screen name="about" options={{ title: 'About' }} />
    </Stack>
  );
}
