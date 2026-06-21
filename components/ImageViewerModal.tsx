import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  GestureHandlerRootView,
  PinchGestureHandler,
  State,
  type PinchGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import { colors, spacing } from '../lib/theme';

const MIN_SCALE = 1;
const MAX_SCALE = 4;

// Full-screen image viewer with pinch-to-zoom, reused by the chat for tappable
// photos (the "Mark as Done" proof + any image message), on BOTH the client and
// worker sides. We use the gesture-handler PinchGestureHandler + the RN Animated
// API (no reanimated/babel plugin needed) and wrap the modal body in its own
// GestureHandlerRootView, since a Modal renders in a separate view tree.
export default function ImageViewerModal({
  visible,
  uri,
  onClose,
}: {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const lastScale = useRef(1);
  const scale = Animated.multiply(baseScale, pinchScale);

  const onPinchEvent = Animated.event([{ nativeEvent: { scale: pinchScale } }], {
    useNativeDriver: true,
  });

  // On gesture end, fold the live pinch factor into the committed scale and
  // clamp it to [1, 4] so the image can't be flicked away or inverted.
  function onPinchStateChange(event: PinchGestureHandlerStateChangeEvent) {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      let next = lastScale.current * event.nativeEvent.scale;
      next = Math.max(MIN_SCALE, Math.min(next, MAX_SCALE));
      lastScale.current = next;
      baseScale.setValue(next);
      pinchScale.setValue(1);
    }
  }

  function handleClose() {
    // Reset zoom so the next photo always opens at 1x.
    lastScale.current = 1;
    baseScale.setValue(1);
    pinchScale.setValue(1);
    onClose();
  }

  // Guard: without a uri there is nothing to show.
  if (!uri) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.backdrop}>
          <Pressable
            style={styles.closeButton}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close image"
          >
            <Ionicons name="close" size={28} color={colors.white} />
          </Pressable>

          <PinchGestureHandler
            onGestureEvent={onPinchEvent}
            onHandlerStateChange={onPinchStateChange}
          >
            <Animated.View style={[styles.center, { transform: [{ scale }] }]}>
              <Image
                source={{ uri }}
                style={{ width, height: height * 0.85 }}
                contentFit="contain"
              />
            </Animated.View>
          </PinchGestureHandler>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  closeButton: {
    position: 'absolute',
    top: spacing.xxl,
    right: spacing.lg,
    zIndex: 2,
    padding: spacing.xs,
  },
});
