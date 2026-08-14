import React, {useEffect, useRef} from "react";
import {Animated, Easing, Image, StyleSheet, View} from "react-native";

type Props = {listening: boolean; loading: boolean};

export default function VoiceRing({listening, loading}: Props) {
  const pulse = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loops: Animated.CompositeAnimation[] = [];

    if (listening) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.12,
            duration: 520,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 520,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      loops.push(animation);
    } else {
      pulse.setValue(1);
    }

    if (loading) {
      const animation = Animated.loop(
        Animated.timing(rotate, {
          toValue: 1,
          duration: 1100,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      animation.start();
      loops.push(animation);
    } else {
      rotate.setValue(0);
    }

    if (listening || loading) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, {
            toValue: 0.9,
            duration: 620,
            useNativeDriver: true,
          }),
          Animated.timing(glow, {
            toValue: 0.35,
            duration: 620,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      loops.push(animation);
    } else {
      glow.setValue(0.35);
    }

    return () => loops.forEach(loop => loop.stop());
  }, [glow, listening, loading, pulse, rotate]);

  const color = listening ? "#32D583" : loading ? "#8B5CFF" : "#4BC6FF";

  return (
    <View style={styles.wrapper}>
      <Animated.View
        style={[
          styles.glow,
          {opacity: glow, backgroundColor: color, transform: [{scale: pulse}]},
        ]}
      />
      <Animated.View
        style={[
          styles.outerRing,
          {
            borderColor: color,
            transform: [
              {scale: pulse},
              {
                rotate: rotate.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "360deg"],
                }),
              },
            ],
          },
        ]}>
        <View style={styles.midRing}>
          <View style={styles.innerCircle}>
            <Image source={require("../../assets/blue.png")} style={styles.mic} />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {width: 188, height: 188, alignItems: "center", justifyContent: "center"},
  glow: {position: "absolute", width: 160, height: 160, borderRadius: 80},
  outerRing: {
    width: 164, height: 164, borderRadius: 82, borderWidth: 3,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#4BC6FF", shadowOpacity: 0.55, shadowRadius: 18,
    shadowOffset: {width: 0, height: 0}, elevation: 7,
  },
  midRing: {
    width: 144, height: 144, borderRadius: 72,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(11,23,48,0.92)",
    borderWidth: 1, borderColor: "#20365C",
  },
  innerCircle: {
    width: 118, height: 118, borderRadius: 59,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#071226", borderWidth: 1, borderColor: "#2A4B78",
  },
  mic: {width: 102, height: 102, resizeMode: "contain"},
});
