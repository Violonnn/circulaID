import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors, fonts, radius, spacing } from '../../lib/theme';

// Icon per hire-status filter. 'all' gets a neutral grid; the rest mirror the
// lifecycle (clock -> check -> spinner -> receipt). Colour stays minimal: a
// single accent (blue) marks the selected tab; everything else is grey.
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  all: 'apps-outline',
  pending: 'time-outline',
  accepted: 'checkmark-circle-outline',
  in_progress: 'sync-outline',
  paid: 'receipt-outline',
  rejected: 'close-circle-outline',
};

const ACCENT = colors.primary;

type Filter = { key: string; label: string };

type Props = {
  filters: Filter[];
  selected: string;
  onSelect: (key: string) => void;
};

// Horizontal segmented-style tabs for the Hires status flow. Purely
// presentational — the parent keeps the filter state and data logic.
export default function StatusTabs({ filters, selected, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {filters.map((item) => {
        const active = selected === item.key;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Ionicons
              name={ICONS[item.key] ?? 'ellipse-outline'}
              size={15}
              color={active ? ACCENT : colors.textMuted}
            />
            <Text style={[styles.label, active && styles.labelActive]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: { backgroundColor: colors.primarySoft, borderColor: ACCENT },
  label: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.bodyBold },
  labelActive: { color: ACCENT },
});
