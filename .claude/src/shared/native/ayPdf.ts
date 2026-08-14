import {NativeModules} from "react-native";

export type AyPdfModule = {
  createConversationPdf(
    title: string,
    lines: string[],
  ): Promise<string>;
};

export const AyPdf =
  NativeModules.AyPdf as AyPdfModule | undefined;
