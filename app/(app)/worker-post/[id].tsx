import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Card, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import PlaceholderImage from '../../../components/PlaceholderImage';
import ReviewsList from '../../../components/ReviewsList';
import { formatPeso } from '../../../lib/format';
import { HIRE_STATUS, type HireStatus } from '../../../lib/constants';
import { getActiveStatusForWorkerPost } from '../../../lib/hireRequests';
import { fetchReviews, type Review } from '../../../lib/ratings';
import { supabase } from '../../../lib/supabase';
import {
  getPublicWorkerProfile,
  getWorkerPostById,
  type PublicWorkerProfile,
  type WorkerPost,
} from '../../../lib/workerPosts';
import { toTitleCase } from '../../../lib/format';
import { colors, fonts, radius, shadow, spacing } from '../../../lib/theme';

// SKILL POST DETAIL (Part 1). Role-aware: the OWNER sees their (simulated) price
// and no Hire button; a CLIENT sees the poster's name/photo and a gradient
// "Hire" button inside the description card. Guard: a fully-booked post hides
// hiring and shows "Fully booked".
export default function WorkerPostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [post, setPost] = useState<WorkerPost | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [existingStatus, setExistingStatus] = useState<HireStatus | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [workerProfile, setWorkerProfile] = useState<PublicWorkerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Guard: no id in the route means nothing to load.
    if (!id) {
      setError('This post could not be found.');
      setLoading(false);
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    const result = await getWorkerPostById(String(id));
    setCurrentUserId(auth.user?.id ?? null);
    setPost(result.post);
    setError(result.error);

    // Only a client (non-owner) needs the duplicate-request check.
    if (result.post && auth.user && result.post.worker_id !== auth.user.id) {
      const hire = await getActiveStatusForWorkerPost(result.post.id);
      setExistingStatus(hire.status);
    }
    setLoading(false);

    // Load the worker's public profile (bio + rating) and reviews (tied to the
    // worker, across all their posts) so a client can judge them before hiring.
    if (result.post) {
      const [profile, workerReviews] = await Promise.all([
        getPublicWorkerProfile(result.post.worker_id),
        fetchReviews(result.post.worker_id),
      ]);
      setWorkerProfile(profile);
      setReviews(workerReviews);
    }
    setReviewsLoading(false);
  }, [id]);

  // Reload on focus so slot counts / request state refresh after returning from
  // the hire form.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Skill Post' }} />
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  // Guard: missing/blocked post reads as a friendly message, never a crash.
  if (!post) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Skill Post' }} />
        <Text variant="bodyMedium">{error ?? 'This post is no longer available.'}</Text>
      </SafeAreaView>
    );
  }

  const isOwner = currentUserId !== null && currentUserId === post.worker_id;
  const isFull = post.slots_filled >= post.total_slots;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Skill Post' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="headlineSmall" style={styles.title}>
          {post.ai_title}
        </Text>
        <Text variant="bodyMedium" style={styles.summary}>
          {post.ai_short_description}
        </Text>

        <Card style={styles.card} mode="elevated">
          <Card.Content>
            <Row icon="reader-outline" label="Description" value={post.description} />
            <Row icon="time-outline" label="Experience" value={post.experience_length} />
            <Row
              icon="people-outline"
              label="Slots"
              value={`${post.slots_filled}/${post.total_slots} filled`}
            />
            {/* Price is shown only to the owner (clients never receive it). */}
            {post.pricing_rate !== null && post.pricing_rate !== undefined ? (
              <Row
                icon="pricetag-outline"
                label="Pricing rate"
                value={formatPeso(post.pricing_rate)}
              />
            ) : null}

            {/* The Hire action lives inside the description card (clients only). */}
            {!isOwner ? (
              <HireButton
                full={isFull}
                status={existingStatus}
                onPress={() => router.push({ pathname: '/hire/[postId]', params: { postId: post.id } })}
              />
            ) : null}
          </Card.Content>
        </Card>

        {/* About the worker: their bio, rating and service area, shown just above
            the reviews so a client can size up who they'd hire. */}
        {workerProfile ? (
          <Card style={[styles.card, styles.aboutCard]} mode="elevated">
            <Card.Content>
              <View style={styles.aboutHeader}>
                <PlaceholderImage
                  label={initials(workerProfile.full_name ?? post.worker_name)}
                  uri={workerProfile.avatar_url}
                  width={48}
                  height={48}
                  borderRadius={24}
                />
                <View style={styles.aboutHeaderBody}>
                  <Text variant="titleMedium" numberOfLines={1} style={styles.aboutName}>
                    {workerProfile.full_name
                      ? toTitleCase(workerProfile.full_name)
                      : post.worker_name ?? 'Worker'}
                  </Text>
                </View>
              </View>

              {workerProfile.bio?.trim() ? (
                <Row icon="reader-outline" label="Bio" value={workerProfile.bio.trim()} />
              ) : null}
              {post.worker_location ? (
                <Row icon="location-outline" label="Based in" value={post.worker_location} />
              ) : null}
            </Card.Content>
          </Card>
        ) : null}

        {/* Reviews (Part 4): read-only list of this worker's past ratings, so a
            client can judge them before hiring. Shows "No reviews yet" if empty. */}
        <View style={styles.reviews}>
          <View style={styles.reviewsHeader}>
            <Text variant="titleMedium" style={styles.reviewsTitle}>
              Reviews
            </Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={14} color={colors.star} />
              <Text variant="bodySmall" style={styles.ratingText}>
                {workerProfile && workerProfile.rating_count > 0
                  ? `${Number(workerProfile.rating_avg ?? 0).toFixed(1)} (${workerProfile.rating_count} review${
                      workerProfile.rating_count === 1 ? '' : 's'
                    })`
                  : 'No ratings yet'}
              </Text>
            </View>
          </View>
          <ReviewsList reviews={reviews} loading={reviewsLoading} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// The bubbly, gradient Hire button. Renders a flat disabled pill when the post
// is full or the client already has an active request, so the state is obvious.
function HireButton({
  full,
  status,
  onPress,
}: {
  full: boolean;
  status: HireStatus | null;
  onPress: () => void;
}) {
  // Guard: a fully-booked post cannot be hired — show it and disable.
  if (full && !status) {
    return <DisabledPill icon="lock-closed-outline" label="Fully booked" />;
  }
  // Guard: a client with an in-flight request can't send another.
  if (status === HIRE_STATUS.PENDING) return <DisabledPill icon="time-outline" label="Request pending" />;
  if (status === HIRE_STATUS.ACCEPTED) return <DisabledPill icon="checkmark-circle-outline" label="Request accepted" />;
  if (status === HIRE_STATUS.IN_PROGRESS) return <DisabledPill icon="sync-outline" label="Job in progress" />;

  return (
    <Pressable onPress={onPress} style={styles.hirePressable} accessibilityRole="button">
      <LinearGradient
        colors={[colors.primary, colors.primaryAccent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hireGradient}
      >
        <Ionicons name="briefcase" size={18} color={colors.onPrimary} />
        <Text style={styles.hireLabel}>Hire</Text>
      </LinearGradient>
    </Pressable>
  );
}

function DisabledPill({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={[styles.hireGradient, styles.hireDisabled]}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={[styles.hireLabel, styles.hireDisabledLabel]}>{label}</Text>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.textMuted} style={styles.rowIcon} />
      <View style={styles.rowBody}>
        <Text variant="bodySmall" style={styles.rowLabel}>
          {label}
        </Text>
        <Text variant="bodyLarge">{value}</Text>
      </View>
    </View>
  );
}

function initials(name: string | null | undefined): string {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '–';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.display, color: colors.text },
  summary: { color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  aboutCard: { marginTop: spacing.xl },
  aboutHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  aboutHeaderBody: { flex: 1, gap: 2 },
  aboutName: { color: colors.primary, fontWeight: '700' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ratingText: { color: colors.textMuted },
  reviews: { marginTop: spacing.xl },
  reviewsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reviewsTitle: { fontFamily: fonts.displaySemi, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md + 2 },
  rowIcon: { marginTop: 4 },
  rowBody: { flex: 1 },
  rowLabel: { color: colors.textMuted, marginBottom: 2 },
  hirePressable: { marginTop: spacing.sm },
  hireGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    ...shadow.floating,
  },
  hireDisabled: { backgroundColor: colors.surfaceMuted, marginTop: spacing.sm, shadowOpacity: 0, elevation: 0 },
  hireLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.onPrimary },
  hireDisabledLabel: { color: colors.textMuted },
});
