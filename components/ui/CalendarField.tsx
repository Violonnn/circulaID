import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Modal, Portal, Text, TextInput } from 'react-native-paper';
import { colors, fonts, radius, shadow, spacing } from '../../lib/theme';

type Props = {
  label: string;
  // Stored as a local "yyyy-mm-dd" string, or '' when nothing is chosen.
  value: string;
  onChange: (value: string) => void;
  style?: StyleProp<ViewStyle>;
};

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Local yyyy-mm-dd key from a (year, 0-based month, day).
function toKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

// Midnight today, in LOCAL time — the earliest date a client may pick.
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// A soft, bubbly month calendar in a Paper Modal. Past days are disabled so the
// client can never schedule a hire before today (the form re-checks too).
export default function CalendarField({ label, value, onChange, style }: Props) {
  const today = startOfToday();
  const [visible, setVisible] = useState(false);

  const initial = value ? new Date(`${value}T00:00:00`) : today;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // We never page earlier than the current month (no past months to choose).
  const canGoPrev =
    viewYear > today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth > today.getMonth());

  function prevMonth() {
    if (!canGoPrev) return;
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
      return;
    }
    setViewMonth(viewMonth - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
      return;
    }
    setViewMonth(viewMonth + 1);
  }

  function selectDay(day: number) {
    const picked = new Date(viewYear, viewMonth, day);
    // Guard: past days are disabled, but block here too as defense in depth.
    if (picked < today) return;
    onChange(toKey(viewYear, viewMonth, day));
    setVisible(false);
  }

  const displayLabel = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  return (
    <View style={style}>
      <Pressable onPress={() => setVisible(true)}>
        {/* pointerEvents none lets the tap reach the Pressable, not the field. */}
        <View pointerEvents="none">
          <TextInput
            label={label}
            mode="outlined"
            value={displayLabel}
            editable={false}
            placeholder="Pick a date"
            left={<TextInput.Icon icon="calendar-blank-outline" />}
            right={<TextInput.Icon icon="menu-down" />}
            outlineStyle={styles.fieldOutline}
            style={styles.field}
          />
        </View>
      </Pressable>

      <Portal>
        <Modal
          visible={visible}
          onDismiss={() => setVisible(false)}
          contentContainerStyle={styles.modal}
        >
          <View style={styles.headerRow}>
            <Pressable onPress={prevMonth} disabled={!canGoPrev} style={styles.navBtn} hitSlop={8}>
              <Ionicons
                name="chevron-back"
                size={22}
                color={canGoPrev ? colors.primary : colors.textFaint}
              />
            </Pressable>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <Pressable onPress={nextMonth} style={styles.navBtn} hitSlop={8}>
              <Ionicons name="chevron-forward" size={22} color={colors.primary} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={styles.weekday}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, idx) => {
              if (day === null) return <View key={`empty-${idx}`} style={styles.cell} />;
              const key = toKey(viewYear, viewMonth, day);
              const past = new Date(viewYear, viewMonth, day) < today;
              const selected = key === value;
              return (
                <Pressable
                  key={key}
                  style={styles.cell}
                  onPress={() => selectDay(day)}
                  disabled={past}
                >
                  <View style={[styles.dayBubble, selected && styles.dayBubbleSelected]}>
                    <Text
                      style={[
                        styles.dayText,
                        past && styles.dayTextPast,
                        selected && styles.dayTextSelected,
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySofter,
  },
  monthLabel: { fontFamily: fonts.displaySemi, fontSize: 18, color: colors.text },
  weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.textFaint,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
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
  },
  dayBubbleSelected: { backgroundColor: colors.primary },
  dayText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.text },
  dayTextPast: { color: colors.textFaint, opacity: 0.45 },
  dayTextSelected: { color: colors.onPrimary, fontFamily: fonts.bodyBold },
});
