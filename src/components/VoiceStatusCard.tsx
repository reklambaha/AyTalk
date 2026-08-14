import React from "react";
import {StyleSheet, Text, View} from "react-native";

type Props = {
  listening: boolean;
  loading: boolean;
  sourceLabel: string;
  targetLabel: string;
};

export default function VoiceStatusCard({
  listening,
  loading,
  sourceLabel,
  targetLabel,
}: Props) {
  const title = loading
    ? "Çeviri hazırlanıyor"
    : listening
      ? "Dinleniyor"
      : "Konuşmaya hazır";
  const color = loading ? "#8B5CFF" : listening ? "#32D583" : "#4BC6FF";

  return (
    <View style={styles.card}>
      <View style={styles.languages}>
        <Text style={styles.language}>{sourceLabel}</Text>
        <Text style={styles.arrow}>→</Text>
        <Text style={styles.language}>{targetLabel}</Text>
      </View>
      <View style={styles.status}>
        <Text style={[styles.dot, {color}]}>{listening ? "●" : loading ? "✦" : "○"}</Text>
        <Text style={styles.statusText}>{title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: "#0B1730", borderWidth: 1, borderColor: "#20365C",
    marginBottom: 12,
  },
  languages: {flexDirection: "row", alignItems: "center", justifyContent: "center"},
  language: {color: "#FFFFFF", fontSize: 14, fontWeight: "900"},
  arrow: {color: "#4BC6FF", fontSize: 20, fontWeight: "900", marginHorizontal: 12},
  status: {flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 9},
  dot: {fontSize: 14, marginRight: 7},
  statusText: {color: "#AFC7E6", fontSize: 12, fontWeight: "800", letterSpacing: 0.4},
});
