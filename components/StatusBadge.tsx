import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet } from 'react-native';
import { Chip } from 'react-native-paper';
import { colors, fonts, radius } from '../lib/theme';

// Small colored chip used to show a post or hire status consistently across the
// app. Unknown statuses fall back to a neutral gray so nothing ever renders blank.
// Green/amber/red keep their semantic meaning; the generic "active" states
// (accepted / in_progress) use the brand purple family to stay on-theme.
const COLORS: Record<string, { bg: string; text: string }> = {
  open: { bg: '#DCFCE7', text: '#166534' },
  full: { bg: '#FEF9C3', text: '#854D0E' },
  archived: { bg: colors.surfaceMuted, text: colors.textMuted },
  deleted: { bg: '#FEE2E2', text: '#991B1B' },
  pending: { bg: '#FEF9C3', text: '#854D0E' },
  accepted: { bg: colors.infoSoft, text: colors.info },
  in_progress: { bg: colors.primarySoft, text: colors.primaryDark },
  completed: { bg: '#DCFCE7', text: '#166534' },
  paid: { bg: '#D1FAE5', text: '#065F46' },
  cancelled: { bg: '#FEE2E2', text: '#991B1B' },
  rejected: { bg: '#FEE2E2', text: '#991B1B' },
};

// One Ionicon per status so the badge reads at a glance, not just by color.
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  open: 'lock-open-outline',
  full: 'people-outline',
  archived: 'archive-outline',
  deleted: 'trash-outline',
  pending: 'time-outline',
  accepted: 'checkmark-circle-outline',
  in_progress: 'sync-outline',
  completed: 'checkmark-done-outline',
  paid: 'receipt-outline',
  cancelled: 'close-circle-outline',
  rejected: 'close-circle-outline',
};

// Turn 'in_progress' into 'In Progress' for display.
function toLabel(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function StatusBadge({ status }: { status: string }) {
  const palette = COLORS[status] ?? { bg: colors.surfaceMuted, text: colors.textMuted };
  const iconName = ICONS[status] ?? 'ellipse-outline';
  return (
    <Chip
      compact
      icon={() => <Ionicons name={iconName} size={14} color={palette.text} />}
      style={[styles.chip, { backgroundColor: palette.bg }]}
      textStyle={{ color: palette.text, fontSize: 12, fontFamily: fonts.bodyBold }}
    >
      {toLabel(status)}
    </Chip>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', borderRadius: radius.pill },
});
