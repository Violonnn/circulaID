import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut } from '../../lib/auth';
import { useAuth } from '../../lib/auth-context';
import { toTitleCase } from '../../lib/format';
import { colors, fonts, radius, shadow, spacing } from '../../lib/theme';

// Completely separate screen for admins. Reached only when the database role
// is 'admin' (decided in RootLayout).
export default function AdminHome() {
  const { profile } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await signOut();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.brand}>
        circula<Text style={styles.brandAccent}>ID</Text>
      </Text>
      <Text style={styles.welcome}>
        Welcome, {toTitleCase(profile?.full_name ?? '') || 'Admin'}!
      </Text>

      <Card style={styles.card}>
        <Card.Title title="Platform Overview" />
        <Card.Content>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text variant="bodySmall">Total Users</Text>
              <Text variant="titleLarge">--</Text>
            </View>
            <View style={styles.statBox}>
              <Text variant="bodySmall">Active Posts</Text>
              <Text variant="titleLarge">--</Text>
            </View>
          </View>
        </Card.Content>
      </Card>

      <View style={styles.footer}>
        <Button mode="outlined" onPress={handleLogout} loading={loggingOut} disabled={loggingOut} style={styles.logout}>
          Log out
        </Button>
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg },
  brand: { fontFamily: fonts.display, fontSize: 16, color: colors.primary, letterSpacing: 0.3 },
  brandAccent: { fontFamily: fonts.display, color: colors.primaryAccent },
  welcome: { fontFamily: fonts.display, fontSize: 28, color: colors.text, marginTop: 2, marginBottom: spacing.lg },
  card: { marginTop: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  footer: { marginTop: spacing.xxl },
  logout: { borderRadius: radius.pill },
});
