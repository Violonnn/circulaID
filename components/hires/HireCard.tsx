import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text } from 'react-native-paper';
import PlaceholderImage from '../PlaceholderImage';
import StatusBadge from '../StatusBadge';
import { colors, radius, shadow, spacing } from '../../lib/theme';

export type HireMeta = { icon: keyof typeof Ionicons.glyphMap; text: string };

type Props = {
  title: string;
  // e.g. "Worker: Mark" or "Juan Dela Cruz · #1234abcd".
  subtitle: string;
  status: string;
  // Source for the round avatar initials; falls back to the title.
  avatarLabel?: string | null;
  // Public URL of the counterparty's profile photo; falls back to initials.
  avatarUri?: string | null;
  // Extra labeled rows (date/time, location, etc.) shown under the subtitle.
  meta?: HireMeta[];
  // Action buttons / notes the parent renders. Kept as a render slot so all
  // data/state logic stays in the parent screen.
  children?: React.ReactNode;
};

function initials(value: string | null | undefined): string {
  if (!value) return '–';
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '–';
}

// Shared presentational card for a single hire, laid out as a ROW: a round
// avatar on the left, then the title + counterparty + meta on the right with the
// status badge aligned to the title. Actions render full-width underneath.
export default function HireCard({ title, subtitle, status, avatarLabel, avatarUri, meta, children }: Props) {
  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content style={styles.content}>
        <View style={styles.row}>
          <PlaceholderImage
            label={initials(avatarLabel ?? subtitle ?? title)}
            uri={avatarUri}
            width={52}
            height={52}
            borderRadius={26}
          />
          <View style={styles.body}>
            <View style={styles.headerRow}>
              <Text variant="titleMedium" numberOfLines={2} style={styles.title}>
                {title}
              </Text>
              <StatusBadge status={status} />
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="person-outline" size={14} color={colors.textMuted} />
              <Text variant="bodySmall" style={styles.meta} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            {(meta ?? []).map((item, idx) => (
              <View key={`${item.icon}-${idx}`} style={styles.metaRow}>
                <Ionicons name={item.icon} size={14} color={colors.textMuted} />
                <Text variant="bodySmall" style={styles.meta} numberOfLines={2}>
                  {item.text}
                </Text>
              </View>
            ))}
          </View>
        </View>
        {children}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  content: { paddingVertical: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  body: { flex: 1, gap: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  title: { flex: 1, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  meta: { color: colors.textMuted, flex: 1 },
});
