import React, { useState } from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Button, Modal, Portal, Text, TextInput } from 'react-native-paper';
import { daysInMonth, monthLabel, MONTH_OPTIONS, YEAR_OPTIONS } from '../../lib/birthdate';
import { colors, fonts, radius, shadow, spacing } from '../../lib/theme';

type Props = {
  label: string;
  // Current parts as strings ('' when unset): month "1".."12", day "1".."31",
  // year "1998". Kept as separate strings so the screen's existing validation
  // (Number(year), isRealDate, age) needs no changes.
  month: string;
  day: string;
  year: string;
  onChange: (month: string, day: string, year: string) => void;
  style?: StyleProp<ViewStyle>;
};

// Short month chips so all 12 fit a tidy grid.
const MONTH_CHIPS = MONTH_OPTIONS.map((m) => ({ value: m.value, label: m.label.slice(0, 3) }));

// A soft, bubbly date-of-birth picker that mirrors the CalendarField look (Paper
// modal, pill bubbles, primary-colored selection) instead of plain dropdowns.
// Month / Year / Day are chosen as bubbles; the day grid clamps to the days that
// actually exist in the chosen month + year (so Feb 30 can never be picked).
export default function BirthDateField({ label, month, day, year, onChange, style }: Props) {
  const [visible, setVisible] = useState(false);
  const [draftMonth, setDraftMonth] = useState(month);
  const [draftDay, setDraftDay] = useState(day);
  const [draftYear, setDraftYear] = useState(year);

  function open() {
    // Start the draft from the committed value each time it opens.
    setDraftMonth(month);
    setDraftDay(day);
    setDraftYear(year);
    setVisible(true);
  }

  // How many days exist for the current draft month/year (defaults to 31 until
  // both are chosen, so every day is selectable up front).
  const maxDay =
    draftMonth && draftYear ? daysInMonth(Number(draftYear), Number(draftMonth)) : 31;
  const dayCells = Array.from({ length: 31 }, (_, i) => i + 1);

  function pickDay(d: number) {
    if (d > maxDay) return;
    setDraftDay(String(d));
  }

  const canConfirm = !!draftMonth && !!draftDay && !!draftYear && Number(draftDay) <= maxDay;

  function confirm() {
    if (!canConfirm) return;
    onChange(draftMonth, draftDay, draftYear);
    setVisible(false);
  }

  const displayLabel =
    month && day && year ? `${monthLabel(Number(month))} ${Number(day)}, ${year}` : '';

  return (
    <View style={style}>
      <Pressable onPress={open}>
        {/* pointerEvents none lets the tap reach the Pressable, not the field. */}
        <View pointerEvents="none">
          <TextInput
            label={label}
            mode="outlined"
            value={displayLabel}
            editable={false}
            placeholder="Pick your birth date"
            left={<TextInput.Icon icon="cake-variant-outline" />}
            right={<TextInput.Icon icon="menu-down" />}
            outlineStyle={styles.fieldOutline}
            style={styles.field}
          />
        </View>
      </Pressable>

      <Portal>
        <Modal visible={visible} onDismiss={() => setVisible(false)} contentContainerStyle={styles.modal}>
          <Text style={styles.title}>Date of Birth</Text>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Month — a 4-column grid of bubbly chips. */}
            <Text style={styles.sectionLabel}>Month</Text>
            <View style={styles.monthGrid}>
              {MONTH_CHIPS.map((m) => {
                const selected = m.value === draftMonth;
                return (
                  <Pressable
                    key={m.value}
                    onPress={() => setDraftMonth(m.value)}
                    style={[styles.monthChip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Year — a horizontal rail of pills (newest first). */}
            <Text style={styles.sectionLabel}>Year</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.yearRail}
            >
              {YEAR_OPTIONS.map((y) => {
                const selected = y.value === draftYear;
                return (
                  <Pressable
                    key={y.value}
                    onPress={() => setDraftYear(y.value)}
                    style={[styles.yearPill, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{y.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Day — a 7-column bubble grid (calendar-like); invalid days dim out. */}
            <Text style={styles.sectionLabel}>Day</Text>
            <View style={styles.dayGrid}>
              {dayCells.map((d) => {
                const disabled = d > maxDay;
                const selected = String(d) === draftDay;
                return (
                  <Pressable
                    key={d}
                    style={styles.dayCell}
                    onPress={() => pickDay(d)}
                    disabled={disabled}
                  >
                    <View style={[styles.dayBubble, selected && styles.chipSelected]}>
                      <Text
                        style={[
                          styles.dayText,
                          disabled && styles.dayTextDisabled,
                          selected && styles.chipTextSelected,
                        ]}
                      >
                        {d}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <Button
            mode="contained"
            onPress={confirm}
            disabled={!canConfirm}
            style={styles.confirm}
            contentStyle={styles.confirmContent}
          >
            Set date
          </Button>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { backgroundColor: colors.surface },
  fieldOutline: { borderRadius: radius.md },
  modal: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.xl,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadow.floating,
  },
  title: { fontFamily: fonts.displaySemi, fontSize: 18, color: colors.text, marginBottom: spacing.sm },
  scroll: { maxHeight: 380 },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.textFaint,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  monthChip: {
    width: '22%',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: colors.primarySofter,
  },
  yearRail: { gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.sm },
  yearPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySofter,
  },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.onPrimary, fontFamily: fonts.bodyBold },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  dayBubble: {
    width: '88%',
    aspectRatio: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySofter,
  },
  dayText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text },
  dayTextDisabled: { color: colors.textFaint, opacity: 0.4 },
  confirm: { borderRadius: radius.pill, marginTop: spacing.lg },
  confirmContent: { paddingVertical: spacing.xs },
});
