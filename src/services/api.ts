import {NativeModules} from "react-native";

// AyTalk production backend. LiveKit/OpenAI secrets stay only on Render.
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

export const assertApiConfiguration = () => {
  if (!APP_SHARED_KEY) {
    throw new Error(
      "AyTalk uygulama anahtarı APK içine eklenmemiş. GitHub Actions secret APP_SHARED_KEY veya yerel .env kontrol edilmeli.",
    );
  }
};

if (__DEV__ && !APP_SHARED_KEY) {
  console.warn(
    "AyTalk: APP_SHARED_KEY APK'ya eklenmedi. Yerel build için proje .env; GitHub build için Actions Secret gerekir.",
  );
}
