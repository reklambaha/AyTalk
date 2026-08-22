import {AppRegistry} from "react-native";
import {registerGlobals} from "@livekit/react-native";
import App from "./App";
import {name as appName} from "./app.json";

if (typeof global.DOMException === "undefined") {
  global.DOMException = class DOMException extends Error {
    constructor(message = "", name = "Error") {
      super(message);
      this.name = name;
    }
  };
}

registerGlobals();

/*
 * AyTalk başlangıç güvenliği:
 * Firebase / Notifee henüz tam yapılandırılmamış olsa bile uygulamanın
 * açılışını engellemez. Push sistemi varsa devreye girer; yoksa uygulama
 * normal şekilde açılır.
 */
const setupIncomingCallPush = async () => {
  try {
    const messagingModule = require("@react-native-firebase/messaging");
    const notifeeModule = require("@notifee/react-native");

    const messaging = messagingModule.default || messagingModule;
    const notifee = notifeeModule.default || notifeeModule;
    const AndroidCategory = notifeeModule.AndroidCategory;
    const AndroidImportance = notifeeModule.AndroidImportance;

    const showIncomingCallNotification = async remoteMessage => {
      try {
        const data = remoteMessage?.data || {};
        if (data.type !== "livebridge_incoming_call") return;

        const channelId = await notifee.createChannel({
          id: "livebridge_calls",
          name: "LiveBridge Aramaları",
          importance: AndroidImportance.HIGH,
          sound: "default",
          vibration: true,
        });

        await notifee.displayNotification({
          id: String(data.callId || "livebridge-call"),
          title: `${data.callerName || "AyTalk kullanıcısı"} arıyor`,
          body: data.video === "true" ? "LiveBridge görüntülü arama" : "LiveBridge sesli arama",
          data,
          android: {
            channelId,
            category: AndroidCategory.CALL,
            importance: AndroidImportance.HIGH,
            ongoing: true,
            autoCancel: false,
            pressAction: {id: "open_call", launchActivity: "default"},
            fullScreenAction: {id: "open_call", launchActivity: "default"},
            actions: [
              {
                title: "Reddet",
                pressAction: {id: "reject_call", launchActivity: "default"},
              },
              {
                title: "Cevapla",
                pressAction: {id: "answer_call", launchActivity: "default"},
              },
            ],
          },
        });
      } catch (notificationError) {
        console.warn("AyTalk incoming-call notification error:", notificationError);
      }
    };

    // Firebase hazır değilse burada hata yakalanır; uygulama yine açılır.
    const firebaseMessaging = messaging();

    firebaseMessaging.setBackgroundMessageHandler(showIncomingCallNotification);
    firebaseMessaging.onMessage(showIncomingCallNotification);
  } catch (pushSetupError) {
    console.warn("AyTalk push setup skipped:", pushSetupError);
  }
};

AppRegistry.registerComponent(appName, () => App);

// AppRegistry önce kaydedilir; push başlatma hatası uygulamayı kapatamaz.
void setupIncomingCallPush();
