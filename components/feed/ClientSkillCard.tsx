import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text } from 'react-native-paper';
import PlaceholderImage from '../PlaceholderImage';
import { formatPeso } from '../../lib/format';
import { type ClientSkillPost } from '../../lib/workerPosts';
import { colors, radius, shadow, spacing } from '../../lib/theme';

// Initials for the placeholder avatar, derived from the poster's name
// (e.g. "Mark Antonio" -> "MA"). A real photo upload is a future feature.
function initials(name: string | null): string {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '–';
}

// A client-feed card for one worker skill post. Mirrors the worker's own Job
// card (AI title + short description + slot count) but adds the poster's profile
// picture and never shows the (hidden) price.
// Star icons for an average rating, rounded to the nearest half. Renders 5
// Ionicons (full / half / empty) so e.g. 4.5 shows four solid stars + one half.
function StarRow({ avg }: { avg: number }) {
  const rounded = Math.round(avg * 2) / 2;
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((slot) => {
        const name =
          rounded >= slot ? 'star' : rounded >= slot - 0.5 ? 'star-half' : 'star-outline';
        return <Ionicons key={slot} name={name} size={13} color={colors.star} />;
      })}
    </View>
  );
}

export default function ClientSkillCard({
  post,
  reviewCount = 0,
  reviewAvg = 0,
  onPress,
}: {
  post: ClientSkillPost;
  // Worker's total review count (across all their posts). Guarded so 0 reads as
  // "No reviews yet" rather than a bare "(0 reviews)".
  reviewCount?: number;
  // Worker's accumulated average rating (0 when there are no reviews yet).
  reviewAvg?: number;
  onPress: () => void;
}) {
  const reviewLabel =
    reviewCount > 0
      ? `${reviewCount} review${reviewCount === 1 ? '' : 's'}`
      : 'No reviews yet';
  return (
    <Card style={styles.card} onPress={onPress} mode="elevated">
      <Card.Content style={styles.content}>
        {/* Top row: poster avatar + name + total review count. */}
        <View style={styles.headerRow}>
          <PlaceholderImage
            label={initials(post.worker_name)}
            uri={post.worker_avatar_url}
            width={56}
            height={56}
            borderRadius={28}
          />
          <View style={styles.headerText}>
            <Text variant="titleSmall" numberOfLines={1} style={styles.name}>
              {post.worker_name ?? 'Service Provider'}
            </Text>
            <View style={styles.reviewRow}>
              {/* 0 reviews -> 5 outline stars so we never imply a fake rating. */}
              <StarRow avg={reviewCount > 0 ? reviewAvg : 0} />
              <Text variant="bodySmall" style={styles.reviewText}>
                {reviewLabel}
              </Text>
            </View>
          </View>
        </View>

        <Text variant="titleLarge" numberOfLines={2} style={styles.title}>
          {post.ai_title}
        </Text>
        <Text variant="bodyMedium" numberOfLines={3} style={styles.summary}>
          {post.ai_short_description}
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="people-outline" size={16} color={colors.textMuted} />
            <Text variant="bodyMedium" style={styles.meta}>
              {post.slots_filled}/{post.total_slots} filled
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={16} color={colors.textMuted} />
            <Text variant="bodyMedium" style={styles.meta}>
              {post.experience_length}
            </Text>
          </View>
          {/* Price is a STARTING reference only (the charged amount is negotiated
              in chat). Guard: a missing price shows "Rate on request". */}
          <Text variant="bodyMedium" style={styles.price} numberOfLines={1}>
            {post.starting_rate != null
              ? `Starting at ${formatPeso(post.starting_rate)}`
              : 'Rate on request'}
          </Text>
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  content: { paddingVertical: spacing.lg, gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  name: { color: colors.primary, fontWeight: '700' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  reviewText: { color: colors.textMuted },
  title: { fontWeight: '700', marginTop: spacing.xs },
  summary: { color: colors.textMuted, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.xs },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { color: colors.textMuted },
  // Pushed to flex-end of the metadata row.
  price: { marginLeft: 'auto', color: colors.primaryAccent, fontWeight: '700' },
});
