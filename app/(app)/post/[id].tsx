import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Snackbar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import StatusBadge from '../../../components/StatusBadge';
import { HIRE_STATUS } from '../../../lib/constants';
import {
  createHireRequest,
  getActiveHireStatusForPost,
} from '../../../lib/hires';
import { getFeedPostById, remainingSlots, type FeedPost } from '../../../lib/posts';
import { useRole } from '../../../lib/role-context';
import { colors, fonts, radius, shadow, spacing } from '../../../lib/theme';

// POST DETAIL (Step 3): full caption + a "Request to Hire" button. The button is
// disabled (showing the current state) when the client already has a non-terminal
// request on this post, or the post is full. Price is never shown to clients.
export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isWorkerSuspended } = useRole();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [snack, setSnack] = useState('');

  const load = useCallback(async () => {
    // Guard: no id in the route means nothing to load.
    if (!id) {
      setLoadError('This post could not be found.');
      setLoading(false);
      return;
    }
    const [postResult, hireResult] = await Promise.all([
      getFeedPostById(id),
      getActiveHireStatusForPost(id),
    ]);
    setPost(postResult.post);
    setLoadError(postResult.error);
    setExistingStatus(hireResult.status);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRequest() {
    // Guard: don't allow requests from a suspended worker account (UX guard; RLS
    // also blocks the write).
    if (isWorkerSuspended) {
      setSnack('Your account is suspended.');
      return;
    }
    if (!id) return;

    setSubmitting(true);
    const result = await createHireRequest(id);
    setSubmitting(false);
    setSnack(result.message);
    // Refresh so the button reflects the new pending state.
    if (result.success) load();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  // Guard: bad/blocked post -> a clean message, never a blank screen.
  if (!post) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Post' }} />
        <Text variant="bodyMedium">{loadError ?? 'This post is unavailable.'}</Text>
      </SafeAreaView>
    );
  }

  const slotsLeft = remainingSlots(post);
  const hasActiveRequest = existingStatus !== null;
  const isFull = slotsLeft <= 0;
  const requestDisabled = submitting || hasActiveRequest || isFull;

  // Pick the clearest label for the button's current state.
  let buttonLabel = 'Request to Hire';
  if (existingStatus === HIRE_STATUS.PENDING) buttonLabel = 'Request Pending';
  else if (existingStatus === HIRE_STATUS.ACCEPTED) buttonLabel = 'Request Accepted';
  else if (existingStatus === HIRE_STATUS.IN_PROGRESS) buttonLabel = 'Job In Progress';
  else if (isFull) buttonLabel = 'Post Full';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: post.worker_name ?? 'Post' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Card.Title
            title={post.worker_name ?? 'Service Provider'}
            subtitle={post.worker_bio ?? 'No bio yet'}
          />
          <Card.Content>
            <View style={styles.metaRow}>
              <StatusBadge status={post.status} />
              <Text variant="bodySmall" style={styles.slots}>
                {slotsLeft} of {post.total_slots} slots left
              </Text>
            </View>
            <Text variant="bodyLarge" style={styles.caption}>
              {post.caption}
            </Text>
            {post.worker_rating_count ? (
              <Text variant="bodySmall" style={styles.rating}>
                Rating: {Number(post.worker_rating_avg).toFixed(1)} ★ (
                {post.worker_rating_count})
              </Text>
            ) : null}
          </Card.Content>
        </Card>

        <Button
          mode="contained"
          onPress={handleRequest}
          loading={submitting}
          disabled={requestDisabled}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          {buttonLabel}
        </Button>
      </ScrollView>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2500}>
        {snack}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  card: { marginBottom: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  caption: { lineHeight: 22 },
  rating: { marginTop: spacing.md, color: colors.textMuted },
  slots: { color: colors.textMuted },
  button: { borderRadius: radius.pill },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
});
