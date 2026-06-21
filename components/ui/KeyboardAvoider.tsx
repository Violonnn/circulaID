import { useHeaderHeight } from '@react-navigation/elements';
import React from 'react';
import { KeyboardAvoidingView, Platform, StyleProp, ViewStyle } from 'react-native';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  // Extra pixels to add on top of the measured header height, if a screen needs it.
  extraOffset?: number;
};

// One consistent keyboard behavior for the whole app. The app runs edge-to-edge
// on Android, where the keyboard otherwise covers bottom-anchored inputs (e.g.
// the chat composer). Using `padding` on BOTH platforms plus the real header
// height as the vertical offset keeps inputs visible above the keyboard. Must be
// rendered inside a screen that has a navigation header (so useHeaderHeight is
// available) — every screen that uses it does.
export default function KeyboardAvoider({ children, style, extraOffset = 0 }: Props) {
  const headerHeight = useHeaderHeight();
  return (
    <KeyboardAvoidingView
      style={style}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight + extraOffset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
