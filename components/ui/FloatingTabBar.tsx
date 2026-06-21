import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, spacing } from '../../lib/theme';

const BAR_HEIGHT = 68;
const PILL_HEIGHT = 54;
const EDGE_PADDING = 6;
const GAP = 8; // breathing room between the bubble and the tab edges

// Custom, detached/floating bottom tab bar. A bold purple "bubble" springs (with
// a lively overshoot) to whichever tab is active, wrapping its icon + label,
// while the icon pops. All navigation behaviour mirrors the React Navigation
// default — this only changes how the bar looks and animates, never the routing.
// `hiddenRouteNames` lets the layout hide tabs per role (e.g. "hires" in the
// worker view). It's an extra prop on top of the standard tab bar props.
type Props = BottomTabBarProps & { hiddenRouteNames?: string[] };

export default function FloatingTabBar({
  state,
  descriptors,
  navigation,
  hiddenRouteNames = [],
}: Props) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);

  // Hide any route named in hiddenRouteNames so it renders no tab. We keep the
  // pops array keyed by the ORIGINAL route index (a stable length) so animations
  // don't break when the visible set changes; only the bubble layout uses the
  // visible routes/positions.
  const visibleRoutes = state.routes.filter(
    (route) => !hiddenRouteNames.includes(route.name)
  );
  const count = visibleRoutes.length;
  const tabWidth = barWidth > 0 ? (barWidth - EDGE_PADDING * 2) / count : 0;

  // Position of the active route WITHIN the visible set (drives the bubble).
  const activePos = Math.max(
    0,
    visibleRoutes.findIndex((route) => route.key === state.routes[state.index]?.key)
  );

  // Drives the bubble's horizontal position and each icon's pop animation.
  const indicatorX = useRef(new Animated.Value(0)).current;
  const pops = useRef(state.routes.map((_, i) => new Animated.Value(i === state.index ? 1 : 0))).current;

  useEffect(() => {
    if (tabWidth <= 0) return;
    // Loose, bouncy spring so the bubble glides and gently overshoots.
    Animated.spring(indicatorX, {
      toValue: activePos * tabWidth,
      useNativeDriver: true,
      friction: 6,
      tension: 60,
    }).start();

    state.routes.forEach((_, i) => {
      Animated.spring(pops[i], {
        toValue: i === state.index ? 1 : 0,
        useNativeDriver: true,
        friction: 5,
        tension: 130,
      }).start();
    });
  }, [state.index, activePos, tabWidth, indicatorX, pops, state.routes]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, spacing.sm) + spacing.md }]}
    >
      <View style={styles.bar} onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}>
        {/* The floating bubble that slides + bounces between tabs. */}
        {tabWidth > 0 ? (
          <Animated.View
            style={[
              styles.indicator,
              {
                width: tabWidth - GAP,
                transform: [{ translateX: Animated.add(indicatorX, EDGE_PADDING + GAP / 2) }],
              },
            ]}
          />
        ) : null}

        {visibleRoutes.map((route) => {
          // Original index into state.routes, so pops[index] stays correct even
          // when some routes are hidden.
          const index = state.routes.findIndex((r) => r.key === route.key);
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title ?? route.name;
          const tint = isFocused ? colors.onPrimary : colors.textFaint;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          const scale = pops[index].interpolate({
            inputRange: [0, 1],
            outputRange: [1, 1.22],
          });
          const lift = pops[index].interpolate({
            inputRange: [0, 1],
            outputRange: [0, -3],
          });

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.tab}
            >
              <Animated.View style={{ transform: [{ scale }, { translateY: lift }] }}>
                {options.tabBarIcon
                  ? options.tabBarIcon({ focused: isFocused, color: tint, size: 24 })
                  : null}
              </Animated.View>
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  { color: tint, fontFamily: isFocused ? fonts.bodyBold : fonts.bodyMedium },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BAR_HEIGHT,
    paddingHorizontal: EDGE_PADDING,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    // Deep, soft purple glow so the bar reads as clearly lifted off the screen.
    shadowColor: '#3A0B45',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  indicator: {
    position: 'absolute',
    left: 0,
    top: (BAR_HEIGHT - PILL_HEIGHT) / 2,
    height: PILL_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    // The bubble itself gets a little colored shadow to feel like it pops out.
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  tab: {
    flex: 1,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    fontSize: 11,
  },
});
