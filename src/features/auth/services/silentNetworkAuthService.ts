import {signInWithAyTalkCustomToken} from "./authService";
import type {AuthSession} from "../types/auth.types";

// Yalnız security/global-auth-router-v1 test akışı için.
// Production'a geçerken provider router üzerinden gerçek backend URL'sine taşınacak.
export const SILENT_AUTH_SERVER_URL = "https://aytalk-auth-test.onrender.com";

type StartResponse = {
  ok?: boolean;
  verificationId?: string;
  authorizationUrl?: string;
  expiresAt?: number;
  provider?: string;
  error?: string;
};

export type SilentVerificationStatus = {
  ok?: boolean;
  status?: "pending" | "verified" | "failed" | string;
  verified?: boolean;
  phoneNumber?: string;
  provider?: string;
  expiresAt?: number;
  sessionReady?: boolean;
  sessionIssued?: boolean;
  error?: string;
};

type CompleteResponse = {
  ok?: boolean;
  verified?: boolean;
  phoneNumber?: string;
  firebaseCustomToken?: string;
  provider?: string;
  error?: string;
};

const requestJson = async <T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 15000,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${SILENT_AUTH_SERVER_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {error: text || "Sunucudan geçersiz cevap alındı."};
    }

    if (!response.ok) {
      throw new Error(data?.error || `Sunucu hatası (${response.status}).`);
    }

    return data as T;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new Error("Sessiz doğrulama sunucusu zamanında cevap vermedi.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const normalizeE164 = (rawPhone: string) => {
  const phone = String(rawPhone || "").replace(/[\s()-]/g, "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("Telefon numarasını + ülke koduyla yazın. Örnek: +905xxxxxxxxx");
  }
  return phone;
};

export const startSilentNetworkVerification = async (rawPhone: string) => {
  const phoneNumber = normalizeE164(rawPhone);
  const data = await requestJson<StartResponse>(
    "/auth/network/orange/start",
    {
      method: "POST",
      body: JSON.stringify({phoneNumber}),
    },
  );

  if (!data.verificationId || !data.authorizationUrl) {
    throw new Error(data.error || "Sessiz doğrulama başlatılamadı.");
  }

  return {
    verificationId: data.verificationId,
    authorizationUrl: data.authorizationUrl,
    expiresAt: Number(data.expiresAt || 0),
    provider: data.provider || "orange_playground",
    phoneNumber,
  };
};

export const getSilentNetworkVerificationStatus = async (
  verificationId: string,
): Promise<SilentVerificationStatus> =>
  requestJson<SilentVerificationStatus>(
    `/auth/network/orange/status/${encodeURIComponent(verificationId)}`,
    {method: "GET"},
  );

export const completeSilentNetworkVerification = async (
  verificationId: string,
): Promise<AuthSession> => {
  const data = await requestJson<CompleteResponse>(
    `/auth/network/orange/complete/${encodeURIComponent(verificationId)}`,
    {method: "POST"},
  );

  if (!data.verified || !data.firebaseCustomToken) {
    throw new Error(data.error || "Doğrulanmış AyTalk oturumu oluşturulamadı.");
  }

  // Custom token diske yazılmaz. Alınır alınmaz Firebase oturumuna çevrilir.
  return signInWithAyTalkCustomToken(data.firebaseCustomToken);
};
