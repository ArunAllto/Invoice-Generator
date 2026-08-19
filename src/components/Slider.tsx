/**
 * A minimal slider.
 *
 * §7.2 asks for a threshold slider with live preview. React Native has no built-in slider
 * and §3.1 forbids adding a dependency for one, so this is a small `PanResponder` track —
 * about forty lines, and it keeps the interaction the spec actually asked for rather than
 * substituting stepped buttons.
 *
 * The thumb is 28dp inside a 44dp-tall touch area, satisfying §11's target size.
 */

import React, { useCallback, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { palette, radius, TOUCH_TARGET } from '../theme';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  minimum?: number;
  maximum?: number;
  /** Snap increment. 0 means continuous. */
  step?: number;
  accentColor?: string;
  accessibilityLabel: string;
}

export function Slider({
  value,
  onChange,
  minimum = 0,
  maximum = 1,
  step = 0,
  accentColor,
  accessibilityLabel,
}: SliderProps): React.ReactElement {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const accent = accentColor ?? palette.navy;

  const emit = useCallback(
    (x: number) => {
      const trackWidth = widthRef.current;
      if (trackWidth <= 0) return;
      const ratio = Math.min(1, Math.max(0, x / trackWidth));
      let next = minimum + ratio * (maximum - minimum);
      if (step > 0) next = Math.round(next / step) * step;
      onChange(Math.min(maximum, Math.max(minimum, next)));
    },
    [maximum, minimum, onChange, step],
  );

  // Created once: a PanResponder rebuilt on every render loses the in-flight gesture.
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => emit(event.nativeEvent.locationX),
      onPanResponderMove: (event) => emit(event.nativeEvent.locationX),
    }),
  ).current;

  const onLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    widthRef.current = next;
    setWidth(next);
  };

  const ratio = maximum === minimum ? 0 : (value - minimum) / (maximum - minimum);
  const thumbLeft = Math.min(width - 28, Math.max(0, ratio * width - 14));

  return (
    <View
      style={styles.container}
      onLayout={onLayout}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: minimum, max: maximum, now: value }}
      {...responder.panHandlers}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: accent }]} />
      </View>
      <View style={[styles.thumb, { left: thumbLeft, borderColor: accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: TOUCH_TARGET, justifyContent: 'center' },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.surfaceSunken,
    overflow: 'hidden',
  },
  fill: { height: 6 },
  thumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
  },
});
