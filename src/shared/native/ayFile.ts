import {NativeModules} from "react-native";

export type AyFileModule = {
  zipDirectory(
    treeUri: string,
    outputName: string,
  ): Promise<string>;
};

export const AyFile =
  NativeModules.AyFile as AyFileModule | undefined;
