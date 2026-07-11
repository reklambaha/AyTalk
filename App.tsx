import React, { useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const SERVER_URL = "http://192.168.1.106:3000";

export default function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(
    "Yapay zekâ bağlantısı test edilmeyi bekliyor."
  );

  const testArtificialIntelligence = async () => {
    try {
      setIsLoading(true);
      setResult("OpenAI yanıtı bekleniyor...");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${SERVER_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message:
            "Translate this Turkish sentence into natural English. Return only the translation: Merhaba, bugün nasılsın?",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Sunucu hatası: ${response.status}`);
      }

      if (!data.reply) {
        throw new Error("Sunucudan geçerli bir cevap alınamadı.");
      }

      setResult(data.reply);
      Alert.alert("AyTalk cevabı", data.reply);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === "AbortError"
            ? "Sunucu 30 saniye içinde cevap vermedi."
            : error.message
          : "Bilinmeyen bir hata oluştu.";

      setResult(`Hata: ${message}`);
      Alert.alert("AyTalk hatası", message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Image
        source={require("./assets/logo.png")}
        style={styles.logoImage}
      />

      <TouchableOpacity
        style={[styles.micButton, isLoading && styles.disabledButton]}
        onPress={testArtificialIntelligence}
        disabled={isLoading}
      >
        <Text style={styles.micIcon}>🤖</Text>
      </TouchableOpacity>

      <Text style={styles.language}>Türkçe → English</Text>

      <Text style={styles.tap}>
        {isLoading ? "Yanıt bekleniyor..." : "Yapay Zekâyı Test Et"}
      </Text>

      <Text style={styles.result}>{result}</Text>

      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },

  logoImage: {
    width: 190,
    height: 135,
    resizeMode: "contain",
    marginBottom: 35,
  },

  micButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "#18A4F2",
    justifyContent: "center",
    alignItems: "center",
    elevation: 10,
  },

  disabledButton: {
    opacity: 0.6,
  },

  micIcon: {
    fontSize: 78,
  },

  language: {
    marginTop: 45,
    fontSize: 26,
    fontWeight: "700",
    color: "#1E3A8A",
  },

  tap: {
    marginTop: 15,
    fontSize: 20,
    color: "#555555",
  },

  result: {
    marginTop: 24,
    paddingHorizontal: 12,
    fontSize: 19,
    lineHeight: 27,
    color: "#1E3A8A",
    textAlign: "center",
    fontWeight: "600",
  },
});