import React from "react";
import {StyleSheet, Text, View} from "react-native";

export default function StatCard({icon, value, label}: {icon: string; value: number; label: string}) {
  return <View style={styles.card}><Text style={styles.icon}>{icon}</Text><Text style={styles.value}>{value}</Text><Text style={styles.label}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  card: {width: "48%", minHeight: 112, borderRadius: 18, padding: 14, backgroundColor: "#0E1C39", borderWidth: 1, borderColor: "#20365C"},
  icon: {fontSize: 23}, value: {color: "#FFFFFF", fontSize: 25, fontWeight: "900", marginTop: 8}, label: {color: "#AFC7E6", fontSize: 11, marginTop: 2},
});
