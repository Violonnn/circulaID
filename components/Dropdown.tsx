import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Menu, TextInput } from 'react-native-paper';

export type DropdownOption = { label: string; value: string };

type Props = {
  label: string;
  // Currently selected option value ('' means nothing chosen yet).
  value: string;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  // Lets the caller size the field (e.g. inside a row of dropdowns).
  style?: StyleProp<ViewStyle>;
};

// Cap the menu width so it drops down at the END (right edge) of the field,
// instead of stretching across the whole input container.
const MENU_MAX_WIDTH = 240;

// A simple select box made from Paper's Menu + TextInput, since Paper has no
// dedicated dropdown. The TextInput is read-only and just shows the choice.
export default function Dropdown({ label, value, options, onSelect, style }: Props) {
  const [visible, setVisible] = useState(false);
  // The field's on-screen rect, captured on open so the menu can be positioned
  // right-aligned to the field's end edge.
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const fieldRef = useRef<View>(null);

  const selected = options.find((option) => option.value === value);

  // Measure the field in window coordinates, then open the menu anchored to the
  // bottom-right of the field (flex end), not stretched across the full width.
  function open() {
    fieldRef.current?.measureInWindow((x, y, width, height) => {
      setRect({ x, y, width, height });
      setVisible(true);
    });
  }

  // Keep the menu within the field width when the field is narrower than the cap.
  const menuWidth = rect.width ? Math.min(rect.width, MENU_MAX_WIDTH) : MENU_MAX_WIDTH;

  return (
    <View style={style}>
      <Pressable ref={fieldRef} onPress={open}>
        {/* pointerEvents="none" lets the tap fall through to the Pressable
            instead of the read-only TextInput, so the menu opens. */}
        <View pointerEvents="none">
          <TextInput
            label={label}
            mode="outlined"
            value={selected ? selected.label : ''}
            editable={false}
            right={<TextInput.Icon icon="menu-down" />}
          />
        </View>
      </Pressable>

      <Menu
        visible={visible}
        onDismiss={() => setVisible(false)}
        // Right-align: the menu's right edge lines up with the field's end.
        anchor={{ x: rect.x + rect.width - menuWidth, y: rect.y + rect.height }}
        style={{ width: menuWidth }}
      >
        <ScrollView style={styles.list}>
          {options.map((option) => (
            <Menu.Item
              key={option.value}
              title={option.label}
              onPress={() => {
                onSelect(option.value);
                setVisible(false);
              }}
            />
          ))}
        </ScrollView>
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 300 },
});
