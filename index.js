import {AppRegistry} from "react-native";
import {registerGlobals} from "@livekit/react-native";
import App from "./App";
import {name as appName} from "./app.json";
import messaging from "@react-native-firebase/messaging";
import notifee, {AndroidCategory, AndroidImportance} from "@notifee/react-native";

async function showIncomingCallNotification(remoteMessage) {
  const data = remoteMessage?.data || {};
  if (data.type !== "livebridge_incoming_call") return;
  const channelId = await notifee.createChannel({
    id: "livebridge_calls", name: "LiveBridge Aramaları",
    importance: AndroidImportance.HIGH, sound: "default", vibration: true,
  });
  await notifee.displayNotification({
    id: String(data.callId || "livebridge-call"),
    title: `${data.callerName || "AyTalk kullanıcısı"} arıyor`,
    body: "LiveBridge gelen arama",
    data,
    android: {
      channelId, category: AndroidCategory.CALL, importance: AndroidImportance.HIGH,
      ongoing: true, autoCancel: false, pressAction: {id: "default", launchActivity: "default"},
      fullScreenAction: {id: "default", launchActivity: "default"},
    },
  });
}

messaging().setBackgroundMessageHandler(showIncomingCallNotification);
messaging().onMessage(showIncomingCallNotification);

if (typeof global.DOMException === "undefined") {
  global.DOMException = class DOMException extends Error {
    constructor(message = "", name = "Error") { super(message); this.name = name; }
  };
}
registerGlobals();
AppRegistry.registerComponent(appName, () => App);
