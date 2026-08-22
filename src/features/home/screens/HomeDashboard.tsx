import React from "react";
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import AyTalkIcon from "../components/AyTalkIcon";

export type HomeSection =
  | "livebridge"
  | "translate"
  | "assistant"
  | "image"
  | "conference"
  | "history"
  | "profile"
  | "emergency";

export default function HomeDashboard({
  onOpen,
}: {
  onOpen: (section: HomeSection) => void;
}) {
  const {height, width} = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const compact = height < 780 || width < 380;
  const tiny = height < 690 || width < 340;

  const horizontal = tiny ? 8 : compact ? 10 : 12;
  const gap = tiny ? 5 : 7;
  const bottomNavHeight = tiny ? 42 : 48;
  const historyHeight = tiny ? 46 : 52;
  const liveBridgeHeight = tiny ? 88 : compact ? 102 : 112;

  // Büyük üst logo/dashboard alanı tamamen kaldırıldı.
  // Sağ üst profil küçük ve bağımsız kaldı.
  const profileHeight = tiny ? 38 : 42;

  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      style={[
        styles.screen,
        {
          paddingHorizontal: horizontal,
          paddingBottom: Math.max(4, insets.bottom ? 2 : 8),
        },
      ]}>
      <StatusBar barStyle="light-content" backgroundColor="#030817" />

      <ScrollView
        style={{flex: 1}}
        contentContainerStyle={{flexGrow: 1}}
        showsVerticalScrollIndicator={false}>

      <View style={[styles.quickTop, {height: profileHeight + 4}]}>
        <View style={styles.liveBrandMini}>
          <Text style={styles.liveBrandMiniText}>AYTALK</Text>
        </View>

        <TouchableOpacity
          activeOpacity={0.86}
          style={[
            styles.profileButton,
            tiny && styles.profileButtonTiny,
          ]}
          onPress={() => onOpen("profile")}>
          <AyTalkIcon name="profile" size={tiny ? 21 : 24} />
          <View style={styles.onlineDot} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        activeOpacity={0.9}
        style={[
          styles.glassCard,
          styles.liveBridgeCard,
          {height: liveBridgeHeight},
        ]}
        onPress={() => onOpen("livebridge")}>
        <View
          style={[
            styles.liveIconWrap,
            {
              width: tiny ? 62 : compact ? 70 : 78,
              height: tiny ? 62 : compact ? 70 : 78,
            },
          ]}>
          <AyTalkIcon
            name="livebridge"
            size={tiny ? 52 : compact ? 59 : 66}
          />
        </View>

        <View style={styles.liveContent}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={styles.liveTitle}>
            LiveBridge
          </Text>
          <Text style={styles.liveEnglish}>Live Translated Calls</Text>

          <View style={styles.badgeRow}>
            <View style={styles.freeBadge}>
              <Text style={styles.freeBadgeText}>Free Voice</Text>
            </View>
            <View style={styles.vipBadge}>
              <Text style={styles.vipBadgeText}>VIP Video</Text>
            </View>
          </View>
        </View>

        <View style={styles.arrowCircle}>
          <Text style={styles.arrow}>›</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.9}
        style={[styles.emergencyCard, {marginBottom: gap}]}
        onPress={() => onOpen("emergency")}>
        <View style={styles.emergencyIconWrap}>
          <Text style={styles.emergencyIcon}>🆘</Text>
        </View>
        <View style={styles.emergencyTextWrap}>
          <Text style={styles.emergencyTitle}>Acil Durum</Text>
          <Text style={styles.emergencySubtitle}>Offline Emergency Phrases</Text>
        </View>
        <Text style={styles.emergencyArrow}>›</Text>
      </TouchableOpacity>

      <View style={[styles.grid, {gap}]}>
        <FeatureCard
          icon="translation"
          title="Çeviri"
          english="Translation"
          detail="Text & Voice"
          tiny={tiny}
          onPress={() => onOpen("translate")}
        />
        <FeatureCard
          icon="assistant"
          title="AI Asistanı"
          english="AI Assistant"
          detail="Artificial Intelligence"
          tiny={tiny}
          onPress={() => onOpen("assistant")}
        />
        <FeatureCard
          icon="visual"
          title="Görsel Çeviri"
          english="Visual Translation"
          detail="Camera & OCR"
          tiny={tiny}
          onPress={() => onOpen("image")}
        />
        <FeatureCard
          icon="conference"
          title="Konferans"
          english="Conference"
          detail="Multi-language"
          tiny={tiny}
          onPress={() => onOpen("conference")}
        />
      </View>

      <TouchableOpacity
        activeOpacity={0.9}
        style={[
          styles.glassCard,
          styles.historyCard,
          {height: historyHeight},
        ]}
        onPress={() => onOpen("history")}>
        <AyTalkIcon name="history" size={tiny ? 33 : 39} />
        <View style={styles.historyTextWrap}>
          <Text style={styles.historyTitle}>Geçmiş</Text>
          {!tiny ? (
            <Text style={styles.historyEnglish}>
              Translation History
            </Text>
          ) : null}
        </View>
        <View style={styles.arrowCircleSmall}>
          <Text style={styles.arrowSmall}>›</Text>
        </View>
      </TouchableOpacity>

      <View
        style={[
          styles.bottomNav,
          {
            height: bottomNavHeight,
            marginBottom: insets.bottom > 0 ? 0 : 4,
          },
        ]}>
        <TouchableOpacity style={styles.bottomItemActive}>
          <AyTalkIcon name="home" size={tiny ? 19 : 22} />
          {!tiny ? (
            <Text style={styles.bottomActiveText}>Ana Sayfa</Text>
          ) : null}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bottomItem}
          onPress={() => onOpen("history")}>
          <AyTalkIcon name="history" size={tiny ? 19 : 21} />
          {!tiny ? <Text style={styles.bottomText}>Geçmiş</Text> : null}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bottomItem}
          onPress={() => onOpen("profile")}>
          <AyTalkIcon name="profile" size={tiny ? 19 : 21} />
          {!tiny ? <Text style={styles.bottomText}>Profil</Text> : null}
        </TouchableOpacity>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeatureCard({
  icon,
  title,
  english,
  detail,
  onPress,
  tiny,
}: {
  icon: "translation" | "assistant" | "visual" | "conference";
  title: string;
  english: string;
  detail: string;
  onPress: () => void;
  tiny: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={styles.featureCard}
      onPress={onPress}>
      <View style={styles.featureTopRow}>
        <AyTalkIcon name={icon} size={tiny ? 33 : 41} />
        <View style={styles.featureArrow}>
          <Text style={styles.featureArrowText}>›</Text>
        </View>
      </View>

      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={styles.featureTitle}>
        {title}
      </Text>
      <Text style={styles.featureEnglish}>{english}</Text>
      {!tiny ? <Text style={styles.featureDetail}>{detail}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#030817",
    paddingTop: 0,
  },
  quickTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  liveBrandMini: {
    height: 28,
    borderRadius: 10,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#08172D",
    borderWidth: 1,
    borderColor: "#163B67",
  },
  liveBrandMiniText: {
    color: "#35D8FF",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0E1C39",
    borderWidth: 1,
    borderColor: "#315FA8",
  },
  profileButtonTiny: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  onlineDot: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
    right: 1,
    top: 1,
    backgroundColor: "#32D583",
    borderWidth: 1,
    borderColor: "#030817",
  },
  emergencyCard: {
    minHeight: 64,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,112,112,0.52)",
    backgroundColor: "#241222",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  emergencyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  emergencyIcon: {fontSize: 25},
  emergencyTextWrap: {flex: 1, marginLeft: 12},
  emergencyTitle: {color: "#FFFFFF", fontSize: 16, fontWeight: "900"},
  emergencySubtitle: {color: "#E8A9B1", fontSize: 11, marginTop: 2},
  emergencyArrow: {color: "#FFFFFF", fontSize: 30, fontWeight: "300"},
  glassCard: {
    borderWidth: 1,
    borderColor: "rgba(94,183,255,0.40)",
    backgroundColor: "#0B1730",
  },
  liveBridgeCard: {
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    marginTop: 3,
  },
  liveIconWrap: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "#102B58",
  },
  liveContent: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 9,
  },
  liveTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
  },
  liveEnglish: {
    color: "#7EA9E7",
    fontSize: 8,
    fontWeight: "800",
    marginTop: 1,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 6,
  },
  freeBadge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: "rgba(0,201,173,0.14)",
  },
  freeBadgeText: {
    color: "#31E6CC",
    fontSize: 7,
    fontWeight: "900",
  },
  vipBadge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: "rgba(131,77,255,0.18)",
  },
  vipBadgeText: {
    color: "#CFACFF",
    fontSize: 7,
    fontWeight: "900",
  },
  arrowCircle: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A2447",
    borderWidth: 1,
    borderColor: "#168BFF",
  },
  arrow: {
    color: "#2ED8FF",
    fontSize: 24,
    lineHeight: 25,
    marginTop: -3,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: 6,
  },
  featureCard: {
    width: "49%",
    aspectRatio: 1.05,
    marginBottom: 10,
    borderRadius: 17,
    padding: 8,
    backgroundColor: "#0B1730",
    borderWidth: 1,
    borderColor: "#203E6A",
  },
  featureTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  featureArrow: {
    width: 23,
    height: 23,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A2447",
  },
  featureArrowText: {
    color: "#27CCFF",
    fontSize: 19,
    lineHeight: 20,
    marginTop: -3,
  },
  featureTitle: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 2,
  },
  featureEnglish: {
    color: "#7EA9E7",
    fontSize: 7,
    fontWeight: "800",
    marginTop: 1,
  },
  featureDetail: {
    color: "#607C9E",
    fontSize: 7,
    marginTop: 1,
  },
  historyCard: {
    borderRadius: 16,
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
  },
  historyTextWrap: {
    flex: 1,
    marginLeft: 7,
  },
  historyTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  historyEnglish: {
    color: "#789FCE",
    fontSize: 7,
    marginTop: 1,
  },
  arrowCircleSmall: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A2447",
  },
  arrowSmall: {
    color: "#27CCFF",
    fontSize: 21,
    lineHeight: 22,
    marginTop: -3,
  },
  bottomNav: {
    marginTop: 5,
    borderRadius: 17,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#081226",
    borderWidth: 1,
    borderColor: "#1C3963",
  },
  bottomItem: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomItemActive: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomText: {
    color: "#7489A5",
    fontSize: 7,
    fontWeight: "700",
    marginTop: 1,
  },
  bottomActiveText: {
    color: "#2DD4FF",
    fontSize: 7,
    fontWeight: "900",
    marginTop: 1,
  },
});
