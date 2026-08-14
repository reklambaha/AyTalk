import React, {useEffect, useRef} from "react";
import {
  Animated,
  Easing,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

type AppIntroProps = {
  onFinish: () => void;
};

export default function AppIntro({onFinish}: AppIntroProps) {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.72)).current;
  const logoTranslateY = useRef(new Animated.Value(18)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(glowOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 7,
          tension: 62,
          useNativeDriver: true,
        }),
        Animated.timing(logoTranslateY, {
          toValue: 0,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 340,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.delay(850),
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 0,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1.06,
          duration: 260,
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start(({finished}) => {
      if (finished) onFinish();
    });

    return () => animation.stop();
  }, [
    glowOpacity,
    logoOpacity,
    logoScale,
    logoTranslateY,
    onFinish,
    textOpacity,
  ]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#06182F" />

      <Animated.View
        style={[
          styles.glow,
          {
            opacity: glowOpacity,
            transform: [{scale: logoScale}],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.logoWrap,
          {
            opacity: logoOpacity,
            transform: [
              {scale: logoScale},
              {translateY: logoTranslateY},
            ],
          },
        ]}>
        <Image
          source={require("../../assets/aytalk-brand.png")}
          style={styles.logo}
        />
      </Animated.View>

      <Animated.View style={[styles.textWrap, {opacity: textOpacity}]}>
        <Text style={styles.brand}>AyTalk</Text>
        <Text style={styles.tagline}>Translate. Talk. Travel.</Text>
        <View style={styles.line} />
        <Text style={styles.caption}>Dünyayı aynı dilde buluşturur.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050A18",
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "rgba(75,198,255,0.16)",
  },
  logoWrap: {
    width: 280,
    height: 210,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 270,
    height: 200,
    resizeMode: "contain",
  },
  textWrap: {
    alignItems: "center",
    marginTop: 6,
  },
  brand: {
    color: "#FFFFFF",
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  tagline: {
    color: "#BFD4EC",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 6,
  },
  line: {
    width: 46,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#16A3E6",
    marginTop: 18,
  },
  caption: {
    color: "#7F9AB9",
    fontSize: 12,
    marginTop: 12,
  },
});
