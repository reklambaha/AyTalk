import React, {useMemo, useState} from "react";
import {
  Image,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type FirstRunOnboardingProps = {
  onFinish: () => void;
};

const pages = [
  {
    title: "Dili değil, insanı anla",
    text: "AyTalk; yazılı, sesli ve görüntülü iletişimde günlük konuşma dilini doğal biçimde çevirmek için tasarlandı.",
    badge: "Gerçek hayat çevirisi",
  },
  {
    title: "Konuş, gör, buluş",
    text: "Sesli çeviri, LiveBridge görüşmeleri, konferans ve görsel çeviri tek uygulamada bir araya gelir.",
    badge: "Tek uygulama, çok kanal",
  },
  {
    title: "İzinler açık ve kontrollü",
    text: "Mikrofon sesli çeviri, kamera görüntülü görüşme ve görsel çeviri, kişiler ise LiveBridge eşleştirmesi için kullanılır. İzinleri birazdan sen vereceksin.",
    badge: "Gizlilik önce gelir",
  },
];

export default function FirstRunOnboarding({onFinish}: FirstRunOnboardingProps) {
  const [index, setIndex] = useState(0);
  const page = pages[index];
  const isLast = index === pages.length - 1;

  const progress = useMemo(
    () => pages.map((_, itemIndex) => itemIndex <= index),
    [index],
  );

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor="#030817" />
      <View style={styles.content}>
        <Image source={require("../../assets/aytalk-main-logo.png")} style={styles.logo} />

        <View style={styles.badge}>
          <Text style={styles.badgeText}>{page.badge}</Text>
        </View>

        <Text style={styles.title}>{page.title}</Text>
        <Text style={styles.text}>{page.text}</Text>

        <View style={styles.progressRow}>
          {progress.map((active, itemIndex) => (
            <View
              key={itemIndex}
              style={[styles.progressDot, active && styles.progressDotActive]}
            />
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        {index > 0 ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setIndex(index - 1)}>
            <Text style={styles.secondaryButtonText}>Geri</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.secondaryButtonPlaceholder} />
        )}

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => {
            if (isLast) onFinish();
            else setIndex(index + 1);
          }}>
          <Text style={styles.primaryButtonText}>{isLast ? "AyTalk'ı Başlat" : "Devam"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: "#030817"},
  content: {flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28},
  logo: {width: 190, height: 130, resizeMode: "contain", marginBottom: 28},
  badge: {
    borderWidth: 1,
    borderColor: "#1D6FA7",
    backgroundColor: "#081B35",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    marginBottom: 18,
  },
  badgeText: {color: "#49D7FF", fontSize: 12, fontWeight: "800"},
  title: {color: "#FFFFFF", fontSize: 30, lineHeight: 37, fontWeight: "900", textAlign: "center"},
  text: {color: "#AFC7E6", fontSize: 16, lineHeight: 24, textAlign: "center", marginTop: 16},
  progressRow: {flexDirection: "row", gap: 8, marginTop: 34},
  progressDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: "#233852"},
  progressDotActive: {width: 24, backgroundColor: "#27C7F7"},
  footer: {flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 24, gap: 12},
  secondaryButton: {
    minWidth: 92,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#26476C",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonPlaceholder: {minWidth: 92},
  secondaryButtonText: {color: "#B9CDE5", fontWeight: "800"},
  primaryButton: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0EA5E9",
  },
  primaryButtonText: {color: "#FFFFFF", fontSize: 16, fontWeight: "900"},
});
