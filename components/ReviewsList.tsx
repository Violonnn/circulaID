import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import PlaceholderImage from './PlaceholderImage';
import { toTitleCase } from '../lib/format';
import type { Review } from '../lib/ratings';
import { colors, fonts, spacing } from '../lib/theme';

// Initials for the avatar placeholder when a reviewer has no photo yet.
function initials(name: string | null): string {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '–';
}

type Props = {
  reviews: Review[];
  loading?: boolean;
};

// Read-only list of a worker's reviews (stars + comment + date). Shown to
// clients on the post detail screen. No edit/delete here — display only.
export default function ReviewsList({ reviews, loading }: Props) {
  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  // Guard: never show a blank section — say so explicitly when empty.
  if (reviews.length === 0) {
    return (
      <Text variant="bodyMedium" style={styles.empty}>
        No reviews yet
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {reviews.map((review) => (
        <View key={review.id} style={styles.row}>
          <View style={styles.headerRow}>
            {/* The reviewing client's real photo + name. */}
            <PlaceholderImage
              label={initials(review.reviewer_name)}
              uri={review.reviewer_avatar_url}
              width={36}
              height={36}
              borderRadius={18}
            />
            <View style={styles.headerBody}>
              <Text variant="bodyMedium" style={styles.reviewer} numberOfLines={1}>
                {review.reviewer_name ? toTitleCase(review.reviewer_name) : 'Client'}
              </Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <MaterialCommunityIcons
                    key={value}
                    name={value <= review.rating ? 'star' : 'star-outline'}
                    size={16}
                    color={colors.star}
                  />
                ))}
                <Text variant="bodySmall" style={styles.date}>
                  {formatDate(review.created_at)}
                </Text>
              </View>
              {/* Guard: only show the "Hired for" line when the linked job title
                  is present — a missing one just hides the line, never breaks. */}
              {review.hired_for ? (
                <Text variant="bodySmall" style={styles.hiredFor} numberOfLines={1}>
                  Hired for: {review.hired_for}
                </Text>
              ) : null}
            </View>
          </View>
          {review.comment ? (
            <Text variant="bodyMedium" style={styles.comment}>
              {review.comment}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// Local short date (e.g. "Jun 21, 2026"); empty on a bad timestamp.
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  loader: { marginVertical: spacing.lg },
  empty: { color: colors.textMuted, marginTop: spacing.sm },
  list: { gap: spacing.lg, marginTop: spacing.sm },
  row: { gap: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerBody: { flex: 1, gap: 2 },
  reviewer: { color: colors.text, fontFamily: fonts.bodyBold },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  date: { color: colors.textFaint, marginLeft: spacing.sm },
  hiredFor: { color: colors.textMuted },
  comment: { color: colors.text, marginLeft: 36 + spacing.sm },
});
