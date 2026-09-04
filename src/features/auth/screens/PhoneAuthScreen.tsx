import React, {useMemo, useState} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
  clearPendingPhoneVerification,
  confirmPhoneVerification,
  requestPhoneVerification,
} from "../services/authService";
import type {AuthSession} from "../types/auth.types";

type CountryOption = {
  code: "TR" | "KH" | "SY";
  name: string;
  dialCode: string;
  flag: string;
  placeholder: string;
};

const COUNTRIES: CountryOption[] = [
  {
    code: "TR",
    name: "Türkiye",
    dialCode: "+90",
    flag: "🇹🇷",
    placeholder: "5xx xxx xx xx",
  },
  {
    code: "KH",
    name: "Kamboçya",
    dialCode: "+855",
    flag: "🇰🇭",
    placeholder: "xx xxx xxx",
  },
  {
    code: "SY",
    name: "Suriye",
    dialCode: "+963",
    flag: "🇸🇾",
    placeholder: "9xx xxx xxx",
  },
];

const RESEND_SECONDS = 45;

const onlyDigits = (value: string) => value.replace(/\D/g, "");

const buildE164PhoneNumber = (country: CountryOption, localNumber: string) => {
  const digits = onlyDigits(localNumber).replace(/^0+/, "");
  return `${country.dialCode}${digits}`;
};

const friendlyAuthError = (error: unknown) => {
  const code = String((error as {code?: string})?.code || "");

  if (code.includes("invalid-phone-number")) {
    return "Telefon numarası geçerli görünmüyor. Ülke kodunu ve numarayı kontrol edin.";
  }
  if (code.includes("too-many-requests")) {
    return "Çok fazla doğrulama isteği gönderildi. Bir süre bekleyip yeniden deneyin.";
  }
  if (code.includes("quota-exceeded")) {
    return "SMS gönderim kotası doldu. Daha sonra yeniden deneyin.";
  }
  if (code.includes("invalid-verification-code")) {
    return "SMS doğrulama kodu hatalı. Kodu kontrol edip yeniden deneyin.";
  }
  if (code.includes("session-expired")) {
    return "Doğrulama süresi doldu. Yeni bir SMS kodu isteyin.";
  }
  if (code.includes("network-request-failed")) {
    return "İnternet bağlantısı kurulamadı. Bağlantınızı kontrol edip yeniden deneyin.";
  }

  return error instanceof Error
    ? error.message
    : "Telefon doğrulaması sırasında beklenmeyen bir hata oluştu.";
};

export default function PhoneAuthScreen({
  onVerified,
  onCancel,
}: {
  onVerified: (session: AuthSession) => void;
  onCancel?: () => void;
}) {
  const [country, setCountry] = useState<CountryOption>(COUNTRIES[0]);
  const [localNumber, setLocalNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);

  React.useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(
      () => setResendSeconds(previous => Math.max(0, previous - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  React.useEffect(() => {
    return () => clearPendingPhoneVerification();
  }, []);

  const normalizedPhone = useMemo(
    () => buildE164PhoneNumber(country, localNumber),
    [country, localNumber],
  );

  const canRequestCode = onlyDigits(localNumber).replace(/^0+/, "").length >= 7;
  const canVerifyCode = /^\d{6}$/.test(verificationCode);

  const requestCode = async () => {
    if (!canRequestCode || isBusy) return;

    try {
      setIsBusy(true);
      setErrorMessage("");
      const result = await requestPhoneVerification(normalizedPhone);
      setVerifiedPhone(result.phoneNumber);
      setVerificationCode("");
      setStep("code");
      setResendSeconds(RESEND_SECONDS);
    } catch (error) {
      setErrorMessage(friendlyAuthError(error));
    } finally {
      setIsBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!canVerifyCode || isBusy) return;

    try {
      setIsBusy(true);
      setErrorMessage("");
      const session = await confirmPhoneVerification(verificationCode);
      onVerified(session);
    } catch (error) {
      setErrorMessage(friendlyAuthError(error));
    } finally {
      setIsBusy(false);
    }
  };

  const editPhoneNumber = () => {
    clearPendingPhoneVerification();
    setStep("phone");
    setVerificationCode("");
    setVerifiedPhone("");
    setErrorMessage("");
    setResendSeconds(0);
  };

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
              <Text style={styles.brandSubtitle}>Secure LiveBridge</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.securityBadge}>
              <Text style={styles.securityBadgeText}>🔒 TELEFON DOĞRULAMA</Text>
            </View>

            <Text style={styles.title}>
              {step === "phone" ? "Numaranızı doğrulayın" : "SMS kodunu girin"}
            </Text>
            <Text style={styles.description}>
              {step === "phone"
                ? "LiveBridge hesabınız yalnızca size ait doğrulanmış telefon numarasıyla kullanılacak."
                : `${verifiedPhone} numarasına gönderilen 6 haneli doğrulama kodunu girin.`}
            </Text>

            {step === "phone" ? (
              <>
                <Text style={styles.label}>Ülke</Text>
                <View style={styles.countryRow}>
                  {COUNTRIES.map(item => {
                    const active = item.code === country.code;
                    return (
                      <TouchableOpacity
                        key={item.code}
                        activeOpacity={0.85}
                        disabled={isBusy}
                        style={[styles.countryChip, active && styles.countryChipActive]}
                        onPress={() => {
                          setCountry(item);
                          setErrorMessage("");
                        }}>
                        <Text style={styles.countryFlag}>{item.flag}</Text>
                        <Text
                          numberOfLines={1}
                          style={[styles.countryText, active && styles.countryTextActive]}>
                          {item.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.label}>Telefon numarası</Text>
                <View style={styles.phoneRow}>
                  <View style={styles.dialCodeBox}>
                    <Text style={styles.dialCode}>{country.dialCode}</Text>
                  </View>
                  <TextInput
                    value={localNumber}
                    onChangeText={value => {
                      setLocalNumber(onlyDigits(value).slice(0, 15));
                      setErrorMessage("");
                    }}
                    editable={!isBusy}
                    keyboardType="phone-pad"
                    placeholder={country.placeholder}
                    placeholderTextColor={AyColors.textMuted}
                    style={styles.phoneInput}
                    maxLength={15}
                  />
                </View>

                <Text style={styles.hint}>
                  Başındaki 0'ı yazabilirsiniz; AyTalk numarayı uluslararası formata dönüştürür.
                </Text>

                <TouchableOpacity
                  activeOpacity={0.88}
                  disabled={!canRequestCode || isBusy}
                  onPress={() => void requestCode()}
                  style={[
                    styles.primaryButton,
                    (!canRequestCode || isBusy) && styles.primaryButtonDisabled,
                  ]}>
                  {isBusy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>SMS Kodunu Gönder</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.label}>6 haneli kod</Text>
                <TextInput
                  value={verificationCode}
                  onChangeText={value => {
                    setVerificationCode(onlyDigits(value).slice(0, 6));
                    setErrorMessage("");
                  }}
                  editable={!isBusy}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  placeholder="000000"
                  placeholderTextColor={AyColors.textMuted}
                  maxLength={6}
                  style={styles.codeInput}
                />

                <TouchableOpacity
                  activeOpacity={0.88}
                  disabled={!canVerifyCode || isBusy}
                  onPress={() => void verifyCode()}
                  style={[
                    styles.primaryButton,
                    (!canVerifyCode || isBusy) && styles.primaryButtonDisabled,
                  ]}>
                  {isBusy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Doğrula ve Devam Et</Text>
                  )}
                </TouchableOpacity>

                <View style={styles.secondaryActions}>
                  <TouchableOpacity
                    disabled={isBusy}
                    onPress={editPhoneNumber}
                    style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Numarayı değiştir</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    disabled={isBusy || resendSeconds > 0}
                    onPress={() => void requestCode()}
                    style={styles.secondaryButton}>
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        resendSeconds > 0 && styles.secondaryButtonTextDisabled,
                      ]}>
                      {resendSeconds > 0
                        ? `Tekrar gönder (${resendSeconds})`
                        : "Kodu tekrar gönder"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.privacyBox}>
              <Text style={styles.privacyTitle}>Neden doğrulama istiyoruz?</Text>
              <Text style={styles.privacyText}>
                Başka bir kişinin telefon numarasıyla hesap açılmasını, onun adına çağrı kabul edilmesini veya mesajlara erişilmesini önlemek için.
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
  screen: {
    flex: 1,
    backgroundColor: AyColors.background,
  },
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
  brandMarkText: {
    color: AyColors.cyan,
    fontSize: 25,
    fontWeight: "900",
  },
  brand: {
    color: AyColors.text,
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  brandSubtitle: {
    color: AyColors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
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
  title: {
    color: AyColors.text,
    fontSize: 27,
    lineHeight: 33,
    fontWeight: "800",
  },
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
  countryRow: {
    flexDirection: "row",
    gap: AySpacing.sm,
    marginBottom: AySpacing.xl,
  },
  countryChip: {
    flex: 1,
    minHeight: 54,
    borderRadius: AyRadius.medium,
    borderWidth: 1,
    borderColor: AyColors.border,
    backgroundColor: "rgba(255,255,255,0.025)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  countryChipActive: {
    borderColor: AyColors.cyan,
    backgroundColor: "rgba(53,216,255,0.10)",
  },
  countryFlag: {
    fontSize: 20,
  },
  countryText: {
    color: AyColors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  countryTextActive: {
    color: AyColors.text,
  },
  phoneRow: {
    flexDirection: "row",
    gap: AySpacing.sm,
  },
  dialCodeBox: {
    minWidth: 78,
    height: 56,
    borderRadius: AyRadius.medium,
    borderWidth: 1,
    borderColor: AyColors.border,
    backgroundColor: AyColors.surfaceStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: AySpacing.md,
  },
  dialCode: {
    color: AyColors.cyan,
    fontWeight: "800",
    fontSize: 16,
  },
  phoneInput: {
    flex: 1,
    height: 56,
    borderRadius: AyRadius.medium,
    borderWidth: 1,
    borderColor: AyColors.border,
    backgroundColor: "rgba(255,255,255,0.035)",
    color: AyColors.text,
    fontSize: 17,
    paddingHorizontal: AySpacing.lg,
  },
  codeInput: {
    height: 64,
    borderRadius: AyRadius.medium,
    borderWidth: 1,
    borderColor: AyColors.cyan,
    backgroundColor: "rgba(53,216,255,0.06)",
    color: AyColors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 9,
    textAlign: "center",
    paddingHorizontal: AySpacing.lg,
  },
  hint: {
    color: AyColors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: AySpacing.sm,
  },
  primaryButton: {
    height: 56,
    borderRadius: AyRadius.medium,
    backgroundColor: AyColors.blue,
    alignItems: "center",
    justifyContent: "center",
    marginTop: AySpacing.xl,
  },
  primaryButtonDisabled: {
    opacity: 0.42,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: AySpacing.sm,
    marginTop: AySpacing.md,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: AySpacing.sm,
  },
  secondaryButtonText: {
    color: AyColors.cyan,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
  },
  secondaryButtonTextDisabled: {
    color: AyColors.textMuted,
  },
  errorBox: {
    marginTop: AySpacing.lg,
    borderRadius: AyRadius.small,
    borderWidth: 1,
    borderColor: "rgba(255,102,117,0.45)",
    backgroundColor: "rgba(255,102,117,0.08)",
    padding: AySpacing.md,
  },
  errorText: {
    color: AyColors.danger,
    fontSize: 12,
    lineHeight: 18,
  },
  privacyBox: {
    marginTop: AySpacing.xl,
    borderTopWidth: 1,
    borderTopColor: AyColors.border,
    paddingTop: AySpacing.lg,
  },
  privacyTitle: {
    color: AyColors.text,
    fontSize: 12,
    fontWeight: "800",
  },
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
  cancelButtonText: {
    color: AyColors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
});
