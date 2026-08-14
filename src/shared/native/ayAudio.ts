import {NativeModules} from "react-native";

export type AyAudioRouteModule = {
  setSpeakerEnabled(enabled: boolean): Promise<boolean>;
};

export const AyAudioRoute =
  NativeModules.AyAudioRoute as AyAudioRouteModule | undefined;
