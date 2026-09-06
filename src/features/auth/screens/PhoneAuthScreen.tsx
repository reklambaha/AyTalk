import React, {useCallback, useEffect, useRef, useState} from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {AyColors, AyRadius, AySpacing} from "../../../shared/theme";
import {
  completeSilentNetworkVerification,
  getSilentNetworkVerificationStatus,
  startSilentNetworkVerification,
} from "../services/silentNetworkAuthService";
import type {AuthSession} from "../types/auth.types";

type FlowState = "idle" | "browser" | "checking" | "complete";

const SANDBOX_PHONE = "+990100000001";

const normalizeInput = (value: string) => {
  const clean = value.replace(/[^\d+]/g, "");
  if (!clean) return "";
  const withoutExtraPlus = clean.startsWith("+")
    ? `+${clean.slice(1).replace(/\+/g, "")}`
    : clean.replace(/\+/g, "");
  return withoutExtraPlus.slice(0, 16);
};

export default function PhoneAuthScreen({
  onVerified,
  onCancel,
}: {
  onVerified: (session: AuthSession) => void;
  onCancel?: () => void;
}) {
  const [phoneNumber, setPhoneNumber] = useState(SANDBOX_PHONE);
  const [verificationId, setVerificationId] = useState("");
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const busyRef = useRef(false);

  const canStart = /^\+[1-9]\d{7,14}$/.test(phoneNumber);

  const finishVerifiedSession = useCallback(async () => {
    if (!verificationId || busyRef.current) return;

    try {
      busyRef.current = true;
      setFlowState("checking");
      setErrorMessage("");
      setMessage("Doğrulama sonucu kontrol ediliyor...");

      const status = await getSilentNetworkVerificationStatus(verificationId);

      if (!status.verified || status.status !== "verified") {
        setFlowState("browser");
        setMessage(
          status.status === "failed"
            ? "Doğrulama başarısız oldu. Yeniden deneyin."
            : "Doğrulama henüz tamamlanmadı. Tarayıcıdaki işlemi bitirip AyTalk'a dönün.",
        );
        return;
      }

      if (status.sessionIssued) {
        throw new Error(
          "Bu doğrulama daha önce kullanılmış. Güvenlik için yeni bir doğrulama başlatın.",
        );
      }

      setMessage("Güvenli AyTalk oturumu oluşturuluyor...");
      const session = await completeSilentNetworkVerification(verificationId);
      setFlowState("complete");
      setMessage("Telefon doğrulandı.");
      onVerified(session);
    } catch (error) {
      setFlowState("browser");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Sessiz doğrulama tamamlanamadı.",
      );
    } finally {
      busyRef.current = false;
    }
  }, [onVerified, verificationId]);

  useEffect(() => {
    if (!verificationId) return;

    const subscription = AppState.addEventListener("change", nextState => {
      if (nextState === "active" && flowState === "browser") {
        setTimeout(() => void finishVerifiedSession(), 500);
      }
    });

    return () => subscription.remove();
  }, [finishVerifiedSession, flowState, verificationId]);

  const startVerification = async () => {
    if (!canStart || busyRef.current) return;

    try {
      busyRef.current = true;
      setErrorMessage("");
      setMessage("Sessiz doğrulama hazırlanıyor...");
      setFlowState("checking");

      const result = await startSilentNetworkVerification(phoneNumber);
      setVerificationId(result.verificationId);
      setFlowState("browser");
      setMessage(
        "Operatör doğrulama ekranı açılıyor. İşlemi tamamlayıp AyTalk'a geri dönün.",
      );

      const supported = await Linking.canOpenURL(result.authorizationUrl);
      if (!supported) {
        throw new Error("Doğrulama bağlantısı bu cihazda açılamadı.");
      }

      await Linking.openURL(result.authorizationUrl);
    } catch (error) {
      setFlowState("idle");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Sessiz doğrulama başlatılamadı.",
      );
    } finally {
      busyRef.current = false;
    }
  };

  const resetFlow = () => {
    if (busyRef.current) return;
    setVerificationId("");
    setFlowState("idle");
    setMessage("");
    setErrorMessage("");
  };

  const isBusy = flowState === "checking";

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={AyColors.background} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>A</Text>
            </View>
            <View>
              <Text style={styles.brand}>AYTALK</Text>
              <Text style={styles.brandSubtitle}>Global Secure Auth</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.securityBadge}>
              <Text style={styles.securityBadgeText}>⚡ SESSİZ TELEFON DOĞRULAMA</Text>
            </View>

            <Text style={styles.title}>SMS kodu olmadan doğrulayın</Text>
            <Text style={styles.description}>
              AyTalk önce operatör / SIM tabanlı Number Verification kullanır. SMS yalnızca ileride desteklenmeyen ağlarda son çare olacaktır.
            </Text>

            <Text style={styles.label}>Telefon numarası</Text>
            <TextInput
              value={phoneNumber}
              onChangeText={value => {
                setPhoneNumber(normalizeInput(value));
                if (verificationId) resetFlow();
                setErrorMessage("");
              }}
              editable={!isBusy}
              keyboardType="phone-pad"
              autoCapitalize="none"
              placeholder="+905xxxxxxxxx"
              placeholderTextColor={AyColors.textMuted}
              style={styles.phoneInput}
              maxLength={16}
            />

            <View style={styles.sandboxBox}>
              <Text style={styles.sandboxTitle}>SANDBOX TEST</Text>
              <Text style={styles.sandboxText}>
                Şu an Orange Playground kullanılıyor. Gerçek SMS gönderilmez ve ücret oluşmaz. Test numarası: {SANDBOX_PHONE}
              </Text>
            </View>

            {flowState === "idle" ? (
              <TouchableOpacity
                activeOpacity={0.88}
                disabled={!canStart}
                onPress={() => void startVerification()}
                style={[
                  styles.primaryButton,
                  !canStart && styles.primaryButtonDisabled,
                ]}>
                <Text style={styles.primaryButtonText}>Sessiz Doğrulamayı Başlat</Text>
              </TouchableOpacity>
            ) : null}

            {flowState === "checking" ? (
              <View style={styles.progressBox}>
                <ActivityIndicator color={AyColors.cyan} />
                <Text style={styles.progressText}>{message}</Text>
              </View>
            ) : null}

            {flowState === "browser" ? (
              <>
                <View style={styles.progressBox}>
                  <Text style={styles.progressText}>{message}</Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={() => void finishVerifiedSession()}
                  style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Doğrulamayı Kontrol Et</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={resetFlow} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Yeniden başlat</Text>
                </TouchableOpacity>
              </>
            ) : null}

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.privacyBox}>
              <Text style={styles.privacyTitle}>Maliyet ve güvenlik</Text>
              <Text style={styles.privacyText}>
                Normal girişte Firebase oturumu kullanılacak. Telefon sahipliği yalnız gerektiğinde sessiz ağ doğrulamasıyla kanıtlanacak; doğrulama token'ı cihazda saklanmayacak.
              </Text>
            </View>

            {onCancel ? (
              <TouchableOpacity
                disabled={isBusy}
                onPress={onCancel}
                style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Şimdilik geri dön</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  screen: {flex: 1, backgroundColor: AyColors.background},
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: AySpacing.xl,
    paddingVertical: AySpacing.xxl,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: AySpacing.xl,
  },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: AySpacing.md,
    backgroundColor: AyColors.surfaceStrong,
    borderWidth: 1,
    borderColor: AyColors.cyan,
  },
  brandMarkText: {color: AyColors.cyan, fontSize: 25, fontWeight: "900"},
  brand: {color: AyColors.text, fontSize: 21, fontWeight: "900", letterSpacing: 1.4},
  brandSubtitle: {color: AyColors.textMuted, fontSize: 12, marginTop: 2},
  card: {
    backgroundColor: AyColors.surface,
    borderColor: AyColors.border,
    borderWidth: 1,
    borderRadius: AyRadius.xl,
    padding: AySpacing.xl,
  },
  securityBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(53,216,255,0.10)",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 11,
    marginBottom: AySpacing.lg,
  },
  securityBadgeText: {
    color: AyColors.cyan,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  title: {color: AyColors.text, fontSize: 27, lineHeight: 33, fontWeight: "800"},
  description: {
    color: AyColors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: AySpacing.sm,
    marginBottom: AySpacing.xl,
  },
  label: {
    color: AyColors.text,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: AySpacing.sm,
  },
  phoneInput: {
    height: 58,
    borderRadius: AyRadius.medium,
    borderWidth: 1,
    borderColor: AyColors.cyan,
    backgroundColor: "rgba(53,216,255,0.05)",
    color: AyColors.text,
    fontSize: 18,
    paddingHorizontal: AySpacing.lg,
  },
  sandboxBox: {
    marginTop: AySpacing.md,
    borderRadius: AyRadius.small,
    borderWidth: 1,
    borderColor: AyColors.border,
    backgroundColor: "rgba(255,255,255,0.025)",
    padding: AySpacing.md,
  },
  sandboxTitle: {color: AyColors.cyan, fontSize: 11, fontWeight: "900"},
  sandboxText: {
    color: AyColors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
  },
  primaryButton: {
    height: 56,
    borderRadius: AyRadius.medium,
    backgroundColor: AyColors.blue,
    alignItems: "center",
    justifyContent: "center",
    marginTop: AySpacing.xl,
  },
  primaryButtonDisabled: {opacity: 0.42},
  primaryButtonText: {color: "#FFFFFF", fontSize: 15, fontWeight: "800"},
  progressBox: {
    marginTop: AySpacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: AySpacing.sm,
    borderRadius: AyRadius.small,
    borderWidth: 1,
    borderColor: AyColors.border,
    padding: AySpacing.md,
  },
  progressText: {
    flex: 1,
    color: AyColors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: AySpacing.sm,
  },
  secondaryButtonText: {color: AyColors.cyan, fontSize: 12, fontWeight: "700"},
  errorBox: {
    marginTop: AySpacing.lg,
    borderRadius: AyRadius.small,
    borderWidth: 1,
    borderColor: "rgba(255,102,117,0.45)",
    backgroundColor: "rgba(255,102,117,0.08)",
    padding: AySpacing.md,
  },
  errorText: {color: AyColors.danger, fontSize: 12, lineHeight: 18},
  privacyBox: {
    marginTop: AySpacing.xl,
    borderTopWidth: 1,
    borderTopColor: AyColors.border,
    paddingTop: AySpacing.lg,
  },
  privacyTitle: {color: AyColors.text, fontSize: 12, fontWeight: "800"},
  privacyText: {
    color: AyColors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
  },
  cancelButton: {
    alignSelf: "center",
    paddingVertical: AySpacing.md,
    paddingHorizontal: AySpacing.lg,
    marginTop: AySpacing.sm,
  },
  cancelButtonText: {color: AyColors.textMuted, fontSize: 12, fontWeight: "700"},
});
