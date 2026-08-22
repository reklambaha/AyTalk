import {NativeModules} from "react-native";

export const SERVER_URL = "https://aytalk.onrender.com";

const nativeAppSharedKey = NativeModules?.AySpeech?.appSharedKey;

export const APP_SHARED_KEY =
  typeof nativeAppSharedKey === "string" ? nativeAppSharedKey.trim() : "";

export const getApiJsonHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  "x-app-key": APP_SHARED_KEY,
});

export const getApiAuthHeaders = (): Record<string, string> => ({
  "x-app-key": APP_SHARED_KEY,
});

export function assertApiConfiguration() {
  if (!APP_SHARED_KEY) {
    throw new Error(
      "AyTalk uygulama anahtarı APK içine eklenmemiş. GitHub Actions APP_SHARED_KEY secret veya yerel .env kontrol edilmeli.",
    );
  }
}

export async function fetchJson<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 20000,
): Promise<T> {
  assertApiConfiguration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${SERVER_URL}${path}`, {
      ...options,
      headers: {
        ...getApiJsonHeaders(),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    let data: any = {};
    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      throw new Error(data?.error || `Sunucu hatası (${response.status}).`);
    }

    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Sunucu isteği zaman aşımına uğradı.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
