import {normalizeForSpeech, localePrefix} from "./generic";
import {getLanguageRule} from "./rules";
import {SpeechOptimizationResult, VoiceLike} from "./types";

function findCompatibleVoice(voices: VoiceLike[], locale: string): VoiceLike | undefined {
  const normalized = locale.toLowerCase();
  const prefix = localePrefix(locale);
  const installed = voices.filter(v => v.notInstalled !== true && Boolean(String(v.language || "").trim()));
  return installed.find(v => String(v.language || "").toLowerCase() === normalized) ||
    installed.find(v => localePrefix(String(v.language || "")) === prefix);
}
export function optimizeSpeechText(displayText: string, locale: string): string {
  getLanguageRule(locale);
  return normalizeForSpeech(displayText).trim();
}
export function prepareSpeech({text, locale, voices}: {text: string; locale: string; voices: VoiceLike[]}): SpeechOptimizationResult {
  const voice = findCompatibleVoice(voices, locale);
  return {
    displayText: text,
    speechText: optimizeSpeechText(text, locale),
    requestedLocale: locale,
    selectedLocale: voice?.language || locale,
    selectedVoiceId: voice?.id,
    hasCompatibleLocalVoice: Boolean(voice),
  };
}
