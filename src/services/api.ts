import {NativeModules} from "react-native";

// AyTalk production backend. API secrets stay on Render; the mobile app only
// receives the app-level request key at Android build time.
export const SERVER_URL = "https://aytalk.onrender.com";

const nativeAppSharedKey = NativeModules?.AySpeech?.appSharedKey;

export const APP_SHARED_KEY =
  typeof nativeAppSharedKey === "string" ? nativeAppSharedKey.trim() : "";

if (__DEV__ && !APP_SHARED_KEY) {
  console.warn(
    "AyTalk: APP_SHARED_KEY APK'ya eklenmedi. Proje kokundeki .env dosyasina APP_SHARED_KEY ekleyip APK'yi yeniden derle.",
  );
}
