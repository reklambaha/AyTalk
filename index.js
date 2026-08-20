import {AppRegistry} from "react-native";
import {registerGlobals} from "@livekit/react-native";
import App from "./App";
import {name as appName} from "./app.json";
if (typeof global.DOMException === "undefined") {
  global.DOMException = class DOMException extends Error {
    constructor(message = "", name = "Error") { super(message); this.name = name; }
  };
}
registerGlobals();
AppRegistry.registerComponent(appName, () => App);
