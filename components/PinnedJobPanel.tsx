import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { formatDateTime, toTitleCase } from '../lib/format';
import type { HireContext } from '../lib/hireRequests';
import { colors, spacing } from '../lib/theme';

// "<Name> · <phone>" for a party row, with guards for a missing name/phone.
function contactLine(name: string | null, phone: string | null): string {
  const who = name ? toTitleCase(name) : 'Not available';
  return `${who} · ${phone?.trim() ? phone : 'No phone number'}`;
}

// Toggleable, READ-ONLY job context pinned to the top of the locked chat. It is
// collapsed by default (just a lock icon + the job title); tapping the header
// expands it to show the schedule, work-site location and description. All
// content is passed in from the hire_requests row the chat is linked to — it is
// never hardcoded here or duplicated into the chat/message tables.
export default function PinnedJobPanel({ context }: { context: HireContext | null }) {
  const [expanded, setExpanded] = useState(false);

  // Guard: no linked hire context -> nothing to pin.
  if (!context) return null;

  return (
    <Surface style={styles.panel} elevation={0}>
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        style={styles.headerRow}
        accessibilityRole="button"
        accessibilityLabel="Toggle job details"
      >
        <Ionicons name="lock-closed" size={14} color={colors.primary} />
        <Text variant="bodyMedium" numberOfLines={1} style={styles.title}>
          {context.post_title ?? 'Hire job'}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          <Row icon="calendar-outline" text={formatDateTime(context.scheduled_at) || 'No date set'} />
          <Row icon="location-outline" text={context.client_location ?? 'No location given'} />
          {/* Description is optional, so only render the row when present. */}
          {context.details ? <Row icon="reader-outline" text={context.details} /> : null}
          {/* The two parties' contact details (name + phone), so the worker and
              client can reach each other about this job. */}
          <Row
            icon="briefcase-outline"
            text={`Service Provider: ${contactLine(context.worker_name, context.worker_phone)}`}
          />
          <Row
            icon="person-outline"
            text={`Client: ${contactLine(context.client_name, context.client_phone)}`}
          />
        </View>
      ) : null}
    </Surface>
  );
}

function Row({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={16} color={colors.textMuted} style={styles.rowIcon} />
      <Text variant="bodySmall" style={styles.rowText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.primarySofter,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryBorder,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  title: { flex: 1, color: colors.text, fontWeight: '700' },
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowIcon: { marginTop: 2 },
  rowText: { flex: 1, color: colors.textMuted },
});
