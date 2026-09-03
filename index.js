import {AppRegistry} from "react-native";
import {registerGlobals} from "@livekit/react-native";
import messaging from "@react-native-firebase/messaging";
import notifee, {
  AndroidCategory,
  AndroidImportance,
  EventType,
} from "@notifee/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import App from "./App";
import {name as appName} from "./app.json";
import {fetchJson} from "./src/services/api";

if (typeof global.DOMException === "undefined") {
  global.DOMException = class DOMException extends Error {
    constructor(message = "", name = "Error") {
      super(message);
      this.name = name;
    }
  };
}

registerGlobals();

const PENDING_CALL_KEY = "aytalk_pending_livebridge_call";
const LIVEBRIDGE_PROFILE_KEY = "livebridge_demo_profile_v1";

const syncSavedLiveBridgeProfile = async tokenOverride => {
  try {
    const raw = await AsyncStorage.getItem(LIVEBRIDGE_PROFILE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const phone = String(saved?.phone || "").replace(/[^0-9]/g, "");
    if (phone.length < 7) return;
    const token =
      String(tokenOverride || "").trim() ||
      String(await messaging().getToken().catch(() => "")).trim();

    await fetchJson(
      "/livebridge/profile/register",
      {
        method: "POST",
        body: JSON.stringify({
          phone,
          name: String(saved?.name || "LiveBridge Kullanıcısı").trim().slice(0, 80),
          language: String(saved?.language || "").trim().slice(0, 80),
          gender: saved?.gender === "male" ? "male" : "female",
          fcmToken: token,
        }),
      },
      10000,
    );
  } catch (error) {
    console.log("LiveBridge arka plan profil senkronu:", error?.message || error);
  }
};


const rememberIncomingCall = async data => {
  if (!data?.callId) return;
  await AsyncStorage.setItem(PENDING_CALL_KEY, JSON.stringify(data));
};

const showIncomingCallNotification = async remoteMessage => {
  const data = remoteMessage?.data || {};
  if (data.type !== "livebridge_incoming_call") return;

  // Full-screen intent uygulamayı doğrudan açabilir; App.tsx bu kaydı okuyup
  // LiveBridge ekranını otomatik açar.
  await rememberIncomingCall(data);

  const channelId = await notifee.createChannel({
    id: "livebridge_calls_v3",
    name: "LiveBridge Aramaları",
    importance: AndroidImportance.HIGH,
    sound: "livebridge_ring",
    vibration: true,
    vibrationPattern: [300, 500, 300, 800],
  });

  await notifee.displayNotification({
    id: String(data.callId || "livebridge-call"),
    title: `${data.callerName || "AyTalk kullanıcısı"} arıyor`,
    body:
      data.mode === "video"
        ? "LiveBridge görüntülü arama"
        : data.mode === "chat"
          ? "LiveBridge sohbet isteği"
          : "LiveBridge sesli arama",
    data,
    android: {
      channelId,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      ongoing: true,
      autoCancel: false,
      loopSound: true,
      timeoutAfter: 60000,
      pressAction: {id: "open_call", launchActivity: "default"},
      fullScreenAction: {id: "open_call", launchActivity: "default"},
      actions: [
        {
          title: "Reddet",
          pressAction: {id: "reject_call"},
        },
        {
          title: "Cevapla",
          pressAction: {id: "answer_call", launchActivity: "default"},
        },
      ],
    },
  });
};

const handleNotificationAction = async ({type, detail}) => {
  if (type !== EventType.ACTION_PRESS && type !== EventType.PRESS) return;
  const data = detail?.notification?.data || {};
  if (data.type !== "livebridge_incoming_call") return;
  const actionId = detail?.pressAction?.id || "open_call";

  if (actionId === "reject_call") {
    try {
      await fetchJson(
        "/livebridge/call/respond",
        {
          method: "POST",
          body: JSON.stringify({
            callId: data.callId,
            calleePhone: data.calleePhone,
            accepted: false,
          }),
        },
        8000,
      );
    } catch {}
    await AsyncStorage.removeItem(PENDING_CALL_KEY).catch(() => undefined);
    await notifee.cancelNotification(String(data.callId || "livebridge-call"));
    return;
  }

  await rememberIncomingCall(data);
  await notifee.cancelNotification(String(data.callId || "livebridge-call"));
};

// Background/terminated handler mümkün olduğunca erken kaydedilir.
messaging().setBackgroundMessageHandler(showIncomingCallNotification);
notifee.onBackgroundEvent(handleNotificationAction);
notifee.onForegroundEvent(handleNotificationAction);
messaging().onMessage(showIncomingCallNotification);

// Postgres/Render yeniden başlasa bile uygulama her açıldığında kendi LiveBridge
// kaydını ve güncel FCM tokenını geri yazar. Token değişiminde de aynı işlem yapılır.
void syncSavedLiveBridgeProfile();
messaging().onTokenRefresh(token => {
  void syncSavedLiveBridgeProfile(token);
});

AppRegistry.registerComponent(appName, () => App);
