import React, {useEffect, useMemo, useRef} from "react";
import {Animated, Easing, StyleSheet, View} from "react-native";

type VoiceWaveformProps = {
  active: boolean;
  bars?: number;
};

export default function VoiceWaveform({
  active,
  bars = 18,
}: VoiceWaveformProps) {
  const animations = useMemo(
    () => Array.from({length: bars}, () => new Animated.Value(0.22)),
    [bars],
  );
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    loopsRef.current.forEach(loop => loop.stop());
    loopsRef.current = [];

    if (!active) {
      animations.forEach(value => value.setValue(0.22));
      return;
    }

    const loops = animations.map((value, index) => {
      const peak = 0.45 + ((index * 37) % 55) / 100;
      const duration = 260 + ((index * 71) % 260);

      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay((index % 6) * 35),
          Animated.timing(value, {
            toValue: peak,
            duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.22,
            duration: duration + 80,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );

      loop.start();
      return loop;
    });

    loopsRef.current = loops;

    return () => {
      loops.forEach(loop => loop.stop());
    };
  }, [active, animations]);

  return (
    <View style={styles.container}>
      {animations.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              opacity: active ? 1 : 0.45,
              transform: [{scaleY: value}],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 8,
  },
  bar: {
    width: 4,
    height: 54,
    borderRadius: 4,
    backgroundColor: "#4BC6FF",
    shadowColor: "#4BC6FF",
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: {width: 0, height: 0},
    elevation: 2,
  },
});
