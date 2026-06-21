import React, { useState } from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Modal, Portal, Text, TextInput } from 'react-native-paper';
import { colors, fonts, radius, shadow, spacing } from '../../lib/theme';

type Props = {
  label: string;
  // Stored as a 24h "HH:MM" string, or '' when nothing is chosen.
  value: string;
  onChange: (value: string) => void;
  // The chosen date ("yyyy-mm-dd"); when it's today, past time slots are hidden.
  date: string;
  style?: StyleProp<ViewStyle>;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Half-hour slots from 7:00 AM to 8:00 PM as { value: "HH:MM", label: "h:mm AM" }.
function buildSlots(): { value: string; label: string }[] {
  const slots: { value: string; label: string }[] = [];
  for (let h = 7; h <= 20; h++) {
    for (const m of [0, 30]) {
      if (h === 20 && m === 30) continue;
      slots.push({
        value: `${pad2(h)}:${pad2(m)}`,
        label: new Date(2000, 0, 1, h, m).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
      });
    }
  }
  return slots;
}

const SLOTS = buildSlots();

// A bubbly grid of time-slot chips in a Paper Modal. When the chosen date is
// today, slots earlier than "now" are dropped so a past time can't be picked.
export default function TimeField({ label, value, onChange, date, style }: Props) {
  const [visible, setVisible] = useState(false);

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const isToday = date === todayKey;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const slots = SLOTS.filter((slot) => {
    if (!isToday) return true;
    const [h, m] = slot.value.split(':').map(Number);
    return h * 60 + m > nowMinutes;
  });

  const selected = SLOTS.find((s) => s.value === value);

  function selectSlot(slotValue: string) {
    onChange(slotValue);
    setVisible(false);
  }

  return (
    <View style={style}>
      <Pressable onPress={() => setVisible(true)}>
        <View pointerEvents="none">
          <TextInput
            label={label}
            mode="outlined"
            value={selected ? selected.label : ''}
            editable={false}
            placeholder="Pick a time"
            left={<TextInput.Icon icon="clock-outline" />}
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
          <Text style={styles.heading}>{label}</Text>
          {slots.length === 0 ? (
            <Text style={styles.empty}>No more time slots today. Please pick another date.</Text>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.grid}>
              {slots.map((slot) => {
                const isSelected = slot.value === value;
                return (
                  <Pressable
                    key={slot.value}
                    onPress={() => selectSlot(slot.value)}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {slot.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
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
  heading: { fontFamily: fonts.displaySemi, fontSize: 18, color: colors.text, marginBottom: spacing.md },
  empty: { fontFamily: fonts.body, color: colors.textMuted },
  scroll: { maxHeight: 320 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySofter,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.onPrimary, fontFamily: fonts.bodyBold },
});
